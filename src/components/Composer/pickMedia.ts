import {MAX_MEDIA_BYTES, type UploadableFile} from '#/state/queries/composer'

// Media picking (slice 4.3). expo-image-picker is loaded lazily so tests
// and web bundles that never open the picker do not pull the native module.

/** Turn a picked asset into a `File` the Backend upload takes. */
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

/** Typed outcome (R2.3, mirroring `pickProfileImage`): the composer shows
 * `denied`, never a silent cancel — and over-cap assets are reported in
 * `rejected` instead of vanishing. */
export type MediaPick =
  | {kind: 'picked'; files: UploadableFile[]; rejected: string[]}
  | {kind: 'cancelled'}
  | {kind: 'denied'; canAskAgain: boolean}

export async function pickMedia(opts: {limit: number}): Promise<MediaPick> {
  if (opts.limit <= 0) return {kind: 'picked', files: [], rejected: []}
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
  const rejected: string[] = []
  for (const asset of result.assets) {
    const name = asset.fileName || asset.uri.split('/').pop() || 'upload'
    // Pre-read bound: `assetToFile` materializes the whole asset in JS
    // memory, so over-cap assets are refused BEFORE the fetch — never OOM
    // the Hermes heap to learn a file is too large. Unknown sizes fall
    // through to the `uploads.add` / upload-time guard instead.
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_MEDIA_BYTES) {
      rejected.push(name)
      continue
    }
    files.push({
      file: await assetToFile(asset),
      name,
      previewUri: asset.uri,
    })
  }
  return {kind: 'picked', files, rejected}
}
