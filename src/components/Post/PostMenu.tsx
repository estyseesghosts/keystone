// Note-options menu UI (slice 4.2): trigger + modal list over the pure
// model in ./postMenu. Tier 1 = note menu; "User" opens tier 2. Disabled
// rows show their reason; Delete asks first. Errors surface via Toast.

import {useRef, useState} from 'react'
import {StyleSheet, View, type View as ViewType} from 'react-native'

import {atoms} from '#/alf/atoms'
import {radius, space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {AnchoredPopup} from '#/components/Popup'
import {Divider} from '#/components/Divider'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'

import type {PostMenuItem, PostMenuSection} from './menuModel'

const styles = StyleSheet.create({
  row: {paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md},
  rowDisabled: {opacity: 0.5},
})

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong.'
}

export function PostMenu({
  sections,
  postId,
  label = 'More options',
  trigger,
}: {
  sections: PostMenuSection[]
  postId: string
  label?: string
  /** Custom trigger (v1 ⋯ action). Defaults to a secondary Button. */
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [tier2, setTier2] = useState<PostMenuSection[] | null>(null)
  const [confirming, setConfirming] = useState<PostMenuItem | null>(null)
  const anchor = useRef<ViewType | null>(null)
  const id = `post-menu-${postId}`

  const close = () => {
    setOpen(false)
    setTier2(null)
    setConfirming(null)
  }

  const exec = (item: PostMenuItem) => {
    close()
    try {
      const r = item.run?.()
      if (r && typeof (r as Promise<void>).catch === 'function') {
        ;(r as Promise<void>).catch(e => showToast(errorMessage(e)))
      }
    } catch (e) {
      showToast(errorMessage(e))
    }
  }

  const select = (item: PostMenuItem) => {
    if (item.disabled) return
    if (item.submenu) return setTier2(item.submenu)
    if (item.confirm) return setConfirming(item)
    exec(item)
  }

  const shown = tier2 ?? sections
  return (
    <>
      <View ref={anchor} collapsable={false}>
        {trigger ? (
          <Pressable
            testID={id}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => setOpen(true)}>
            {trigger}
          </Pressable>
        ) : (
          <Button testID={id} label={label} variant="secondary" onPress={() => setOpen(true)} />
        )}
      </View>
      {open ? (
        <AnchoredPopup anchor={anchor} onClose={close} testID={`${id}-dialog`}>
          {confirming ? (
            <View style={atoms.gap_sm}>
              <Body>{confirming.confirm!.title}</Body>
              <Button
                testID={`${id}-confirm`}
                label={confirming.confirm!.action}
                variant="secondary"
                onPress={() => exec(confirming)}
              />
              <Button testID={`${id}-cancel`} label="Cancel" variant="secondary" onPress={() => setConfirming(null)} />
            </View>
          ) : (
            <View style={atoms.gap_sm}>
              {tier2 && (
                <Pressable
                  testID={`${id}-back`}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  onPress={() => setTier2(null)}
                  style={styles.row}>
                  <Body>Back</Body>
                </Pressable>
              )}
              {shown.map((section, i) =>
                section.length === 0 ? null : (
                  <View key={i} style={atoms.gap_sm}>
                    {i > 0 && <Divider />}
                    {section.map(item => (
                      <Pressable
                        key={item.key}
                        testID={`${id}-item-${item.key}`}
                        disabled={item.disabled}
                        accessibilityRole="menuitem"
                        accessibilityState={{disabled: !!item.disabled}}
                        accessibilityLabel={item.disabled && item.reason ? `${item.label}. ${item.reason}` : item.label}
                        onPress={() => select(item)}
                        style={[styles.row, item.disabled && styles.rowDisabled]}>
                        <Body>{item.submenu ? `${item.label} ›` : item.label}</Body>
                        {item.disabled && item.reason ? <Caption color="faint">{item.reason}</Caption> : null}
                      </Pressable>
                    ))}
                  </View>
                ),
              )}
            </View>
          )}
        </AnchoredPopup>
      ) : null}
    </>
  )
}
