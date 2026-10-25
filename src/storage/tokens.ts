import * as SecureStore from 'expo-secure-store'

import {appSecretKeyFor, utf8Hex} from '@keystone/fedi'

import type {SecureTokenVault} from './vault'

// Native token vault (slice 2.5 + ADR 0011): OS-secured storage (Keychain /
// EncryptedSharedPreferences) for session tokens, ABOVE the sync
// `KeyValueStore` seam — the seam stays sync (MMKV + core logic), this
// async layer holds the secrets.
//
// ADR 0011 contract:
// - Vault keys carry only `[A-Za-z0-9._-]` (what `expo-secure-store`
//   accepts): `keystone.vault.` + hex of `"${origin} ${sessionId}"`.
//   The session id already embeds the origin, so per-(origin, account)
//   isolation holds — including same-user/different-origin pairs.
// - Writes report success (`true`) or failure (`false`) and never throw.
//   A failed `setToken`/`setAppSecret` deletes the vault entry first, so
//   a stale entry can never win over a newer envelope token later.
// - Reads resolve `null` on absent OR unreadable (boot must never crash
//   on a locked keystore); the caller distinguishes via its own state.
// - The session envelope on native is secret-free (`token: ''`);
//   `TokenVault` itself is unchanged so every existing caller keeps
//   compiling — OS vaults expose the additive `SecureTokenVault`.
//
// Web goes through `tokens.web.ts` (MMKV, dev-grade) via the repo's
// platform-file pattern; this file never ships to web. Vault contracts
// (`TokenVault`, `SecureTokenVault`) live in `./vault` so every platform
// names the same types.

/** Vault key: namespace + hex of `"${origin} ${sessionId}"`. */
export function tokenKeyFor(sessionId: string, origin: string): string {
  return `keystone.vault.${utf8Hex(`${origin} ${sessionId}`)}`
}

export function createTokenVault(): SecureTokenVault {
  return {
    secure: true,

    async getToken(sessionId, origin) {
      try {
        return await SecureStore.getItemAsync(tokenKeyFor(sessionId, origin))
      } catch {
        return null
      }
    },
    async setToken(sessionId, origin, token) {
      const key = tokenKeyFor(sessionId, origin)
      try {
        await SecureStore.setItemAsync(key, token)
        return true
      } catch {
        // The entry may be stale (or half-written): delete it so it can
        // never win over a newer token later (ADR 0011).
        try {
          await SecureStore.deleteItemAsync(key)
        } catch {
          // Ignore — the entry is already unusable.
        }
        return false
      }
    },
    async removeToken(sessionId, origin) {
      try {
        await SecureStore.deleteItemAsync(tokenKeyFor(sessionId, origin))
        return true
      } catch {
        return false
      }
    },

    async getAppSecret(origin) {
      try {
        return await SecureStore.getItemAsync(appSecretKeyFor(origin))
      } catch {
        return null
      }
    },
    async setAppSecret(origin, secret) {
      const key = appSecretKeyFor(origin)
      try {
        await SecureStore.setItemAsync(key, secret)
        return true
      } catch {
        try {
          await SecureStore.deleteItemAsync(key)
        } catch {
          // Ignore — the entry is already unusable.
        }
        return false
      }
    },
    async removeAppSecret(origin) {
      try {
        await SecureStore.deleteItemAsync(appSecretKeyFor(origin))
        return true
      } catch {
        return false
      }
    },
  }
}
