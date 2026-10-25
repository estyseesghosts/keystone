import type {KeyValueStore} from '@keystone/fedi'

import {appKeyValueStore} from './mmkv'
import {createTokenVault} from './tokens'
import type {SecureTokenVault, TokenVault} from './vault'
import {
  DEVICE_KEY,
  DEVICE_BAK_KEY,
  accountBakKeyFor,
  accountKeyFor,
  accountStateSchema,
  defaultAccountState,
  defaultDeviceState,
  deviceStateSchema,
  ensureRawBackup,
  isAccountPayloadReadable,
  isDevicePayloadReadable,
  migrateDeviceState,
  parseOrFallback,
  type AccountState,
  type DeviceState,
} from './schema'
import {
  emitStorageWriteFailed,
  onStorageWriteFailed,
  scopeForStorageKey,
  type StorageWriteFailure,
  type StorageWriteScope,
} from './storageEvents'

export type {SecureTokenVault, TokenVault} from './vault'
export {tokenKeyFor} from './tokens'
export {createMmkvStore, sharedMmkv, appKeyValueStore, type MmkvLike} from './mmkv'
export {
  emitStorageWriteFailed,
  onStorageWriteFailed,
  scopeForStorageKey,
  type StorageWriteFailure,
  type StorageWriteScope,
} from './storageEvents'
export {
  STORAGE_VERSION,
  DEVICE_KEY,
  DEVICE_BAK_KEY,
  accountKeyFor,
  accountBakKeyFor,
  deviceStateSchema,
  accountStateSchema,
  ensureRawBackup,
  isAccountPayloadReadable,
  isDevicePayloadReadable,
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
let vault: TokenVault | SecureTokenVault | null = null

export function appStorage(): KeyValueStore {
  if (!storage) storage = appKeyValueStore()
  return storage
}

export function appTokenVault(): TokenVault | SecureTokenVault {
  if (!vault) vault = createTokenVault()
  return vault
}

/** Test seam: replace the singletons (restored per test by the caller). */
export function __setStorageForTests(next: {
  storage?: KeyValueStore
  vault?: TokenVault | SecureTokenVault
}): void {
  if (next.storage !== undefined) storage = next.storage
  if (next.vault !== undefined) vault = next.vault
}

export function readDeviceState(store: KeyValueStore): DeviceState {
  return migrateDeviceState(store.getItem(DEVICE_KEY))
}

/** Persist device state. Backs the stored blob up first when it is
 * unreadable-but-non-empty (same rule as S9); returns false (never
 * throws) when the write failed. */
export function writeDeviceState(store: KeyValueStore, state: DeviceState): boolean {
  try {
    const raw = store.getItem(DEVICE_KEY)
    if (raw && !isDevicePayloadReadable(raw)) {
      ensureRawBackup(store, DEVICE_KEY, DEVICE_BAK_KEY)
    }
  } catch {
    // A failed read must not block the write.
  }
  try {
    return store.setItem(DEVICE_KEY, JSON.stringify(state))
  } catch {
    return false
  }
}

export function readAccountState(store: KeyValueStore, sessionId: string): AccountState {
  return parseOrFallback(
    accountStateSchema,
    store.getItem(accountKeyFor(sessionId)),
    defaultAccountState,
  )
}

/** Persist per-account state (same backup rule as the device scope).
 * Returns false (never throws) when the write failed. */
export function writeAccountState(
  store: KeyValueStore,
  sessionId: string,
  state: AccountState,
): boolean {
  const key = accountKeyFor(sessionId)
  try {
    const raw = store.getItem(key)
    if (raw && !isAccountPayloadReadable(raw)) {
      ensureRawBackup(store, key, accountBakKeyFor(sessionId))
    }
  } catch {
    // A failed read must not block the write.
  }
  try {
    return store.setItem(key, JSON.stringify(state))
  } catch {
    return false
  }
}
