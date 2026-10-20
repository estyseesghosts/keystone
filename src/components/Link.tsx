import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

export type LinkProps = {
  label: string
  onPress: () => void
  testID?: string
}

// Inline text link. Destinations resolve in the shell (slice 1.5);
// this component only handles the press.
export function Link({label, onPress, testID}: LinkProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}>
      <Body style={{textDecorationLine: 'underline'}}>{label}</Body>
    </Pressable>
  )
}
