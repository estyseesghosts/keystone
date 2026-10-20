import {useRef, useState} from 'react'
import {StyleSheet, View, type View as ViewType} from 'react-native'

import {atoms} from '#/alf/atoms'
import {radius, space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {AnchoredPopup} from '#/components/Popup'
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
  /** Custom trigger (v1 icon+count action). Defaults to a secondary Button. */
  trigger?: React.ReactNode
}

// Anchored popup menu (Keystone v1 popup style): the card floats off the
// trigger — below, flipping above near the viewport edge — instead of a
// centered dialog. Unsupported entries render disabled with their reason,
// never inert.
export function Menu({label, items, testID, trigger}: MenuProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<ViewType | null>(null)
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
      <View ref={anchor} collapsable={false}>
        {trigger ? (
          <Pressable
            testID={testID}
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={label}>
            {trigger}
          </Pressable>
        ) : (
          <Button
            testID={testID}
            label={label}
            variant="secondary"
            onPress={() => setOpen(true)}
          />
        )}
      </View>
      {open ? (
        <AnchoredPopup anchor={anchor} onClose={() => setOpen(false)} testID={testID}>
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
        </AnchoredPopup>
      ) : null}
    </>
  )
}
