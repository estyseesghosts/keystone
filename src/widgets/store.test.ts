import {createMemoryStore, type KeyValueStore} from '@keystone/fedi'

import {
  defaultWidgetsConfig,
  instancesForLayout,
  PLACEHOLDER_WIDGET_TYPE,
  RAIL_LAYOUT_ID,
  WIDGETS_CONFIG_VERSION,
  type WidgetConfig,
} from './model'
import {createWidgetsStore, WIDGETS_CONFIG_KEY, type WidgetsStore} from './store'

function setup(seed?: Record<string, string>): {storage: KeyValueStore; store: WidgetsStore} {
  const storage = createMemoryStore(seed)
  return {storage, store: createWidgetsStore(() => storage)}
}

function railIds(store: WidgetsStore): string[] {
  return instancesForLayout(store.get(), RAIL_LAYOUT_ID).map(i => i.id)
}

describe('widgets store defaults + hydration', () => {
  it('serves the two default placeholders on first run without writing yet', () => {
    const {storage, store} = setup()
    expect(railIds(store)).toEqual(['widget-placeholder-1', 'widget-placeholder-2'])
    // Lazy seed: first run renders defaults from memory; nothing persists
    // until the first mutation, so "never configured" stays distinguishable.
    expect(storage.getItem(WIDGETS_CONFIG_KEY)).toBeNull()
  })

  it('hydrates a saved config instead of the defaults', () => {
    const saved: WidgetConfig = {
      version: WIDGETS_CONFIG_VERSION,
      instances: [{id: 'w-kept', type: PLACEHOLDER_WIDGET_TYPE, settings: {}}],
      layouts: [{id: RAIL_LAYOUT_ID, placements: [{instanceId: 'w-kept'}]}],
    }
    const {store} = setup({[WIDGETS_CONFIG_KEY]: JSON.stringify(saved)})
    expect(store.get()).toEqual(saved)
  })

  it('falls back to defaults on a corrupt stored blob', () => {
    const {store} = setup({[WIDGETS_CONFIG_KEY]: '{bad'})
    expect(store.get()).toEqual(defaultWidgetsConfig())
  })

  it('falls back to defaults on an unknown stored version', () => {
    const {store} = setup({
      [WIDGETS_CONFIG_KEY]: JSON.stringify({version: 999, instances: [], layouts: []}),
    })
    expect(store.get()).toEqual(defaultWidgetsConfig())
  })
})

describe('widgets store mutations', () => {
  it('adds a widget with a fresh stable ID and persists the config', () => {
    const {storage, store} = setup()
    const created = store.addWidget(PLACEHOLDER_WIDGET_TYPE)
    expect(created.type).toBe(PLACEHOLDER_WIDGET_TYPE)
    expect(railIds(store)).toEqual([
      'widget-placeholder-1',
      'widget-placeholder-2',
      created.id,
    ])
    // Stable through rerenders: same object, same IDs.
    expect(railIds(store)).toEqual([
      'widget-placeholder-1',
      'widget-placeholder-2',
      created.id,
    ])
    const persisted = storage.getItem(WIDGETS_CONFIG_KEY)
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted ?? '')).toEqual(store.get())
  })

  it('generates distinct IDs for duplicate adds of one type', () => {
    const {store} = setup()
    const a = store.addWidget(PLACEHOLDER_WIDGET_TYPE)
    const b = store.addWidget(PLACEHOLDER_WIDGET_TYPE)
    expect(a.id).not.toBe(b.id)
    expect(railIds(store)).toHaveLength(4)
  })

  it('throws on an unknown widget type and persists nothing', () => {
    const {storage, store} = setup()
    expect(() => store.addWidget('deck-clock')).toThrow('Unknown widget type: deck-clock')
    expect(storage.getItem(WIDGETS_CONFIG_KEY)).toBeNull()
  })

  it('removes a widget and persists the slimmer layout', () => {
    const {storage, store} = setup()
    store.removeWidget('widget-placeholder-1')
    expect(railIds(store)).toEqual(['widget-placeholder-2'])
    expect(JSON.parse(storage.getItem(WIDGETS_CONFIG_KEY) ?? '')).toEqual(store.get())
  })

  it('persists an intentionally-emptied rail as empty across reloads', () => {
    const {storage, store} = setup()
    store.removeWidget('widget-placeholder-1')
    store.removeWidget('widget-placeholder-2')
    expect(railIds(store)).toEqual([])
    // A fresh store over the same storage reads the emptied config — the
    // two defaults are never reseeded after the user empties the rail.
    const reloaded = createWidgetsStore(() => storage)
    expect(instancesForLayout(reloaded.get(), RAIL_LAYOUT_ID)).toEqual([])
    expect(reloaded.get().instances).toEqual([])
  })

  it('reorders the rail without changing instance IDs or settings', () => {
    const {store} = setup()
    store.moveWidget('widget-placeholder-2', 0)
    expect(railIds(store)).toEqual(['widget-placeholder-2', 'widget-placeholder-1'])
    expect(store.get().instances).toEqual(defaultWidgetsConfig().instances)
  })

  it('notifies subscribers once per mutation', () => {
    const {store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    const created = store.addWidget(PLACEHOLDER_WIDGET_TYPE)
    expect(listener).toHaveBeenCalledTimes(1)
    store.moveWidget(created.id, 0)
    expect(listener).toHaveBeenCalledTimes(2)
    store.removeWidget(created.id)
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
