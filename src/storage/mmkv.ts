import {MMKV, type MMKV as MMKVInstance} from 'react-native-mmkv'

import type {KeyValueStore} from '@keystone/fedi'

// MMKV-backed `KeyValueStore` (slice 2.5): the app wiring for the 2.1
// sync storage seam. MMKV is synchronous, so it implements the seam
// directly — the SAME core session logic runs on device and in tests
// (tests use `createMemoryStore()` instead). Errors are swallowed to
// match the seam's contract (storage unavailable → process-local only).

/** The MMKV surface this module needs (subset — fakes welcome in tests). */
export interface MmkvLike {
  getString(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
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
      } catch {
        // Storage unavailable: sessions last for this process only.
      }
    },
    removeItem: key => {
      try {
        mmkv.delete(key)
      } catch {
        // Ignore.
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
