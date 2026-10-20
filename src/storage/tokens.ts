import * as SecureStore from 'expo-secure-store'

// Native token vault (slice 2.5): OS-secured storage (Keychain /
// EncryptedSharedPreferences) for session tokens, ABOVE the sync
// `KeyValueStore` seam — the seam stays sync (MMKV + core logic), this
// async layer holds the secrets. Tokens are keyed per session id AND per
// origin, so a token can never be read back for the wrong account —
// including same-user/different-origin pairs (the session id already
// embeds the origin; the explicit origin segment keeps the key
// self-describing and greppable). Failures resolve to null / no-op:
// local sign-out is never blocked by a vault error.
//
// Web goes through `tokens.web.ts` (MMKV, dev-grade) via the repo's
// platform-file pattern; this file never ships to web.

export interface TokenVault {
  getToken(sessionId: string, origin: string): Promise<string | null>
  setToken(sessionId: string, origin: string, token: string): Promise<void>
  removeToken(sessionId: string, origin: string): Promise<void>
}

/** Vault key: namespace + origin + session id. Both ids travel in the
 * key so a vault dump is auditable without decoding anything. */
export function tokenKeyFor(sessionId: string, origin: string): string {
  return `keystone.vault.${origin} ${sessionId}`
}

export function createTokenVault(): TokenVault {
  return {
    async getToken(sessionId, origin) {
      try {
        return await SecureStore.getItemAsync(tokenKeyFor(sessionId, origin))
      } catch {
        return null
      }
    },
    async setToken(sessionId, origin, token) {
      try {
        await SecureStore.setItemAsync(tokenKeyFor(sessionId, origin), token)
      } catch {
        // Vault unavailable: the envelope copy remains (MMKV).
      }
    },
    async removeToken(sessionId, origin) {
      try {
        await SecureStore.deleteItemAsync(tokenKeyFor(sessionId, origin))
      } catch {
        // Ignore — envelope removal already dropped the session.
      }
    },
  }
}
