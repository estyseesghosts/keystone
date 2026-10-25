// Overlapping avatar for the profile header (v1 pattern: the avatar
// sits on the banner's bottom edge; an initial fills in when the server
// sent no avatar URL — never a fabricated photo).
import {useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {safeHttpUrl} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {AppImage} from '#/components/Image'

export const PROFILE_AVATAR_SIZE = 96

/** Device-local image schemes (editor picks): safe to render without a
 * network fetch and never server-influenced. */
function isLocalPreview(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:image/')
}

export function ProfileAvatar({
  uri,
  name,
  blurhash,
  testID,
}: {
  uri: string | null
  name: string
  /** Server blurhash (`Account.avatarBlurhash`): placeholder while loading. */
  blurhash?: string | null
  testID?: string
}) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  const initial = (name.trim().slice(0, 1) || '?').toUpperCase()
  // Server strings are never trusted as image sources: anything but
  // http(s) — or a device-local editor pick — renders the initial
  // fallback (PostCard parity, media M16), never a broken-image hole. A
  // failed load falls back the same way.
  const safe = uri ? (isLocalPreview(uri) ? uri : safeHttpUrl(uri)) : null
  if (safe === null || failed) {
    return (
      <View
        testID={testID ?? 'profile-avatar'}
        accessibilityRole="image"
        accessibilityLabel={name}
        style={[
          styles.circle,
          {backgroundColor: theme.palette.bgSoft, borderColor: theme.palette.bg},
        ]}>
        <Body>{initial}</Body>
      </View>
    )
  }
  return (
    <AppImage
      uri={safe}
      blurhash={blurhash ?? null}
      contentFit="cover"
      recyclingKey={safe}
      testID={testID ?? 'profile-avatar'}
      style={[styles.circle, {borderColor: theme.palette.bg}]}
      accessibilityRole="image"
      accessibilityLabel={name}
      onError={() => setFailed(true)}
    />
  )
}

const styles = StyleSheet.create({
  circle: {
    width: PROFILE_AVATAR_SIZE,
    height: PROFILE_AVATAR_SIZE,
    borderRadius: PROFILE_AVATAR_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
