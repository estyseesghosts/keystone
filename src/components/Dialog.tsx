import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useEffect} from 'react'
import {Animated, Modal, Platform, StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {overlayChrome} from '#/alf/themes'
import {radius, space} from '#/alf/tokens'
import {Heading} from '#/alf/typography'
import {usePopupEnter} from '#/components/Popup'
import {Pressable} from '#/components/Pressable'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  testID?: string
}

// Plain centered modal on all targets. Bottom sheets are deferred
// (owner decision 2026-10-20); this is the only dialog primitive.
export function Dialog({open, onClose, title, children, testID}: DialogProps) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const closeLabel = i18n._(msg`Close dialog`)
  const enter = usePopupEnter()
  // Web keyboard (P8): Escape closes the dialog. Guarded to web with
  // cleanup on unmount; native keeps backdrop tap + `onRequestClose`.
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) {
    return null
  }
  const styles = StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: overlayChrome.backdrop,
      opacity: 0.4,
    },
    sheet: {
      backgroundColor: theme.palette.bg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: theme.palette.border,
      padding: space.lg,
      margin: space.xl,
      gap: space.md,
    },
  })
  return (
    <Modal
      testID={testID}
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}>
      <View style={[atoms.flex1, atoms.centered]}>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={styles.backdrop}
        />
        <Animated.View
          accessibilityLabel={title}
          style={[styles.sheet, {opacity: enter.opacity, transform: [{scale: enter.scale}]}]}>
          <View style={[atoms.row, atoms.itemsCenter, {gap: space.md}]}>
            <View style={atoms.flex1}>
              <Heading>{title}</Heading>
            </View>
            <Pressable
              testID={testID ? `${testID}-close` : undefined}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}>
              <Heading>✕</Heading>
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}
