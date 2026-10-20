import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme, useThemeName} from '#/alf/index'
import {space, typeSize} from '#/alf/tokens'
import {Body, Caption, Heading} from '#/alf/typography'

const SIZES = Object.keys(typeSize) as (keyof typeof typeSize)[]

// Temporary scaffold showcase (plan slice 1.3): proves the type scale
// and both colour modes render. Becomes the `/sys/debug` route content
// when navigation lands (slice 1.5).
export function SysDebug() {
  const name = useThemeName()
  const theme = useTheme()
  const swatches = Object.entries(theme.palette)
  return (
    <View
      testID={`sys-debug-${name}`}
      style={[
        atoms.flex1,
        atoms.p_md,
        atoms.gap_md,
        {backgroundColor: theme.palette.bg},
      ]}>
      <Heading>Keystone debug ({name})</Heading>
      {SIZES.map(s => (
        <Body key={s}>
          {s} · {typeSize[s]}pt
        </Body>
      ))}
      <View style={[atoms.row, {gap: space.sm, flexWrap: 'wrap'}]}>
        {swatches.map(([key, hex]) => (
          <View
            key={key}
            testID={`swatch-${key}`}
            style={{
              width: 72,
              height: 48,
              backgroundColor: hex,
              borderWidth: 1,
              borderColor: theme.palette.borderStrong,
            }}>
            <Caption>{key}</Caption>
          </View>
        ))}
      </View>
      <Caption>A pure grey system — no accent colour.</Caption>
    </View>
  )
}
