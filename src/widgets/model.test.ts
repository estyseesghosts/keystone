import {
  addWidgetInstance,
  defaultWidgetsConfig,
  instancesForLayout,
  moveWidgetPlacement,
  newWidgetId,
  parseWidgetsConfig,
  PLACEHOLDER_WIDGET_TYPE,
  RAIL_LAYOUT_ID,
  removeWidgetPlacement,
  WIDGETS_CONFIG_VERSION,
  type WidgetConfig,
} from './model'

function configWithSecondLayout(): WidgetConfig {
  const base = defaultWidgetsConfig()
  return {
    ...base,
    layouts: [
      ...base.layouts,
      {id: 'deck-col-a', placements: [{instanceId: 'widget-placeholder-1'}]},
    ],
  }
}

describe('defaultWidgetsConfig', () => {
  it('seeds two distinct placeholder instances with different stable IDs', () => {
    const config = defaultWidgetsConfig()
    expect(config.version).toBe(WIDGETS_CONFIG_VERSION)
    expect(config.instances).toHaveLength(2)
    const [first, second] = config.instances
    expect(first?.type).toBe(PLACEHOLDER_WIDGET_TYPE)
    expect(second?.type).toBe(PLACEHOLDER_WIDGET_TYPE)
    expect(first?.id).toBeTruthy()
    expect(second?.id).toBeTruthy()
    expect(first?.id).not.toBe(second?.id)
  })

  it('orders the rail layout by placement references, not components', () => {
    const config = defaultWidgetsConfig()
    const rail = config.layouts.find(l => l.id === RAIL_LAYOUT_ID)
    expect(rail?.placements.map(p => p.instanceId)).toEqual(
      config.instances.map(i => i.id),
    )
  })

  it('returns fresh objects per call (no shared mutable seed)', () => {
    const a = defaultWidgetsConfig()
    const b = defaultWidgetsConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.instances).not.toBe(b.instances)
  })
})

describe('newWidgetId', () => {
  it('generates unique IDs that never collide with the fixed defaults', () => {
    const ids = new Set([newWidgetId(), newWidgetId(), newWidgetId(1234567890)])
    expect(ids.size).toBe(3)
    for (const id of ids) {
      expect(defaultWidgetsConfig().instances.map(i => i.id)).not.toContain(id)
    }
  })
})

describe('addWidgetInstance', () => {
  it('appends the instance and its rail placement', () => {
    const config = addWidgetInstance(defaultWidgetsConfig(), PLACEHOLDER_WIDGET_TYPE, 'w-new-1')
    expect(config.instances).toHaveLength(3)
    expect(config.instances[2]).toEqual({id: 'w-new-1', type: PLACEHOLDER_WIDGET_TYPE, settings: {}})
    const rail = config.layouts.find(l => l.id === RAIL_LAYOUT_ID)
    expect(rail?.placements.map(p => p.instanceId)).toEqual([
      'widget-placeholder-1',
      'widget-placeholder-2',
      'w-new-1',
    ])
  })

  it('allows multiple instances of one type', () => {
    let config = defaultWidgetsConfig()
    config = addWidgetInstance(config, PLACEHOLDER_WIDGET_TYPE, 'w-a')
    config = addWidgetInstance(config, PLACEHOLDER_WIDGET_TYPE, 'w-b')
    expect(config.instances.filter(i => i.type === PLACEHOLDER_WIDGET_TYPE)).toHaveLength(4)
  })

  it('does not mutate its input', () => {
    const base = defaultWidgetsConfig()
    const snapshot = JSON.parse(JSON.stringify(base))
    addWidgetInstance(base, PLACEHOLDER_WIDGET_TYPE, 'w-new-1')
    expect(base).toEqual(snapshot)
  })

  it('is a no-op on a colliding ID (uniqueness survives double-submits)', () => {
    const base = defaultWidgetsConfig()
    expect(addWidgetInstance(base, PLACEHOLDER_WIDGET_TYPE, 'widget-placeholder-1')).toBe(base)
  })
})

describe('removeWidgetPlacement', () => {
  it('removes the layout placement and drops the now-unreferenced instance', () => {
    const config = removeWidgetPlacement(defaultWidgetsConfig(), RAIL_LAYOUT_ID, 'widget-placeholder-1')
    expect(config.instances.map(i => i.id)).toEqual(['widget-placeholder-2'])
    const rail = config.layouts.find(l => l.id === RAIL_LAYOUT_ID)
    expect(rail?.placements.map(p => p.instanceId)).toEqual(['widget-placeholder-2'])
  })

  it('keeps an instance still referenced by another layout', () => {
    const config = removeWidgetPlacement(
      configWithSecondLayout(),
      RAIL_LAYOUT_ID,
      'widget-placeholder-1',
    )
    // Gone from the rail, but the deck column still references it.
    const rail = config.layouts.find(l => l.id === RAIL_LAYOUT_ID)
    expect(rail?.placements.map(p => p.instanceId)).toEqual(['widget-placeholder-2'])
    expect(config.instances.map(i => i.id)).toContain('widget-placeholder-1')
  })

  it('is a no-op for an unknown ID', () => {
    const base = defaultWidgetsConfig()
    const next = removeWidgetPlacement(base, RAIL_LAYOUT_ID, 'w-nope')
    expect(next).toEqual(base)
  })
})

describe('moveWidgetPlacement', () => {
  it('reorders placements without changing instance IDs or settings', () => {
    let config = defaultWidgetsConfig()
    config = addWidgetInstance(config, PLACEHOLDER_WIDGET_TYPE, 'w-third', {label: 'C'})
    const next = moveWidgetPlacement(config, RAIL_LAYOUT_ID, 2, 0)
    const rail = next.layouts.find(l => l.id === RAIL_LAYOUT_ID)
    expect(rail?.placements.map(p => p.instanceId)).toEqual([
      'w-third',
      'widget-placeholder-1',
      'widget-placeholder-2',
    ])
    // Identity and settings travel with the instance.
    expect(next.instances.find(i => i.id === 'w-third')).toEqual({
      id: 'w-third',
      type: PLACEHOLDER_WIDGET_TYPE,
      settings: {label: 'C'},
    })
  })

  it('is a no-op for out-of-range indices or an unknown layout', () => {
    const base = defaultWidgetsConfig()
    expect(moveWidgetPlacement(base, RAIL_LAYOUT_ID, 7, 0)).toEqual(base)
    expect(moveWidgetPlacement(base, RAIL_LAYOUT_ID, 0, 0)).toEqual(base)
    expect(moveWidgetPlacement(base, 'deck-col-missing', 0, 1)).toEqual(base)
  })
})

describe('instancesForLayout', () => {
  it('resolves rail instances in placement order', () => {
    const config = moveWidgetPlacement(defaultWidgetsConfig(), RAIL_LAYOUT_ID, 1, 0)
    expect(instancesForLayout(config, RAIL_LAYOUT_ID).map(i => i.id)).toEqual([
      'widget-placeholder-2',
      'widget-placeholder-1',
    ])
  })

  it('skips dangling placements and misses layouts as empty', () => {
    const base = defaultWidgetsConfig()
    const dangling: WidgetConfig = {
      ...base,
      layouts: [{id: RAIL_LAYOUT_ID, placements: [{instanceId: 'w-ghost'}, {instanceId: 'widget-placeholder-2'}]}],
    }
    expect(instancesForLayout(dangling, RAIL_LAYOUT_ID).map(i => i.id)).toEqual([
      'widget-placeholder-2',
    ])
    expect(instancesForLayout(base, 'deck-col-missing')).toEqual([])
  })
})

describe('parseWidgetsConfig', () => {
  it('seeds defaults when nothing was stored', () => {
    expect(parseWidgetsConfig(null)).toEqual(defaultWidgetsConfig())
  })

  it('falls back to defaults on corrupt JSON, wrong shapes, and unknown versions', () => {
    const defaults = defaultWidgetsConfig()
    expect(parseWidgetsConfig('{bad')).toEqual(defaults)
    expect(parseWidgetsConfig(JSON.stringify(42))).toEqual(defaults)
    expect(parseWidgetsConfig(JSON.stringify({version: 999, instances: [], layouts: []}))).toEqual(
      defaults,
    )
    expect(parseWidgetsConfig(JSON.stringify({version: 1}))).toEqual(defaults)
  })

  it('keeps an intentionally-empty config empty (never reseeds)', () => {
    const emptied: WidgetConfig = {
      version: WIDGETS_CONFIG_VERSION,
      instances: [],
      layouts: [{id: RAIL_LAYOUT_ID, placements: []}],
    }
    expect(parseWidgetsConfig(JSON.stringify(emptied))).toEqual(emptied)
  })

  it('drops malformed entries but keeps the valid rest', () => {
    const parsed = parseWidgetsConfig(
      JSON.stringify({
        version: 1,
        instances: [
          {id: 'w-good', type: PLACEHOLDER_WIDGET_TYPE, settings: {}},
          {id: '', type: PLACEHOLDER_WIDGET_TYPE},
          {type: PLACEHOLDER_WIDGET_TYPE},
          'junk',
          {id: 'w-good', type: PLACEHOLDER_WIDGET_TYPE},
        ],
        layouts: [
          {id: RAIL_LAYOUT_ID, placements: [{instanceId: 'w-good'}, {instanceId: ''}, 42]},
          {id: '', placements: []},
        ],
      }),
    )
    expect(parsed.instances.map(i => i.id)).toEqual(['w-good'])
    expect(parsed.layouts).toEqual([
      {id: RAIL_LAYOUT_ID, placements: [{instanceId: 'w-good'}]},
    ])
  })

  it('keeps unknown widget types (renderer shows a fallback, never a wipe)', () => {
    const parsed = parseWidgetsConfig(
      JSON.stringify({
        version: 1,
        instances: [{id: 'w-future', type: 'deck-clock', settings: {tz: 'UTC'}}],
        layouts: [{id: RAIL_LAYOUT_ID, placements: [{instanceId: 'w-future'}]}],
      }),
    )
    expect(parsed.instances).toEqual([
      {id: 'w-future', type: 'deck-clock', settings: {tz: 'UTC'}},
    ])
  })

  it('round-trips through JSON (only serializable configuration persists)', () => {
    const config = addWidgetInstance(defaultWidgetsConfig(), PLACEHOLDER_WIDGET_TYPE, 'w-x', {n: 1})
    expect(parseWidgetsConfig(JSON.stringify(config))).toEqual(config)
  })
})
