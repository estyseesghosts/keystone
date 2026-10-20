import {StyleSheet} from 'react-native'

import {radius, space} from '#/alf/tokens'

// Layout atom presets. Components compose these instead of inventing
// one-off flex/padding styles.
export const atoms = StyleSheet.create({
  flex1: {flex: 1},
  row: {flexDirection: 'row'},
  col: {flexDirection: 'column'},
  centered: {alignItems: 'center', justifyContent: 'center'},
  itemsCenter: {alignItems: 'center'},
  px_md: {paddingHorizontal: space.md},
  py_sm: {paddingVertical: space.sm},
  p_md: {padding: space.md},
  gap_sm: {gap: space.sm},
  gap_md: {gap: space.md},
  rounded_md: {borderRadius: radius.md},
  rounded_full: {borderRadius: radius.full},
})
