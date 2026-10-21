import {useEffect, useRef, useState} from 'react'
import {Platform, StyleSheet, View, type View as ViewType} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
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

/** Next enabled index from `from`, stepping `dir` (±1) with wrap-around.
 * Pure (unit-tested): disabled items are skipped, never landed on. */
export function nextEnabledIndex(items: MenuItem[], from: number, dir: 1 | -1): number {
  if (items.length === 0) return 0
  for (let step = 1; step <= items.length; step++) {
    const idx = (from + dir * step + items.length * items.length) % items.length
    if (!items[idx]?.disabled) return idx
  }
  return from
}

function firstEnabledIndex(items: MenuItem[]): number {
  const idx = items.findIndex(item => !item.disabled)
  return idx === -1 ? 0 : idx
}

// Anchored popup menu (Keystone v1 popup style): the card floats off the
// trigger — below, flipping above near the viewport edge — instead of a
// centered dialog. Unsupported entries render disabled with their reason,
// never inert.
//
// Web keyboard (P8): Up/Down moves across enabled items (roving focus,
// wrap-around), Enter selects, Escape closes. The document listener is
// web-only with cleanup on close/unmount; typing in a field never
// triggers navigation. Native D-pad is tolerant: focus state simply never
// changes there, and every item stays pressable.
export function Menu({label, items, testID, trigger}: MenuProps) {
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const focusRef = useRef(0)
  focusRef.current = focusIdx
  const openRef = useRef(false)
  openRef.current = open
  const itemsRef = useRef(items)
  itemsRef.current = items
  const theme = useTheme()
  const anchor = useRef<ViewType | null>(null)
  const styles = StyleSheet.create({
    row: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      opacity: 1,
    },
    rowDisabled: {opacity: 0.5},
    rowFocused: {backgroundColor: theme.palette.bgSoft},
  })
  useEffect(() => {
    if (open) setFocusIdx(firstEnabledIndex(itemsRef.current))
  }, [open])
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (!openRef.current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
      const t = e.target as {tagName?: string; isContentEditable?: boolean} | null
      const typing =
        !!t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.isContentEditable)
      if (typing) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIdx(prev => nextEnabledIndex(itemsRef.current, prev, e.key === 'ArrowDown' ? 1 : -1))
      } else if (e.key === 'Enter') {
        const item = itemsRef.current[focusRef.current]
        if (item && !item.disabled) {
          e.preventDefault()
          item.onSelect()
          setOpen(false)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
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
            {items.map((item, idx) => (
              <Pressable
                key={item.key}
                testID={testID ? `${testID}-item-${item.key}` : undefined}
                disabled={item.disabled}
                accessibilityRole="menuitem"
                accessibilityState={{disabled: item.disabled, selected: open && idx === focusIdx}}
                accessibilityLabel={
                  item.disabled && item.reason
                    ? `${item.label}. ${item.reason}`
                    : item.label
                }
                onPress={() => {
                  item.onSelect()
                  setOpen(false)
                }}
                style={[
                  styles.row,
                  item.disabled && styles.rowDisabled,
                  open && idx === focusIdx && !item.disabled && styles.rowFocused,
                ]}>
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
