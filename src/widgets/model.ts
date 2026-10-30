// Widget core model (polish/3-widget-core): serializable widget types,
// instances, placements, and layouts.
//
// Boundaries (`docs/visual-polish.md` Deliverable 3):
// - A widget type is a stable string ID. The registry (`./registry`) maps
//   IDs to definitions; this module never names a concrete type.
// - An instance is a stable unique ID + type ID + serializable settings.
//   Multiple instances of one type are allowed and expected.
// - A layout is an ordered list of placement references. Array order is
//   display order. The right rail owns one layout (`RAIL_LAYOUT_ID`);
//   the future deck UI owns others without changing widget code.
// - Only plain JSON values persist. Never store components, functions, or
//   class instances here — the store serializes the whole config with
//   `JSON.stringify`.
//
// This module is pure TypeScript: no `react`, no storage, no rail. All
// operations return a new config and never mutate their input.

/** Version of the persisted widget-config shape. Bump only with a
 * migration in `parseWidgetsConfig`; a mismatch falls back to defaults. */
export const WIDGETS_CONFIG_VERSION = 1 as const

/** Layout owned by the right rail. Other layout IDs are reserved for the
 * future deck UI; the renderer and the rail never assume this is the only
 * layout. */
export const RAIL_LAYOUT_ID = 'rail'

/** Stable type ID of the generic empty-placeholder widget. Defined here
 * (not in the registry) because persisted configs store it; the registry
 * maps this ID to its definition. */
export const PLACEHOLDER_WIDGET_TYPE = 'placeholder'

export interface WidgetInstance {
  /** Stable unique ID. Survives reordering and rerenders; never reused
   * for a different instance. */
  id: string
  /** Stable type ID, resolved against the registry at render time. */
  type: string
  /** Serializable per-instance configuration. JSON values only. */
  settings: Record<string, unknown>
}

export interface WidgetPlacement {
  instanceId: string
}

export interface WidgetLayout {
  id: string
  /** Array order is display order. */
  placements: WidgetPlacement[]
}

export interface WidgetConfig {
  version: typeof WIDGETS_CONFIG_VERSION
  instances: WidgetInstance[]
  layouts: WidgetLayout[]
}

/** First-run defaults: two distinct placeholder instances with different
 * stable IDs. Fixed IDs (not generated) so every fresh install seeds the
 * same stable references. */
export const DEFAULT_WIDGET_INSTANCE_IDS = [
  'widget-placeholder-1',
  'widget-placeholder-2',
] as const

export function defaultWidgetsConfig(): WidgetConfig {
  return {
    version: WIDGETS_CONFIG_VERSION,
    instances: DEFAULT_WIDGET_INSTANCE_IDS.map(id => ({
      id,
      type: PLACEHOLDER_WIDGET_TYPE,
      settings: {},
    })),
    layouts: [
      {
        id: RAIL_LAYOUT_ID,
        placements: DEFAULT_WIDGET_INSTANCE_IDS.map(instanceId => ({instanceId})),
      },
    ],
  }
}

/** Unique instance ID for widgets added after first run. Same shape as
 * the draft-ID precedent (`d<base36 time><base36 random>`), with a `w`
 * prefix so generated IDs can never collide with the fixed defaults. */
export function newWidgetId(now: number = Date.now()): string {
  return `w${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInstance(value: unknown): WidgetInstance | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (typeof value.type !== 'string' || value.type === '') return null
  return {
    id: value.id,
    type: value.type,
    settings: isRecord(value.settings) ? value.settings : {},
  }
}

function parseLayout(value: unknown): WidgetLayout | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id === '') return null
  if (!Array.isArray(value.placements)) return null
  const placements: WidgetPlacement[] = []
  for (const placement of value.placements) {
    if (isRecord(placement) && typeof placement.instanceId === 'string' && placement.instanceId !== '') {
      placements.push({instanceId: placement.instanceId})
    }
  }
  return {id: value.id, placements}
}

/** Parse a stored blob into a config. Never throws. Missing storage,
 * corrupt JSON, a wrong top-level shape, or an unknown version falls
 * back to `defaultWidgetsConfig()`. Structurally-invalid *entries* are
 * dropped individually so one bad row never wipes the rest; unknown
 * widget *types* are kept (the renderer shows a fallback) so a config
 * written by a newer client still loads.
 *
 * A valid-but-empty config (`instances: []`, rail placements `[]`) is
 * returned as-is: that is the user's intentional empty state, never a
 * signal to reseed. Only a missing/invalid blob seeds defaults. */
export function parseWidgetsConfig(raw: string | null): WidgetConfig {
  if (!raw) return defaultWidgetsConfig()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultWidgetsConfig()
  }
  if (!isRecord(parsed)) return defaultWidgetsConfig()
  if (parsed.version !== WIDGETS_CONFIG_VERSION) return defaultWidgetsConfig()
  if (!Array.isArray(parsed.instances) || !Array.isArray(parsed.layouts)) {
    return defaultWidgetsConfig()
  }
  const instances: WidgetInstance[] = []
  const seenIds = new Set<string>()
  for (const entry of parsed.instances) {
    const instance = parseInstance(entry)
    if (!instance || seenIds.has(instance.id)) continue
    seenIds.add(instance.id)
    instances.push(instance)
  }
  const layouts: WidgetLayout[] = []
  const seenLayouts = new Set<string>()
  for (const entry of parsed.layouts) {
    const layout = parseLayout(entry)
    if (!layout || seenLayouts.has(layout.id)) continue
    seenLayouts.add(layout.id)
    layouts.push(layout)
  }
  return {version: WIDGETS_CONFIG_VERSION, instances, layouts}
}

/** Instances for a layout in display order. Dangling placements (no
 * matching instance) are skipped, so a layout never breaks when an
 * instance is gone. A missing layout resolves to `[]`. */
export function instancesForLayout(config: WidgetConfig, layoutId: string): WidgetInstance[] {
  const layout = config.layouts.find(l => l.id === layoutId)
  if (!layout) return []
  const byId = new Map(config.instances.map(instance => [instance.id, instance]))
  const resolved: WidgetInstance[] = []
  for (const placement of layout.placements) {
    const instance = byId.get(placement.instanceId)
    if (instance) resolved.push(instance)
  }
  return resolved
}

/** Append a new instance of `type` to the rail layout. The instance ID
 * must be fresh (`newWidgetId`); a colliding ID is a no-op so the
 * uniqueness invariant survives double-submits. */
export function addWidgetInstance(
  config: WidgetConfig,
  type: string,
  id: string,
  settings: Record<string, unknown> = {},
): WidgetConfig {
  if (config.instances.some(instance => instance.id === id)) return config
  const instance: WidgetInstance = {id, type, settings}
  return {
    ...config,
    instances: [...config.instances, instance],
    layouts: config.layouts.map(layout =>
      layout.id === RAIL_LAYOUT_ID
        ? {...layout, placements: [...layout.placements, {instanceId: id}]}
        : layout,
    ),
  }
}

/** Remove a placement from one layout: drop the layout's placements for
 * `instanceId`, then drop the instance itself only when no layout
 * references it anymore. Removing only truly-unreferenced instances keeps
 * the model safe for future layouts that may share instances. */
export function removeWidgetPlacement(
  config: WidgetConfig,
  layoutId: string,
  instanceId: string,
): WidgetConfig {
  const layouts = config.layouts.map(layout =>
    layout.id === layoutId
      ? {...layout, placements: layout.placements.filter(p => p.instanceId !== instanceId)}
      : layout,
  )
  const referenced = new Set<string>()
  for (const layout of layouts) {
    for (const placement of layout.placements) referenced.add(placement.instanceId)
  }
  return {
    ...config,
    instances: config.instances.filter(
      instance => instance.id !== instanceId || referenced.has(instance.id),
    ),
    layouts,
  }
}

/** Reorder within one layout: moves the placement at `fromIndex` to
 * `toIndex`. Instance IDs and settings are untouched. Out-of-range
 * indices are a no-op. */
export function moveWidgetPlacement(
  config: WidgetConfig,
  layoutId: string,
  fromIndex: number,
  toIndex: number,
): WidgetConfig {
  return {
    ...config,
    layouts: config.layouts.map(layout => {
      if (layout.id !== layoutId) return layout
      const placements = [...layout.placements]
      if (fromIndex < 0 || fromIndex >= placements.length) return layout
      const clampedTo = Math.min(Math.max(toIndex, 0), placements.length - 1)
      const [moved] = placements.splice(fromIndex, 1)
      if (!moved) return layout
      placements.splice(clampedTo, 0, moved)
      return {...layout, placements}
    }),
  }
}
