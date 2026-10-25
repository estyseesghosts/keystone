import {utf8Hex} from '@keystone/fedi'

import {sharedMmkv} from './mmkv'
import type {TokenVault} from './vault'

// Web token vault (slice 2.5 + ADR 0011): no OS keychain on web, so tokens
// ride in MMKV (dev-grade — same store as the session envelope, namespaced
// `keystone.vault.` keys). Same `TokenVault` shape and same key encoding
// as the native vault, so the session store runs IDENTICAL key logic on
// both platforms — only this file differs. Deliberately NOT a
// `SecureTokenVault` (no `secure` flag): the store capability-detects and
// runs the legacy envelope-keeps-token path here. Owner decision D2: web
// stays localStorage-backed and is a documented release blocker.

/** Vault key: namespace + hex of `"${origin} ${sessionId}"` (mirrors `tokens.ts`). */
export function tokenKeyFor(sessionId: string, origin: string): string {
  return `keystone.vault.${utf8Hex(`${origin} ${sessionId}`)}`
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
