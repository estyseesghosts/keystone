import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'

// Shared placeholder body. Every screen renders this until its slice
// lands; the label names the slice that will build it.
export function Placeholder({title}: {title: string}) {
  return (
    <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
      <Body>{title}</Body>
      <Caption color="faint">Not built yet</Caption>
    </View>
  )
}
