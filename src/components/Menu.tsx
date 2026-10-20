import {useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Pressable} from '#/components/Pressable'

export type MenuItem = {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
  reason?: string
}

export type MenuProps = {
  label: string
  items: MenuItem[]
  testID?: string
}

// Simple modal menu. No popover positioning, no bottom sheet (deferred).
// Unsupported entries render disabled with their reason, never inert.
export function Menu({label, items, testID}: MenuProps) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const styles = StyleSheet.create({
    row: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      opacity: 1,
    },
    rowDisabled: {opacity: 0.5},
  })
  return (
    <>
      <Button
        testID={testID}
        label={label}
        variant="secondary"
        onPress={() => setOpen(true)}
      />
      <Dialog
        testID={testID ? `${testID}-dialog` : undefined}
        open={open}
        onClose={() => setOpen(false)}
        title={label}>
        <View style={atoms.gap_sm}>
          {items.map(item => (
            <Pressable
              key={item.key}
              testID={testID ? `${testID}-item-${item.key}` : undefined}
              disabled={item.disabled}
              accessibilityRole="menuitem"
              accessibilityState={{disabled: item.disabled}}
              accessibilityLabel={
                item.disabled && item.reason
                  ? `${item.label}. ${item.reason}`
                  : item.label
              }
              onPress={() => {
                item.onSelect()
                setOpen(false)
              }}
              style={[styles.row, item.disabled && styles.rowDisabled]}>
              <Body>{item.label}</Body>
              {item.disabled && item.reason ? (
                <Caption color="faint">{item.reason}</Caption>
              ) : null}
            </Pressable>
          ))}
        </View>
      </Dialog>
    </>
  )
}
