// Profile-image picking (clickstone §1.8). Reuses the composer's picker
// seam (`assetToFile` from `#/components/Composer/pickMedia`) but asks for
// the photo-library permission EXPLICITLY and returns a typed outcome, so
// the editor can tell "the user cancelled" apart from "access denied" and
// say which one happened instead of doing nothing.
//
// Images only: both families reject non-image avatar/banner files
// (Mastodon: image/jpeg|png|gif|webp; Misskey: `*_NOT_AN_IMAGE`), so the
// picker never offers a video the server would refuse.
//
// Repair X7.4 step 8 (M16): the pick is cropped to the target aspect and
// resized (avatar 400 px, header 1500 px wide — never upscaled) through
// `expo-image-manipulator` BEFORE upload, which also drops EXIF/GPS as a
// side effect (D9). A missing/failed manipulator falls back to the
// original bytes so the editor stays usable.
import type {ProfileImageKind} from '@keystone/fedi'
import type {Action} from 'expo-image-manipulator'

import {isWebAssetUri, type UploadableFile} from '#/state/queries/composer'

import {assetToFile} from '#/components/Composer/pickMedia'

export type ProfileImagePick =
  | {kind: 'picked'; file: UploadableFile}
  | {kind: 'cancelled'}
  | {kind: 'denied'; canAskAgain: boolean}

/** Upload geometry per profile-image kind: avatar is square at 400 px,
 * banner is 3:1 (Mastodon header 1500×500) at 1500 px wide. */
export function profileImageTarget(kind: ProfileImageKind): {aspect: number; width: number} {
  return kind === 'avatar' ? {aspect: 1, width: 400} : {aspect: 3, width: 1500}
}

export interface CropRect {
  originX: number
  originY: number
  width: number
  height: number
}

/** Center-crop rectangle for `aspect` (width/height), or null when the
 * source already matches (or its size is unknown). Never upscales: the
 * rectangle always fits inside the source. Pure. */
export function centerCropForAspect(
  width: number,
  height: number,
  aspect: number,
): CropRect | null {
  if (!(width > 0) || !(height > 0) || !(aspect > 0)) return null
  if (Math.abs(width / height - aspect) < 0.001) return null
  if (width / height > aspect) {
    // Too wide: trim the sides.
    const w = Math.max(1, Math.floor(height * aspect))
    return {originX: Math.floor((width - w) / 2), originY: 0, width: w, height}
  }
  // Too tall: trim top and bottom.
  const h = Math.max(1, Math.floor(width / aspect))
  return {originX: 0, originY: Math.floor((height - h) / 2), width, height: h}
}

export async function pickProfileImage(
  kind: ProfileImageKind = 'avatar',
): Promise<ProfileImagePick> {
  // Lazy: tests and web bundles that never change a picture do not pull
  // the native module (same discipline as the composer picker).
  const Picker = await import('expo-image-picker')
  const permission = await Picker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    return {kind: 'denied', canAskAgain: permission.canAskAgain !== false}
  }
  const result = await Picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  })
  if (result.canceled || result.assets.length === 0) return {kind: 'cancelled'}
  const asset = result.assets[0]
  const rawName = asset.fileName || asset.uri.split('/').pop() || 'upload'
  const base = rawName.replace(/\.[a-z0-9]+$/i, '') || 'upload'
  const outName = `${base}.jpg`
  const target = profileImageTarget(kind)
  try {
    const Manip = await import('expo-image-manipulator')
    const dims = asset as {width?: unknown; height?: unknown}
    const w = typeof dims.width === 'number' ? dims.width : NaN
    const h = typeof dims.height === 'number' ? dims.height : NaN
    const actions: Action[] = []
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const crop = centerCropForAspect(w, h, target.aspect)
      if (crop) actions.push({crop})
      const outWidth = crop ? crop.width : w
      // Resize down only: a smaller source keeps its pixels (never
      // upscale a thumbnail into a blurry banner).
      if (outWidth > target.width) actions.push({resize: {width: target.width}})
    }
    const out = await Manip.manipulateAsync(asset.uri, actions, {
      compress: 0.92,
      format: Manip.SaveFormat.JPEG,
    })
    if (out?.uri) {
      if (isWebAssetUri(out.uri)) {
        const file = await assetToFile({uri: out.uri, fileName: outName, mimeType: 'image/jpeg'})
        return {
          kind: 'picked',
          file: {file, name: outName, previewUri: out.uri, mimeType: 'image/jpeg', hadGps: false},
        }
      }
      return {
        kind: 'picked',
        file: {
          file: {uri: out.uri, name: outName, type: 'image/jpeg'},
          name: outName,
          previewUri: out.uri,
          mimeType: 'image/jpeg',
          hadGps: false,
        },
      }
    }
  } catch {
    // Manipulator missing/failed (or the output unreadable): fall through
    // to the original bytes below — an editor that cannot strip still
    // uploads.
  }
  const name = rawName
  if (isWebAssetUri(asset.uri)) {
    return {
      kind: 'picked',
      file: {
        file: await assetToFile(asset),
        name,
        previewUri: asset.uri,
      },
    }
  }
  return {
    kind: 'picked',
    file: {
      file: {
        uri: asset.uri,
        name,
        type: asset.mimeType || 'application/octet-stream',
      },
      name,
      previewUri: asset.uri,
      mimeType: asset.mimeType ?? null,
      hadGps: null,
    },
  }
}
