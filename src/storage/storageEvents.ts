// Write-failure reporting (repair X1.3 S12).
//
// `KeyValueStore.setItem` reports failure as a boolean (and the MMKV
// layer logs); this module is the app-level channel on top: one
// `storageWriteFailed` event per failed write, carrying the key and a
// coarse scope — never values, tokens, or bodies. X8.1's logger consumes
// it; the draft-autosave notice (Composer) is the only UI surface in
// this slice.

export type StorageWriteScope =
  | 'sessions'
  | 'device'
  | 'account'
  | 'drafts'
  | 'pending'
  | 'persist'
  | 'misc'

export interface StorageWriteFailure {
  /** The key whose write failed (keying material only, never values). */
  key: string
  /** Coarse domain for filtering/routing. */
  scope: StorageWriteScope
  /** `Date.now()` at emission. */
  at: number
}

/** Coarse domain for a storage key (keying material only, never values). */
export function scopeForStorageKey(key: string): StorageWriteScope {
  if (key === 'keystone_sessions' || key === 'keystone_sessions.bak') return 'sessions'
  if (key === 'keystone.device' || key === 'keystone.device.bak') return 'device'
  if (key.startsWith('keystone.account.') || key.startsWith('keystone.accountbak.')) return 'account'
  if (
    key.startsWith('keystone.drafts.') ||
    key.startsWith('keystone.draftopen.') ||
    key.startsWith('keystone.draftbak.')
  ) {
    return 'drafts'
  }
  if (key.startsWith('keystone_pending_miauth_')) return 'pending'
  if (key === 'keystone-query-cache' || key.startsWith('keystone-query-cache.')) return 'persist'
  return 'misc'
}

type StorageWriteListener = (failure: StorageWriteFailure) => void

const listeners = new Set<StorageWriteListener>()

/** Subscribe to write failures (X8.1's logger; tests). Returns an unsubscribe. Never throws. */
export function onStorageWriteFailed(listener: StorageWriteListener): () => void {
  if (typeof listener !== 'function') return () => undefined
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emit one failure: dev-logged (scope only, never keys or values), then fanned out. Listener throws never propagate. Never throws. */
export function emitStorageWriteFailed(key: string, scope?: StorageWriteScope): void {
  const resolved = scope ?? scopeForStorageKey(key)
  console.warn('[storage] write failed', resolved)
  const failure: StorageWriteFailure = {key, scope: resolved, at: Date.now()}
  for (const listener of [...listeners]) {
    try {
      listener(failure)
    } catch {
      // A failing listener must never break storage.
    }
  }
}
