// Widget editor (polish/4-rail-editor): a `Dialog`-based editor for the
// right rail's widget layout. It lists current instances in placement
// order (with accessible move-up/move-down + remove controls) and the
// available types from the registry (with add controls).
//
// Shell-level host UI: it resolves instances through the registry for
// display titles but never owns widget components, and it drives the
// persisted store (`addWidget`/`removeWidget`/`moveWidget`) directly, so
// every change persists and restores on reload. Editor open/closed state
// is owned by the caller (the rail holds it in local state); rail
// visibility (`src/state/widgetsPanel.ts`) is a third, independent state.
// Only move buttons reorder — the repo has no established cross-platform
// drag-and-drop list primitive (no `PanResponder`/gesture/reanimated usage
// anywhere in `src/`), and the plan requires an accessible non-drag method
// regardless, so no DnD dependency is added.

import {msg, t} from '@lingui/macro'
import {StyleSheet, View} from 'react-native'

import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {useI18n} from '#/locale/i18n'
import {instancesForLayout, RAIL_LAYOUT_ID, type WidgetInstance} from '#/widgets/model'
import {getWidgetDefinition, listWidgetDefinitions} from '#/widgets/registry'
import {useWidgetsConfig, widgetsStore, type WidgetsStore} from '#/widgets/store'

export function WidgetsEditor({
  open,
  onClose,
  store = widgetsStore,
}: {
  open: boolean
  onClose: () => void
  store?: WidgetsStore
}) {
  const i18n = useI18n()
  const config = useWidgetsConfig(store)
  const instances = instancesForLayout(config, RAIL_LAYOUT_ID)
  const definitions = listWidgetDefinitions()
  const titleFor = (instance: WidgetInstance): string => {
    const definition = getWidgetDefinition(instance.type)
    if (!definition) return i18n._(msg`Widget`)
    return i18n._(definition.title)
  }
  return (
    <Dialog open={open} onClose={onClose} title={i18n._(msg`Edit widgets`)} testID="widgets-editor">
      <View style={styles.section}>
        <Heading level={3} style={styles.sectionTitle}>
          {t`Current widgets`}
        </Heading>
        {instances.length === 0 ? (
          <Body color="muted" testID="widgets-editor-empty">{t`No widgets yet. Add one below.`}</Body>
        ) : (
          instances.map((instance, index) => (
            <View
              key={instance.id}
              testID={`widgets-editor-instance-${instance.id}`}
              style={styles.row}>
              <View style={styles.rowText}>
                <Body numberOfLines={1}>{titleFor(instance)}</Body>
                <Caption color="faint" numberOfLines={1}>
                  {instance.id}
                </Caption>
              </View>
              <View style={styles.rowActions}>
                <Button
                  compact
                  variant="secondary"
                  label={i18n._(msg`Move up`)}
                  testID={`widgets-editor-move-up-${instance.id}`}
                  disabled={index === 0}
                  onPress={() => store.moveWidget(instance.id, index - 1)}
                />
                <Button
                  compact
                  variant="secondary"
                  label={i18n._(msg`Move down`)}
                  testID={`widgets-editor-move-down-${instance.id}`}
                  disabled={index === instances.length - 1}
                  onPress={() => store.moveWidget(instance.id, index + 1)}
                />
                <Button
                  compact
                  variant="secondary"
                  label={i18n._(msg`Remove`)}
                  testID={`widgets-editor-remove-${instance.id}`}
                  onPress={() => store.removeWidget(instance.id)}
                />
              </View>
            </View>
          ))
        )}
      </View>
      <View style={styles.section}>
        <Heading level={3} style={styles.sectionTitle}>
          {t`Add widgets`}
        </Heading>
        {definitions.map(definition => (
          <View key={definition.type} style={styles.row}>
            <View style={styles.rowText}>
              <Body numberOfLines={1}>{i18n._(definition.title)}</Body>
              <Caption color="muted" numberOfLines={2}>
                {i18n._(definition.description)}
              </Caption>
            </View>
            <Button
              compact
              label={i18n._(msg`Add`)}
              testID={`widgets-editor-add-${definition.type}`}
              onPress={() => store.addWidget(definition.type)}
            />
          </View>
        ))}
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
})
