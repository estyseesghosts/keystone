// Profile-image picking (clickstone §1.8). Reuses the composer's picker
// seam (`assetToFile` from `#/components/Composer/pickMedia`) but asks for
// the photo-library permission EXPLICITLY and returns a typed outcome, so
// the editor can tell "the user cancelled" apart from "access denied" and
// say which one happened instead of doing nothing.
//
// Images only: both families reject non-image avatar/banner files
// (Mastodon: image/jpeg|png|gif|webp; Misskey: `*_NOT_AN_IMAGE`), so the
// picker never offers a video the server would refuse.
import type {UploadableFile} from '#/state/queries/composer'

import {assetToFile} from '#/components/Composer/pickMedia'

export type ProfileImagePick =
  | {kind: 'picked'; file: UploadableFile}
  | {kind: 'cancelled'}
  | {kind: 'denied'; canAskAgain: boolean}

export async function pickProfileImage(): Promise<ProfileImagePick> {
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
  return {
    kind: 'picked',
    file: {
      file: await assetToFile(asset),
      name: asset.fileName || asset.uri.split('/').pop() || 'upload',
      previewUri: asset.uri,
    },
  }
}
