import {sharedMmkv} from './mmkv'

// Web token vault (slice 2.5): no OS keychain on web, so tokens ride in
// MMKV (dev-grade — same store as the session envelope, namespaced
// `keystone.vault.` keys). Same `TokenVault` shape and same per
// (session id, origin) keying as the native vault, so the session store
// runs IDENTICAL logic on both platforms — only this file differs.

export interface TokenVault {
  getToken(sessionId: string, origin: string): Promise<string | null>
  setToken(sessionId: string, origin: string, token: string): Promise<void>
  removeToken(sessionId: string, origin: string): Promise<void>
}

/** Vault key: namespace + origin + session id (mirrors `tokens.ts`). */
export function tokenKeyFor(sessionId: string, origin: string): string {
  return `keystone.vault.${origin} ${sessionId}`
}

export function createTokenVault(): TokenVault {
  return {
    async getToken(sessionId, origin) {
      try {
        return sharedMmkv().getString(tokenKeyFor(sessionId, origin)) ?? null
      } catch {
        return null
      }
    },
    async setToken(sessionId, origin, token) {
      try {
        sharedMmkv().set(tokenKeyFor(sessionId, origin), token)
      } catch {
        // Ignore — the envelope copy remains.
      }
    },
    async removeToken(sessionId, origin) {
      try {
        sharedMmkv().delete(tokenKeyFor(sessionId, origin))
      } catch {
        // Ignore.
      }
    },
  }
}
