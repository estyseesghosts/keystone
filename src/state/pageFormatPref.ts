// Page editor "show formatting" device preference (P6.5 PG-2, default
// on per owner 2026-10-31). Device-local MMKV via the device state (no
// server field exists). The Settings panel owns the switch; text blocks
// consume it for render-on-blur. Pattern mirrors `privacyStore`
// (read/write/emit/subscribe).

import {useSyncExternalStore} from 'react'

import type {KeyValueStore} from '@keystone/fedi'

import {appStorage, readDeviceState, writeDeviceState} from '#/storage'

export interface PageFormatPrefStore {
  get(): boolean
  set(value: boolean): void
  subscribe(fn: () => void): () => void
}

export function createPageFormatPrefStore(
  storage: () => KeyValueStore = appStorage,
): PageFormatPrefStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    get(): boolean {
      return readDeviceState(storage()).prefs.pageShowFormatting ?? true
    },
    set(value: boolean): void {
      const next = value === true
      const state = readDeviceState(storage())
      if ((state.prefs.pageShowFormatting ?? true) === next) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, pageShowFormatting: next},
      })
      emit()
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const pageFormatPrefStore: PageFormatPrefStore = createPageFormatPrefStore()

export function usePageShowFormatting(store: PageFormatPrefStore = pageFormatPrefStore): boolean {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  )
}
