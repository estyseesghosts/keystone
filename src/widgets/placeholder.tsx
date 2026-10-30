// Generic empty-placeholder widget (polish/3-widget-core): the only
// widget type in scope. Consistent header + designed empty body, never
// fabricated posts, trends, users, or server data.
//
// Rail-independent: this module imports ALF primitives only — never
// `#/components/shell/*`. Any future host (rail today, deck columns
// later) renders it through the registry + `WidgetRenderer`.

import type {ReactNode} from 'react'
import {StyleSheet, View} from 'react-native'
import {t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {Body, Heading} from '#/alf/typography'

import type {WidgetInstance} from './model'

/** Shared card chrome for placeholder-family widgets: bordered card,
 * header title, body slot. Exported so the renderer's unknown-type
 * fallback stays visually consistent without duplicating styles. */
export function WidgetFrame({
  instanceId,
  title,
  children,
}: {
  instanceId: string
  title: string
  children: ReactNode
}) {
  const alf = useAlfTheme()
  return (
    <View
      testID={`widget-${instanceId}`}
      style={[
        styles.card,
        {borderColor: alf.palette.border, backgroundColor: alf.palette.bgSoft},
      ]}>
      <Heading level={3} style={styles.title}>
        {title}
      </Heading>
      {children}
    </View>
  )
}

export function PlaceholderWidget({instance}: {instance: WidgetInstance}) {
  return (
    <WidgetFrame instanceId={instance.id} title={t`Widget`}>
      <Body color="muted" style={styles.empty}>{t`Nothing here yet.`}</Body>
    </WidgetFrame>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 12,
  },
})
