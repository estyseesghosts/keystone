import {msg} from '@lingui/macro'
import {useRef} from 'react'
import {Animated, Modal, StyleSheet, View, type View as ViewType} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {overlayChrome} from '#/alf/themes'
import {radius, space} from '#/alf/tokens'
import {Heading} from '#/alf/typography'
import {usePopupEnter} from '#/components/Popup'
import {Pressable} from '#/components/Pressable'
import {useKeyboardLayer} from '#/components/keyboardLayer'
import {useModalFocus} from '#/components/modalFocus'
import {useI18n} from '#/locale/i18n'

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
  const i18n = useI18n()
  const closeLabel = i18n._(msg`Close dialog`)
  const enter = usePopupEnter()
  const sheetRef = useRef<ViewType | null>(null)
  // Web keyboard (P8, repair X10.1): Escape closes via the single shared
  // layer stack — a Menu open inside this Dialog is the top layer and
  // consumes the first Escape, so stacked layers never close together.
  // Native keeps backdrop tap + `onRequestClose`.
  useKeyboardLayer(open, e => {
    if (e.key === 'Escape') onClose()
  })
  // Focus moves into the sheet on open and returns to the opener on close
  // (web only; native keeps its own focus).
  useModalFocus(open, sheetRef)
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
      <View
        style={[atoms.flex1, atoms.centered]}
        accessibilityViewIsModal
        role="dialog"
        aria-modal>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={styles.backdrop}
        />
        <Animated.View
          ref={sheetRef}
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
