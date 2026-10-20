import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {StyleSheet, View} from 'react-native'

import {Button} from '#/components/Button'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

const styles = StyleSheet.create({
  wrap: {position: 'absolute', right: 16, bottom: 16},
})

// Compose entry point (slice 4.6). Only rendered with an active session;
// signed out there is nothing to post as, so no inert control is shown.
export function ComposeFab() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const {session} = useActiveBackend()
  if (!session) return null
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Button
        label="Compose"
        variant="primary"
        onPress={() => nav.navigate('Compose')}
        testID="compose-fab"
      />
    </View>
  )
}
