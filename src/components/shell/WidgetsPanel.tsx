import {useState} from 'react'
import {Platform, ScrollView, StyleSheet, View, type ViewStyle} from 'react-native'
import {msg, t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {butterflyPx} from '#/alf/tokens'
import {Body, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import {Tooltip} from '#/components/Tooltip'
import {CollapseIcon, ExpandIcon, PencilIcon} from '#/components/icons'
import {useI18n} from '#/locale/i18n'
import {hideWidgetsPanel, showWidgetsPanel} from '#/state/widgetsPanel'
import {instancesForLayout, RAIL_LAYOUT_ID} from '#/widgets/model'
import {useWidgetsConfig, widgetsStore, type WidgetsStore} from '#/widgets/store'
import {WidgetRenderer} from '#/widgets/WidgetRenderer'
import {WidgetsEditor} from './WidgetsEditor'

// --- Widgets panel host (polish/2-shell, editor in slice 4) ----------------
// Shell-level layout host for the widget rail. It owns rail chrome only
// (region label + edit/collapse controls) and renders the configured
// placements in order through the shared `WidgetRenderer` — it never imports
// a widget component directly, and widget code must NOT import this file
// (the rail is one host, not the widget system: `docs/visual-polish.md`
// Deliverable 3). Widget bodies are never fabricated: each type renders
// its own honest empty state, and an intentionally-emptied rail renders a
// designed empty state with a route back to the editor. Collapsing the rail
// only flips visibility state — config is untouched, so the arrangement
// survives collapse/restore. The body scrolls inside the rail (a `ScrollView`
// sibling to the feed column), so long widget lists never break feed scroll.
export function WidgetsPanel({store = widgetsStore}: {store?: WidgetsStore} = {}) {
  const alf = useAlfTheme()
  const i18n = useI18n()
  const config = useWidgetsConfig(store)
  const instances = instancesForLayout(config, RAIL_LAYOUT_ID)
  const [editorOpen, setEditorOpen] = useState(false)
  const openEditor = () => setEditorOpen(true)
  const closeEditor = () => setEditorOpen(false)
  // Icon-only chrome: hover names the control (supplemental — the
  // accessibility labels below stay the source of truth for touch and
  // keyboard). Slice-2 restore-placement review (polish/5): the
  // trailing-edge slot stays — it mounts only where the panel would
  // auto-show, so there is no reserved column and no IA change; the
  // tooltip below is the polish it needed.
  const editLabel = i18n._(msg`Edit widgets`)
  const collapseLabel = i18n._(msg`Collapse widgets panel`)
  return (
    <View testID="widgets-panel" style={[styles.panel, {borderStartColor: alf.palette.border}]}>
      <View style={styles.header}>
        <Heading style={styles.title}>{t`Widgets`}</Heading>
        <View style={styles.headerActions}>
          <Tooltip label={editLabel}>
            <Pressable
              onPress={openEditor}
              accessibilityRole="button"
              accessibilityLabel={editLabel}
              testID="widgets-panel-edit"
              style={styles.toggle}>
              <PencilIcon size={20} color={alf.palette.text} />
            </Pressable>
          </Tooltip>
          <Tooltip label={collapseLabel}>
            <Pressable
              onPress={hideWidgetsPanel}
              accessibilityRole="button"
              accessibilityLabel={collapseLabel}
              testID="widgets-panel-collapse"
              style={styles.toggle}>
              <CollapseIcon size={20} color={alf.palette.text} />
            </Pressable>
          </Tooltip>
        </View>
      </View>
      <ScrollView testID="widgets-panel-body" style={styles.body}>
        {instances.map(instance => (
          <WidgetRenderer key={instance.id} instance={instance} />
        ))}
        {instances.length === 0 ? (
          <View testID="widgets-panel-empty" style={styles.empty}>
            <Body color="muted" style={styles.emptyText}>{t`No widgets yet.`}</Body>
            <Button
              variant="secondary"
              compact
              label={i18n._(msg`Edit widgets`)}
              testID="widgets-panel-empty-edit"
              onPress={openEditor}
            />
          </View>
        ) : null}
      </ScrollView>
      <WidgetsEditor open={editorOpen} onClose={closeEditor} store={store} />
    </View>
  )
}

// Trailing-edge restore control, mounted only when the panel is manually
// hidden at a width where it would otherwise show (see `Navigation`). At
// narrow widths nothing mounts — zero layout width, no blank reserved
// column, no squeeze.
export function WidgetsPanelRestore() {
  const alf = useAlfTheme()
  const restoreLabel = t`Show widgets panel`
  return (
    <View style={styles.restoreSlot}>
      <Tooltip label={restoreLabel}>
        <Pressable
          onPress={showWidgetsPanel}
          accessibilityRole="button"
          accessibilityLabel={restoreLabel}
          testID="widgets-panel-restore"
          style={styles.toggle}>
          <ExpandIcon size={20} color={alf.palette.text} />
        </Pressable>
      </Tooltip>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    flexShrink: 0,
    width: butterflyPx.widgetsPanelWidth,
    borderStartWidth: 1,
    padding: 16,
    ...Platform.select({
      web: {position: 'sticky', top: 0, height: '100vh'} as unknown as ViewStyle,
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  body: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyText: {
    textAlign: 'center',
  },
  title: {
    fontWeight: '700',
    fontSize: 20,
  },
  toggle: {
    padding: 4,
    borderRadius: 8,
  },
  restoreSlot: {
    flexShrink: 0,
    paddingTop: 16,
    paddingEnd: 12,
  },
})
