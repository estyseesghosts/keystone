// Widget type registry (polish/3-widget-core): the source of truth for
// available widget types. The future editor lists types from here; the
// renderer resolves instances against it.
//
// Rail-independent: definitions reference widget components only — never
// `#/components/shell/*`. The rail imports the renderer, never a widget
// component directly.

import type {MessageDescriptor} from '@lingui/core'
import {msg} from '@lingui/macro'
import type {ComponentType} from 'react'

import {PLACEHOLDER_WIDGET_TYPE, type WidgetInstance} from './model'
import {PlaceholderWidget} from './placeholder'

export interface WidgetDefinition {
  /** Stable type ID, stored on instances. Never rename a shipped ID —
   * persisted configs reference it. */
  type: string
  /** Display title for headers and the editor's type list. Rendered via
   * `i18n._()` at call time so the app locale applies. */
  title: MessageDescriptor
  /** One-line description for the editor's type list. */
  description: MessageDescriptor
  Component: ComponentType<{instance: WidgetInstance}>
}

const definitions: readonly WidgetDefinition[] = [
  {
    type: PLACEHOLDER_WIDGET_TYPE,
    title: msg`Widget`,
    description: msg`An empty placeholder. Real widgets will plug in here later.`,
    Component: PlaceholderWidget,
  },
]

const byType: Readonly<Record<string, WidgetDefinition>> = Object.fromEntries(
  definitions.map(definition => [definition.type, definition]),
)

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return byType[type]
}

export function isKnownWidgetType(type: string): boolean {
  return getWidgetDefinition(type) !== undefined
}

/** Available types in registry order. The editor (slice 4) lists these. */
export function listWidgetDefinitions(): WidgetDefinition[] {
  return [...definitions]
}
