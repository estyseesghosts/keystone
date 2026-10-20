// Profile banner (Keystone v1 pattern: full-width banner image, or a
// quiet placeholder block when the server sent none — never faked).
import {Image, StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'

export const PROFILE_BANNER_HEIGHT = 160

export function ProfileBanner({uri, testID}: {uri: string | null; testID?: string}) {
  const theme = useTheme()
  if (!uri) {
    return (
      <View
        testID={testID ?? 'profile-banner'}
        accessibilityRole="image"
        style={[styles.banner, {backgroundColor: theme.palette.bgSoft}]}
      />
    )
  }
  return (
    <Image
      testID={testID ?? 'profile-banner'}
      source={{uri}}
      style={styles.banner}
      resizeMode="cover"
      accessibilityRole="image"
    />
  )
}

const styles = StyleSheet.create({
  banner: {width: '100%', height: PROFILE_BANNER_HEIGHT},
})
