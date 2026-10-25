import {MMKV, type MMKV as MMKVInstance} from 'react-native-mmkv'

import type {KeyValueStore} from '@keystone/fedi'

import {emitStorageWriteFailed} from './storageEvents'

// MMKV-backed `KeyValueStore` (slice 2.5): the app wiring for the 2.1
// sync storage seam. MMKV is synchronous, so it implements the seam
// directly — the SAME core session logic runs on device and in tests
// (tests use `createMemoryStore()` instead). A failed write returns false
// (the typed S12 result), is dev-logged, and emits the app-level
// `storageWriteFailed` event — it never throws, so reads keep their old
// never-throw contract and writers decide how to surface it.

/** The MMKV surface this module needs (subset — fakes welcome in tests). */
export interface MmkvLike {
  getString(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  getAllKeys?(): string[]
}

export function createMmkvStore(mmkv: MmkvLike): KeyValueStore {
  return {
    getItem: key => {
      try {
        return mmkv.getString(key) ?? null
      } catch {
        return null
      }
    },
    setItem: (key, value) => {
      try {
        mmkv.set(key, value)
        return true
      } catch {
        // Typed failure (repair X1.3 S12): false + dev log + app-level
        // event. Writers decide the surface (draft autosave shows a
        // notice; the session envelope keeps the in-memory copy).
        emitStorageWriteFailed(key)
        return false
      }
    },
    removeItem: key => {
      try {
        mmkv.delete(key)
      } catch {
        // Ignore.
      }
    },
    keys: () => {
      try {
        return mmkv.getAllKeys?.() ?? []
      } catch {
        return []
      }
    },
  }
}

let sharedInstance: MMKVInstance | null = null

/** The shared MMKV instance (one id for the whole app; scopes separate
 * by key prefix). Lazy so importing this module never touches native
 * code at import time. */
export function sharedMmkv(): MMKVInstance {
  if (!sharedInstance) {
    sharedInstance = new MMKV({id: 'keystone'})
  }
  return sharedInstance
}

let sharedStore: KeyValueStore | null = null

/** The app `KeyValueStore`: MMKV behind the core session seam. */
export function appKeyValueStore(): KeyValueStore {
  if (!sharedStore) {
    sharedStore = createMmkvStore(sharedMmkv())
  }
  return sharedStore
}
