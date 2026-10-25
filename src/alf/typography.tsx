import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native'

import {useTheme} from '#/alf/index'
import {lineHeight, typeSize} from '#/alf/tokens'

type Variant = keyof typeof typeSize

type Props = Omit<RNTextProps, 'style'> & {
  variant?: Variant
  color?: 'text' | 'muted' | 'faint'
  style?: StyleProp<TextStyle>
  children: React.ReactNode
}

function Type({
  variant = 'body',
  color = 'text',
  style,
  children,
  ...rest
}: Props) {
  const theme = useTheme()
  return (
    <RNText
      style={[
        {
          fontSize: typeSize[variant] * theme.fontScaleMultiplier,
          lineHeight: lineHeight[variant] * theme.fontScaleMultiplier,
          color: theme.palette[color],
        },
        style,
      ]}
      {...rest}>
      {children}
    </RNText>
  )
}

export function Heading(
  props: Omit<Props, 'variant'> & {
    /** Web heading level for `aria-level` (screen-reader heading
     * navigation). Unset renders a header with the platform default level. */
    level?: number
  },
) {
  const {level, ...rest} = props
  return (
    <Type
      variant="heading"
      accessibilityRole="header"
      aria-level={level}
      {...rest}
    />
  )
}

export function Body(props: Omit<Props, 'variant'>) {
  return <Type variant="body" {...props} />
}

export function Caption(props: Omit<Props, 'variant'>) {
  return <Type variant="caption" {...props} />
}
