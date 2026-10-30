// Rail + editor interactions (polish/4-rail-editor): drives the plan's
// acceptance flow — fresh shows two placeholders; the editor adds a third;
// reorder keeps identity; remove keeps order; remove-all survives reload as
// an intentional empty state with a route back to the editor; collapse and
// reopen leave the arrangement unchanged.
//
// All suites use isolated memory stores passed via the `store` prop, so the
// shared `widgetsStore` singleton is never mutated here.

import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen, within} from '@testing-library/react-native'

import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {
  hideWidgetsPanel,
  resetWidgetsPanelMode,
  showWidgetsPanel,
} from '#/state/widgetsPanel'
import {instancesForLayout, RAIL_LAYOUT_ID} from '#/widgets/model'
import {createWidgetsStore, type WidgetsStore} from '#/widgets/store'
import {WidgetsPanel} from './WidgetsPanel'

function setup() {
  const storage: KeyValueStore = createMemoryStore()
  const store: WidgetsStore = createWidgetsStore(() => storage)
  return {storage, store}
}

function renderPanel(store: WidgetsStore) {
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <WidgetsPanel store={store} />
      </ThemeProvider>
    </I18nProvider>,
  )
}

function railTestIds(): (string | undefined)[] {
  const body = within(screen.getByTestId('widgets-panel-body'))
  return body
    .getAllByTestId(/^widget-/)
    .map(el => el.props.testID as string | undefined)
}

function openEditor() {
  fireEvent.press(screen.getByTestId('widgets-panel-edit'))
  expect(screen.getByTestId('widgets-editor')).toBeTruthy()
}

beforeEach(() => {
  resetWidgetsPanelMode()
})

describe('widget rail defaults', () => {
  it('fresh configuration shows exactly two placeholders in order', () => {
    const {store} = setup()
    renderPanel(store)
    expect(railTestIds()).toEqual([
      'widget-widget-placeholder-1',
      'widget-widget-placeholder-2',
    ])
  })

  it('exposes a visible Edit widgets entry point', () => {
    const {store} = setup()
    renderPanel(store)
    expect(screen.getByTestId('widgets-panel-edit')).toBeTruthy()
  })

  it('renders the body as a scroll container inside the rail', () => {
    const {store} = setup()
    renderPanel(store)
    const {ScrollView} = jest.requireActual('react-native')
    const bodies = screen.UNSAFE_queryAllByType(ScrollView).filter(
      el => el.props.testID === 'widgets-panel-body',
    )
    expect(bodies).toHaveLength(1)
  })
})

describe('widget editor', () => {
  it('opens from the rail and lists current instances plus available types', () => {
    const {store} = setup()
    renderPanel(store)
    expect(screen.queryByTestId('widgets-editor')).toBeNull()
    openEditor()
    expect(
      screen.getByTestId('widgets-editor-instance-widget-placeholder-1'),
    ).toBeTruthy()
    expect(
      screen.getByTestId('widgets-editor-instance-widget-placeholder-2'),
    ).toBeTruthy()
    expect(screen.getByTestId('widgets-editor-add-placeholder')).toBeTruthy()
  })

  it('adds a third placeholder with a new unique stable ID, appended last', () => {
    const {store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(screen.getByTestId('widgets-editor-add-placeholder'))
    const ids = railTestIds()
    expect(ids).toHaveLength(3)
    expect(ids.slice(0, 2)).toEqual([
      'widget-widget-placeholder-1',
      'widget-widget-placeholder-2',
    ])
    const created = (ids[2] ?? '').replace(/^widget-/, '')
    expect(created).toBeTruthy()
    expect(created).not.toBe('widget-placeholder-1')
    expect(created).not.toBe('widget-placeholder-2')
    expect(
      screen.getByTestId(`widgets-editor-instance-${created}`),
    ).toBeTruthy()
  })

  it('reorders with move controls keeping instance identity and settings', () => {
    const {store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(screen.getByTestId('widgets-editor-add-placeholder'))
    const before = store.get().instances.map(i => ({...i}))
    const created = instancesForLayout(store.get(), RAIL_LAYOUT_ID).at(-1)?.id
    if (!created) throw new Error('expected a third widget instance')
    // Move the appended widget to the top with two move-ups.
    fireEvent.press(screen.getByTestId(`widgets-editor-move-up-${created}`))
    fireEvent.press(screen.getByTestId(`widgets-editor-move-up-${created}`))
    expect(railTestIds()).toEqual([
      `widget-${created}`,
      'widget-widget-placeholder-1',
      'widget-widget-placeholder-2',
    ])
    // Identity follows the instance: IDs and settings untouched.
    expect(store.get().instances).toEqual(before)
    // Edge buttons disable at the ends; they are never the only path.
    expect(
      screen.getByTestId(`widgets-editor-move-up-${created}`).props
        .accessibilityState,
    ).toMatchObject({disabled: true})
    expect(
      screen.getByTestId('widgets-editor-move-down-widget-placeholder-2')
        .props.accessibilityState,
    ).toMatchObject({disabled: true})
  })

  it('removes one widget and keeps the remaining order', () => {
    const {store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(screen.getByTestId('widgets-editor-add-placeholder'))
    const created = instancesForLayout(store.get(), RAIL_LAYOUT_ID).at(-1)?.id
    if (!created) throw new Error('expected a third widget instance')
    fireEvent.press(
      screen.getByTestId(`widgets-editor-move-up-${created}`),
    )
    fireEvent.press(
      screen.getByTestId('widgets-editor-remove-widget-placeholder-1'),
    )
    // Added third was moved to the middle: [p1, created, p2] minus p1.
    expect(railTestIds()).toEqual([
      `widget-${created}`,
      'widget-widget-placeholder-2',
    ])
  })

  it('closing the editor changes nothing (config separate from open state)', () => {
    const {store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(screen.getByTestId('widgets-editor-add-placeholder'))
    const arranged = railTestIds()
    fireEvent.press(screen.getByTestId('widgets-editor-close'))
    expect(screen.queryByTestId('widgets-editor')).toBeNull()
    expect(railTestIds()).toEqual(arranged)
    // Reopening shows the same arrangement.
    openEditor()
    expect(railTestIds()).toEqual(arranged)
  })
})

describe('intentional empty state', () => {
  it('remove-all shows the empty state with a route back, and reload stays empty', () => {
    const {storage, store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(
      screen.getByTestId('widgets-editor-remove-widget-placeholder-1'),
    )
    fireEvent.press(
      screen.getByTestId('widgets-editor-remove-widget-placeholder-2'),
    )
    expect(screen.getByTestId('widgets-panel-empty')).toBeTruthy()
    expect(screen.getByText('No widgets yet.')).toBeTruthy()
    // The empty state routes back to the editor.
    fireEvent.press(screen.getByTestId('widgets-panel-empty-edit'))
    expect(screen.getByTestId('widgets-editor')).toBeTruthy()
    fireEvent.press(screen.getByTestId('widgets-editor-close'))
    // Reload over the same storage: still intentionally empty, never reseeded.
    const reloaded = createWidgetsStore(() => storage)
    expect(instancesForLayout(reloaded.get(), RAIL_LAYOUT_ID)).toEqual([])
    expect(reloaded.get().instances).toEqual([])
  })
})

describe('collapse preserves configuration', () => {
  it('collapse and reopen leave the arrangement unchanged', () => {
    const {store} = setup()
    renderPanel(store)
    openEditor()
    fireEvent.press(screen.getByTestId('widgets-editor-add-placeholder'))
    fireEvent.press(screen.getByTestId('widgets-editor-close'))
    const arranged = railTestIds()
    expect(arranged).toHaveLength(3)
    // Visibility toggles never touch widget config.
    hideWidgetsPanel()
    showWidgetsPanel()
    expect(instancesForLayout(store.get(), RAIL_LAYOUT_ID).map(i => i.id)).toEqual(
      arranged.map(testID => (testID ?? '').replace(/^widget-/, '')),
    )
    expect(railTestIds()).toEqual(arranged)
  })
})
