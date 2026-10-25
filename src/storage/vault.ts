// Vault contracts (ADR 0011). Platform-neutral on purpose: `tokens.ts`
// (native SecureStore) and `tokens.web.ts` (MMKV, dev-grade) both
// implement these, and `index.ts` / the session store name them on every
// platform — so the interfaces live here, not in either platform file
// (a type imported via `./tokens` would resolve to `tokens.web.ts` on
// web, which cannot see native-only declarations).

/** Async secret storage above the sync `KeyValueStore` seam. */
export interface TokenVault {
  getToken(sessionId: string, origin: string): Promise<string | null>
  setToken(sessionId: string, origin: string, token: string): Promise<void>
  removeToken(sessionId: string, origin: string): Promise<void>
}

/**
 * An OS-backed vault (ADR 0011). Deliberately NOT a subtype of
 * `TokenVault` (`Promise<boolean>` is not assignable to `Promise<void>`):
 * it plugs into `TokenVault` slots only through the
 * `TokenVault | SecureTokenVault` union, narrowed with a capability check
 * (`secure === true`). Web never implements this interface.
 */
export interface SecureTokenVault {
  readonly secure: true
  getToken(sessionId: string, origin: string): Promise<string | null>
  setToken(sessionId: string, origin: string, token: string): Promise<boolean>
  removeToken(sessionId: string, origin: string): Promise<boolean>
  getAppSecret(origin: string): Promise<string | null>
  setAppSecret(origin: string, secret: string): Promise<boolean>
  removeAppSecret(origin: string): Promise<boolean>
}
