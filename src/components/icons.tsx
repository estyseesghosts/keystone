import {Circle, Line, Path, Svg} from 'react-native-svg'

import {useTheme} from '#/alf/index'

// Butterfly icon set: monochrome stroke icons on a 24×24 grid
// (stroke width 2, round caps/joins), drawn for this app in the v1 style.
// Color defaults to the theme text (readable in both themes — never baked
// black); callers may pass an explicit alf palette color instead.

export type IconProps = {
  size?: number
  color?: string
  filled?: boolean
}

function Base({
  size = 24,
  color,
  children,
}: IconProps & {children: React.ReactNode}) {
  const theme = useTheme()
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.palette.text}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityIgnoresInvertColors>
      {children}
    </Svg>
  )
}

export function HomeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M3 11l9-8 9 8" />
      <Path d="M5 10v10h5v-6h4v6h5V10" />
    </Base>
  )
}

export function NetworkIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 19c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <Circle cx={16.5} cy={9} r={2.5} />
      <Path d="M15.5 14.4c2.8.3 4.9 2 5.6 4.3" />
    </Base>
  )
}

export function SearchIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={11} cy={11} r={7} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} />
    </Base>
  )
}

export function BellIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Base>
  )
}

export function ProfileIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </Base>
  )
}

export function PencilIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </Base>
  )
}

export function BackIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M15 18l-6-6 6-6" />
    </Base>
  )
}

export function LoginIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <Path d="M10 17l5-5-5-5" />
      <Line x1={15} y1={12} x2={3} y2={12} />
    </Base>
  )
}

export function SettingsIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Line x1={4} y1={8} x2={14} y2={8} />
      <Line x1={18} y1={8} x2={20} y2={8} />
      <Line x1={4} y1={16} x2={8} y2={16} />
      <Line x1={12} y1={16} x2={20} y2={16} />
      <Circle cx={16} cy={8} r={2} />
      <Circle cx={10} cy={16} r={2} />
    </Base>
  )
}

export function CloseIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M18 6L6 18" />
      <Path d="M6 6l12 12" />
    </Base>
  )
}

export function MoreIcon(p: IconProps) {
  const theme = useTheme()
  const {size = 24, color = theme.palette.text} = p
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx={5} cy={12} r={1.6} />
      <Circle cx={12} cy={12} r={1.6} />
      <Circle cx={19} cy={12} r={1.6} />
    </Svg>
  )
}

export function ReplyIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M9 14L4 9l5-5" />
      <Path d="M4 9h10a6 6 0 0 1 6 6v3" />
    </Base>
  )
}

export function RepostIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M17 1l4 4-4 4" />
      <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <Path d="M7 23l-4-4 4-4" />
      <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Base>
  )
}

export function HeartIcon(p: IconProps) {
  const theme = useTheme()
  const {filled, size = 24, color = theme.palette.text} = p
  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
      </Svg>
    )
  }
  return (
    <Base size={size} color={color}>
      <Path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
    </Base>
  )
}

export function SmileIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <Line x1={9} y1={9.5} x2={9} y2={9.6} />
      <Line x1={15} y1={9.5} x2={15} y2={9.6} />
    </Base>
  )
}

export function StarIcon(p: IconProps) {  return (
    <Base {...p}>
      <Path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
    </Base>
  )
}

export function CheckIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M20 6L9 17l-5-5" />
    </Base>
  )
}

export function GlobeIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M3 12h18" />
      <Path d="M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
    </Base>
  )
}

export function LockIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Base>
  )
}

export function AtIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={12} r={4} />
      <Path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.2 7.3" />
    </Base>
  )
}

export function PollIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Line x1={6} y1={20} x2={6} y2={14} />
      <Line x1={12} y1={20} x2={12} y2={8} />
      <Line x1={18} y1={20} x2={18} y2={4} />
    </Base>
  )
}

export function ScheduleIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </Base>
  )
}

export function MediaIcon(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <Circle cx={8.5} cy={8.5} r={1.5} />
      <Path d="M21 15l-5-5L5 21" />
    </Base>
  )
}
