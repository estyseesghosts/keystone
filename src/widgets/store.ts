// Persisted widget configuration (polish/3-widget-core): widget
// instances + layouts, stored as serializable JSON through the existing
// local settings seam (`appStorage()`, own key — same pattern as
// `feedPrefs`). Rail *visibility* state (`src/state/widgetsPanel.ts`)
// stays separate: this store never records shown/hidden, and the panel
// mode module never touches widget config.
//
// First run seeds the two default placeholders in memory only; the seed
// persists on the first mutation. A stored valid-but-empty config is the
// user's intentional empty state and is never reseeded.

import {useSyncExternalStore} from 'react'

import type {KeyValueStore} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {
  addWidgetInstance,
  defaultWidgetsConfig,
  moveWidgetPlacement,
  newWidgetId,
  parseWidgetsConfig,
  RAIL_LAYOUT_ID,
  removeWidgetPlacement,
  type WidgetConfig,
  type WidgetInstance,
} from './model'
import {getWidgetDefinition} from './registry'

export const WIDGETS_CONFIG_KEY = 'keystone.widgets'

export interface WidgetsStore {
  get(): WidgetConfig
  subscribe(fn: () => void): () => void
  /** Create an instance of a registry type and append its placement to
   * the rail layout. Throws on an unknown type — callers list types
   * from the registry, so this only fires on programmer error. */
  addWidget(type: string): WidgetInstance
  /** Remove an instance's rail placement (see `removeWidgetPlacement`
   * for the shared-instance rule). */  removeWidget(instanceId: string): void
  /** Move an instance's rail placement to `toIndex` (0-based). IDs and
   * settings are untouched. Unknown IDs and out-of-range indices are a
   * no-op. */
  moveWidget(instanceId: string, toIndex: number): void
}

export function createWidgetsStore(
  storage: () => KeyValueStore = appStorage,
): WidgetsStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const read = (): WidgetConfig => {
    try {
      return parseWidgetsConfig(storage().getItem(WIDGETS_CONFIG_KEY))
    } catch {
      return defaultWidgetsConfig()
    }
  }
  // Cached by reference: `useSyncExternalStore` needs a stable snapshot
  // (a fresh object every read would re-render forever).
  let cached: WidgetConfig | null = null
  const get = (): WidgetConfig => {
    if (!cached) cached = read()
    return cached
  }
  const persist = (next: WidgetConfig): void => {
    cached = next
    try {
      storage().setItem(WIDGETS_CONFIG_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the change lasts for this session only.
    }
    emit()
  }
  return {
    get,
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    addWidget(type: string): WidgetInstance {
      if (!getWidgetDefinition(type)) {
        throw new Error(`Unknown widget type: ${type}`)
      }
      const id = newWidgetId()
      persist(addWidgetInstance(get(), type, id))
      const created = get().instances.find(instance => instance.id === id)
      if (!created) throw new Error(`Widget creation failed for type: ${type}`)
      return created
    },
    removeWidget(instanceId: string): void {
      persist(removeWidgetPlacement(get(), RAIL_LAYOUT_ID, instanceId))
    },
    moveWidget(instanceId: string, toIndex: number): void {
      const layout = get().layouts.find(l => l.id === RAIL_LAYOUT_ID)
      if (!layout) return
      const fromIndex = layout.placements.findIndex(p => p.instanceId === instanceId)
      if (fromIndex === -1) return
      persist(moveWidgetPlacement(get(), RAIL_LAYOUT_ID, fromIndex, toIndex))
    },
  }
}

export const widgetsStore: WidgetsStore = createWidgetsStore()

export function useWidgetsConfig(store: WidgetsStore = widgetsStore): WidgetConfig {
  return useSyncExternalStore(store.subscribe, store.get)
}
