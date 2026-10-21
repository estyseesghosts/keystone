import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {useShellLayout} from '#/alf/breakpoints'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {Pressable} from '#/components/Pressable'
import {PencilIcon} from '#/components/icons'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

// Base clearance above the shell tab bar (was a fixed 88). The
// home-indicator bottom inset stacks on top (N21) so the FAB never sits
// under the gesture bar on notched phones.
const FAB_BASE_BOTTOM = 88

// Compose entry (Keystone v1 `.compose-fab`): 56px circle, bottom-right
// above the tab bar, mobile layout only. Wider shells use the sidebar Post
// button instead. Signed out there is nothing to post as, so no inert
// control is shown.
export function ComposeFab() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const layout = useShellLayout()
  const theme = useTheme()
  const insets = useOptionalSafeAreaInsets()
  const {session} = useActiveBackend()
  if (!session || layout !== 'mobile') return null
  return (
    <View style={[styles.wrap, {bottom: FAB_BASE_BOTTOM + insets.bottom}]} pointerEvents="box-none">
      <Pressable
        testID="compose-fab"
        onPress={() => nav.navigate('Compose')}
        accessibilityRole="button"
        accessibilityLabel="Write a post"
        style={[styles.fab, {backgroundColor: theme.palette.text}]}>
        <PencilIcon size={24} color={theme.palette.bg} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
