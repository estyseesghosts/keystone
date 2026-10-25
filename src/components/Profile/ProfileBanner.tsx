// Profile banner (Keystone v1 pattern: full-width banner image, or a
// quiet placeholder block when the server sent none — never faked).
import {useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {safeHttpUrl} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {AppImage} from '#/components/Image'

export const PROFILE_BANNER_HEIGHT = 160

/** Device-local image schemes (editor picks): safe to render without a
 * network fetch and never server-influenced. */
function isLocalPreview(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:image/')
}

export function ProfileBanner({
  uri,
  blurhash,
  testID,
}: {
  uri: string | null
  blurhash?: string | null
  testID?: string
}) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  // A failed load falls back to the quiet placeholder (media M16), never
  // a broken-image hole; unvetted strings never fetch (device-local editor
  // picks aside).
  const safe = uri ? (isLocalPreview(uri) ? uri : safeHttpUrl(uri)) : null
  if (safe === null || failed) {
    return (
      <View
        testID={testID ?? 'profile-banner'}
        accessibilityRole="image"
        style={[styles.banner, {backgroundColor: theme.palette.bgSoft}]}
      />
    )
  }
  return (
    <AppImage
      uri={safe}
      blurhash={blurhash ?? null}
      contentFit="cover"
      recyclingKey={safe}
      testID={testID ?? 'profile-banner'}
      style={styles.banner}
      accessibilityRole="image"
    />
  )
}

const styles = StyleSheet.create({
  banner: {width: '100%', height: PROFILE_BANNER_HEIGHT},
})
