import type {KeyValueStore} from '@keystone/fedi'

import {appKeyValueStore} from './mmkv'
import {createTokenVault, type TokenVault} from './tokens'
import {
  DEVICE_KEY,
  accountKeyFor,
  accountStateSchema,
  defaultAccountState,
  defaultDeviceState,
  deviceStateSchema,
  migrateDeviceState,
  parseOrFallback,
  type AccountState,
  type DeviceState,
} from './schema'

export type {TokenVault}
export {tokenKeyFor} from './tokens'
export {createMmkvStore, sharedMmkv, appKeyValueStore, type MmkvLike} from './mmkv'
export {
  STORAGE_VERSION,
  DEVICE_KEY,
  accountKeyFor,
  deviceStateSchema,
  accountStateSchema,
  parseOrFallback,
  defaultDeviceState,
  defaultAccountState,
  type DeviceState,
  type AccountState,
} from './schema'

// App storage wiring (slice 2.5): the MMKV `KeyValueStore` the core
// session envelope persists through, the platform token vault (SecureStore
// native / MMKV web — resolved by the bundler's platform-file rule), and
// the versioned device + per-account scope readers/writers.

/** Lazily-built singletons (lazy so tests can substitute freely). */
let storage: KeyValueStore | null = null
let vault: TokenVault | null = null

export function appStorage(): KeyValueStore {
  if (!storage) storage = appKeyValueStore()
  return storage
}

export function appTokenVault(): TokenVault {
  if (!vault) vault = createTokenVault()
  return vault
}

/** Test seam: replace the singletons (restored per test by the caller). */
export function __setStorageForTests(next: {storage?: KeyValueStore; vault?: TokenVault}): void {
  if (next.storage !== undefined) storage = next.storage
  if (next.vault !== undefined) vault = next.vault
}

export function readDeviceState(store: KeyValueStore): DeviceState {
  return migrateDeviceState(store.getItem(DEVICE_KEY))
}

export function writeDeviceState(store: KeyValueStore, state: DeviceState): void {
  store.setItem(DEVICE_KEY, JSON.stringify(state))
}

export function readAccountState(store: KeyValueStore, sessionId: string): AccountState {
  return parseOrFallback(
    accountStateSchema,
    store.getItem(accountKeyFor(sessionId)),
    defaultAccountState,
  )
}

export function writeAccountState(
  store: KeyValueStore,
  sessionId: string,
  state: AccountState,
): void {
  store.setItem(accountKeyFor(sessionId), JSON.stringify(state))
}
