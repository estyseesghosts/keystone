import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {Modal, StyleSheet, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Heading} from '#/alf/typography'
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
  if (!open) {
    return null
  }
  const styles = StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: '#000000',
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
      animationType="fade"
      onRequestClose={onClose}>
      <View style={[atoms.flex1, atoms.centered]}>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={styles.backdrop}
        />
        <View accessibilityLabel={title} style={styles.sheet}>
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
        </View>
      </View>
    </Modal>
  )
}
