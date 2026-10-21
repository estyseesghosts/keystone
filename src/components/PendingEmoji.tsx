import {View} from 'react-native'

import {useTheme} from '#/alf/index'

// Placeholder for a custom-emoji reaction whose art is not known yet
// (slice 4.1). Fixed 16x16 so the chip never reflows when the art arrives,
// and never the literal `:code:` text.

export const PENDING_EMOJI_SIZE = 16

export function PendingEmoji({testID = 'pending-emoji'}: {testID?: string}) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: PENDING_EMOJI_SIZE,
        height: PENDING_EMOJI_SIZE,
        borderRadius: 4,
        opacity: 0.25,
        backgroundColor: theme.palette.muted,
      }}
    />
  )
}
