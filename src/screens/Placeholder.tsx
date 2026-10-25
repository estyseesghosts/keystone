import {View} from 'react-native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'

// Shared placeholder body. Every screen renders this until its slice
// lands; the label names the slice that will build it.
export function Placeholder({title}: {title: string}) {
  const i18n = useI18n()
  return (
    <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
      <Body>{title}</Body>
      <Caption color="faint">{i18n._(msg`Not built yet`)}</Caption>
    </View>
  )
}
