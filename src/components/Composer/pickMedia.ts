import {
  attachmentCapFor,
  isWebAssetUri,
  kindOfMime,
  probeNativeFileSize,
  type AttachmentCaps,
  type UploadableFile,
} from '#/state/queries/composer'

// Media picking (slice 4.3). expo-image-picker is loaded lazily so tests
// and web bundles that never open the picker do not pull the native module.

/** Turn a picked asset into a `File` the Backend upload takes. Web only:
 * native assets stay `{uri, name, type}` references (repair X7.4 step 3)
 * and never take this path — a whole-file `fetch(uri).blob()` into JS
 * memory is exactly what the native path avoids. */
export async function assetToFile(asset: {
  uri: string
  fileName?: string | null
  mimeType?: string | null
}): Promise<File> {
  const name = asset.fileName || asset.uri.split('/').pop() || 'upload'
  const res = await fetch(asset.uri)
  const blob = await res.blob()
  return new File([blob], name, {type: asset.mimeType || blob.type || 'application/octet-stream'})
}

/** Why one picked asset was refused. `too-large` carries the cap that
 * applied (repair X6.2 step 2); `unreadable` is an iCloud-only (or
 * otherwise unreadable) asset that must never discard the other picks
 * (repair X7.4 step 3). */
export type PickRejectReason = 'too-large' | 'unreadable'

export interface MediaRejected {
  name: string
  limit: number
  reason: PickRejectReason
}

/** Typed outcome (R2.3, mirroring `pickProfileImage`): the composer shows
 * `denied`, never a silent cancel — and over-cap assets are reported in
 * `rejected` WITH the cap that applied (repair X6.2 step 2: per-kind
 * server caps, else the client heap bound) instead of vanishing. */
export type MediaPick =
  | {kind: 'picked'; files: UploadableFile[]; rejected: MediaRejected[]}
  | {kind: 'cancelled'}
  | {kind: 'denied'; canAskAgain: boolean}

/** True when a picker asset's EXIF block carries GPS tags (repair X7.4
 * step 6: drives the Keep-original warning). Native assets expose `exif`;
 * web assets usually do not — the byte scan (`jpegHeadHasGps`) covers
 * them. Shape-defensive: unknown EXIF layouts read as absent, never crash.
 * Pure. */
export function hasGpsExif(exif: unknown): boolean {
  if (typeof exif !== 'object' || exif === null) return false
  const rec = exif as Record<string, unknown>
  return 'GPSLatitude' in rec || 'GPSLongitude' in rec
}

/** True when a JPEG head contains an EXIF GPS directory (repair X7.4 step
 * 6). Conservative: any GPS IFD means location-ish metadata. Fully
 * bounds-checked — non-JPEG, truncated, or GPS-less data reads false.
 * Pure. */
export function jpegHeadHasGps(head: ArrayBuffer): boolean {
  const b = new Uint8Array(head)
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false
  let off = 2
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) return false
    const marker = b[off + 1]
    // Start-of-scan / end-of-image: past the metadata segments.
    if (marker === 0xda || marker === 0xd9) return false
    const len = (b[off + 2] << 8) | b[off + 3]
    // Lengths count the two length bytes themselves. A segment that
    // overruns the head is truncated data, not evidence — the scan is
    // best-effort over the first 64 KB, so stop (fail false).
    if (len < 2 || off + 2 + len > b.length) return false
    if (marker === 0xe1 && len >= 10) {
      const p = off + 4
      if (
        p + 8 <= b.length &&
        b[p] === 0x45 && // E
        b[p + 1] === 0x78 && // x
        b[p + 2] === 0x69 && // i
        b[p + 3] === 0x66 && // f
        b[p + 4] === 0 &&
        b[p + 5] === 0
      ) {
        if (tiffHasGps(b, p + 6, len - 8)) return true
      }
    }
    off += 2 + len
  }
  return false
}

/** True when a TIFF header (inside EXIF APP1) points IFD0 at a GPS
 * directory (tag 0x8825). Offsets are TIFF-relative; every read is
 * bounds-checked against the segment length. Pure. */
function tiffHasGps(b: Uint8Array, start: number, len: number): boolean {
  if (len < 8 || start < 0 || start + 8 > b.length) return false
  const little = b[start] === 0x49 && b[start + 1] === 0x49
  const big = b[start] === 0x4d && b[start + 1] === 0x4d
  if (!little && !big) return false
  const u16 = (p: number): number =>
    start + p + 1 < b.length && p >= 0
      ? little
        ? b[start + p] | (b[start + p + 1] << 8)
        : (b[start + p] << 8) | b[start + p + 1]
      : 0
  const u32 = (p: number): number =>
    little
      ? u16(p) | (u16(p + 2) << 16)
      : (u16(p) << 16) | u16(p + 2)
  if (u16(2) !== 42) return false
  const ifd0 = u32(4)
  if (ifd0 < 0 || ifd0 + 2 > len) return false
  const count = u16(ifd0)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12
    if (entry < 0 || entry + 12 > len || start + entry + 12 > b.length) return false
    if (u16(entry) === 0x8825) return true
  }
  return false
}

/** Scan the head of a web `File` for GPS EXIF (repair X7.4 step 6): only
 * the first 64 KB are read (never the whole file for the scan), and any
 * failure reads as unknown (null) — the Keep-original toggle then warns
 * generically instead of specifically. */
export async function scanFileHeadForGps(file: File): Promise<boolean | null> {
  try {
    const head = await file.slice(0, 65536).arrayBuffer()
    return jpegHeadHasGps(head)
  } catch {
    return null
  }
}

export async function pickMedia(opts: {
  limit: number
  /** Per-kind server caps in bytes; null = unreported (the heap bound
   * applies). Mirrors `AttachmentCaps` so the composer passes its limits
   * straight through. */
  imageBytes?: number | null
  videoBytes?: number | null
}): Promise<MediaPick> {
  if (opts.limit <= 0) return {kind: 'picked', files: [], rejected: []}
  const caps: AttachmentCaps = {imageBytes: opts.imageBytes ?? null, videoBytes: opts.videoBytes ?? null}
  const Picker = await import('expo-image-picker')
  // Explicit permission, like the profile flow: on older Android (pre
  // photo-picker, needs `READ_MEDIA_*`) the launch can otherwise fail
  // into a silent `canceled` and the composer shows nothing.
  const permission = await Picker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    return {kind: 'denied', canAskAgain: permission.canAskAgain !== false}
  }
  const result = await Picker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: opts.limit > 1,
    selectionLimit: opts.limit,
    // Originals, deliberately: the server owns derivatives and the client
    // bound is the size guard below, not silent recompression — video in
    // particular is never downscaled here, over-cap video is refused.
    quality: 1,
  })
  if (result.canceled || result.assets.length === 0) return {kind: 'cancelled'}
  const files: UploadableFile[] = []
  const rejected: MediaRejected[] = []
  // Per-asset try/catch (repair X7.4 step 3): one unreadable asset
  // (iCloud-only, revoked permission mid-pick) is reported on its own row
  // and never discards the other picks.
  for (const asset of result.assets) {
    const name = asset.fileName || asset.uri.split('/').pop() || 'upload'
    const mime = asset.mimeType ?? null
    const kind = kindOfMime(mime)
    const cap = attachmentCapFor(kind, caps)
    try {
      // Pre-read bound: a known over-cap size never reaches the bytes —
      // never OOM the Hermes heap to learn a file is too large. The cap is
      // per-kind from the server limits (repair X6.2 step 2), else the
      // client heap bound.
      //
      // Native assets without a picker count are measured through the
      // (transitive, never relied on) file-system seam; unknown sizes fall
      // through to the `uploads.add` / upload-time guard instead.
      const web = isWebAssetUri(asset.uri)
      let size: number | null =
        typeof asset.fileSize === 'number' && asset.fileSize > 0 ? asset.fileSize : null
      if (size == null && !web) size = await probeNativeFileSize(asset.uri)
      if (size != null && size > cap) {
        rejected.push({name, limit: cap, reason: 'too-large'})
        continue
      }
      if (!web) {
        // Native reference (repair X7.4 step 3): `{uri, name, type}` for
        // FormData — the bytes are never read into JS.
        const assetExif = (asset as {exif?: unknown}).exif
        files.push({
          file: {
            uri: asset.uri,
            name,
            type: mime || 'application/octet-stream',
            ...(size != null ? {size} : {}),
          },
          name,
          previewUri: asset.uri,
          mimeType: mime,
          hadGps: assetExif !== undefined ? hasGpsExif(assetExif) : null,
        })
        continue
      }
      // Web blob path (repair X7.4 step 3): the size check above ran
      // before the read where the API allows (`fileSize`); the upload-time
      // guard re-checks the read bytes either way.
      const file = await assetToFile(asset)
      files.push({
        file,
        name,
        previewUri: asset.uri,
        mimeType: file.type || mime,
        hadGps: await scanFileHeadForGps(file),
      })
    } catch {
      rejected.push({name, limit: cap, reason: 'unreadable'})
    }
  }
  return {kind: 'picked', files, rejected}
}
