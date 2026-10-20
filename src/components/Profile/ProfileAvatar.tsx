// Overlapping avatar for the profile header (v1 pattern: the avatar
// sits on the banner's bottom edge; an initial fills in when the server
// sent no avatar URL — never a fabricated photo).
import {Image, StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'

export const PROFILE_AVATAR_SIZE = 72

export function ProfileAvatar({
  uri,
  name,
  testID,
}: {
  uri: string | null
  name: string
  testID?: string
}) {
  const theme = useTheme()
  const initial = (name.trim().slice(0, 1) || '?').toUpperCase()
  if (!uri) {
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
    <Image
      testID={testID ?? 'profile-avatar'}
      source={{uri}}
      style={[styles.circle, {borderColor: theme.palette.bg}]}
      accessibilityRole="image"
      accessibilityLabel={name}
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
