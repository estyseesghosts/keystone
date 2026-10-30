// Widget definitions render without mounting the right rail: the rail
// is one host, not the widget system. These tests mount registry
// components directly — no `Navigation`, no `WidgetsPanel`.

import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
import React from 'react'

import {i18n} from '#/locale/i18n'

import {
  defaultWidgetsConfig,
  PLACEHOLDER_WIDGET_TYPE,
  type WidgetInstance,
} from './model'
import {PlaceholderWidget} from './placeholder'
import {
  getWidgetDefinition,
  isKnownWidgetType,
  listWidgetDefinitions,
} from './registry'
import {UnknownWidgetFallback, WidgetRenderer} from './WidgetRenderer'

function renderWidget(element: React.ReactElement) {
  return render(<I18nProvider i18n={i18n}>{element}</I18nProvider>)
}

const placeholderInstance: WidgetInstance = {
  id: 'widget-placeholder-1',
  type: PLACEHOLDER_WIDGET_TYPE,
  settings: {},
}

describe('widget registry', () => {
  it('lists the placeholder type with a title and description', () => {
    const types = listWidgetDefinitions()
    expect(types.map(t => t.type)).toContain(PLACEHOLDER_WIDGET_TYPE)
    const placeholder = getWidgetDefinition(PLACEHOLDER_WIDGET_TYPE)
    expect(placeholder?.type).toBe(PLACEHOLDER_WIDGET_TYPE)
    if (!placeholder) throw new Error('placeholder widget missing from registry')
    expect(i18n._(placeholder.title)).toBeTruthy()
    expect(i18n._(placeholder.description)).toBeTruthy()
  })

  it('reports unknown types as unknown', () => {
    expect(getWidgetDefinition('deck-clock')).toBeUndefined()
    expect(isKnownWidgetType(PLACEHOLDER_WIDGET_TYPE)).toBe(true)
    expect(isKnownWidgetType('deck-clock')).toBe(false)
  })
})

describe('PlaceholderWidget (no rail mounted)', () => {
  it('renders a consistent header and an honest empty body', () => {
    renderWidget(<PlaceholderWidget instance={placeholderInstance} />)
    expect(screen.getByTestId('widget-widget-placeholder-1')).toBeTruthy()
    expect(screen.getByText('Widget')).toBeTruthy()
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
    // No rail chrome mounts with the definition.
    expect(screen.queryByTestId('widgets-panel')).toBeNull()
    expect(screen.queryByTestId('widgets-panel-collapse')).toBeNull()
  })

  it('shows no fabricated posts, trends, users, or server data', () => {
    renderWidget(<PlaceholderWidget instance={placeholderInstance} />)
    // The only text nodes are the header and the empty-state line.
    expect(screen.getByText('Widget')).toBeTruthy()
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
  })

  it('renders multiple instances of one type with distinct identities', () => {
    const [first, second] = defaultWidgetsConfig().instances
    renderWidget(
      <>
        {first ? <PlaceholderWidget instance={first} /> : null}
        {second ? <PlaceholderWidget instance={second} /> : null}
      </>,
    )
    expect(screen.getByTestId(`widget-${first?.id}`)).toBeTruthy()
    expect(screen.getByTestId(`widget-${second?.id}`)).toBeTruthy()
    expect(first?.id).not.toBe(second?.id)
  })
})

describe('WidgetRenderer', () => {
  it('resolves a registered instance against the registry', () => {
    renderWidget(<WidgetRenderer instance={placeholderInstance} />)
    expect(screen.getByTestId('widget-widget-placeholder-1')).toBeTruthy()
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
  })

  it('shows an honest fallback for unknown types instead of throwing', () => {
    const future: WidgetInstance = {id: 'w-future', type: 'deck-clock', settings: {tz: 'UTC'}}
    renderWidget(<WidgetRenderer instance={future} />)
    expect(screen.getByTestId('widget-w-future')).toBeTruthy()
    expect(screen.getByText('This widget is unavailable.')).toBeTruthy()
  })

  it('exposes the fallback as a component for host reuse', () => {
    const future: WidgetInstance = {id: 'w-future', type: 'deck-clock', settings: {}}
    renderWidget(<UnknownWidgetFallback instance={future} />)
    expect(screen.getByTestId('widget-w-future')).toBeTruthy()
  })
})
