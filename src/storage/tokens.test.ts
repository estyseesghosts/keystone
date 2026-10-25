import * as SecureStore from 'expo-secure-store'

import {createTokenVault as createNativeVault, tokenKeyFor} from './tokens'
import {
  createTokenVault as createWebVault,
  tokenKeyFor as webTokenKeyFor,
} from './tokens.web'
import {sharedMmkv} from './mmkv'

const SecureStoreMock = SecureStore as unknown as {
  __clear(): void
  __entries(): Array<[string, string]>
}

const SID = 'https://a.example u1'
const ORIGIN = 'https://a.example'

// The exact regex expo-secure-store enforces
// (node_modules/expo-secure-store/src/SecureStore.ts:238).
const REAL_SECURE_STORE_KEY = /^[\w.-]+$/

/** Inputs the old `keystone.vault.${origin} ${sessionId}` shape choked on. */
const NASTY_IDS = [
  'https://a.example u1',
  'https://a.example:3000/u s e r',
  'https://例え.jp ユーザー',
  `https://a.example/${'x'.repeat(300)} long origin padding`,
]

const NASTY_ORIGINS = ['https://a.example', 'https://例え.jp:3000/x y', 'keystone://app internal id']

describe('native token vault (expo-secure-store mock)', () => {
  beforeEach(() => {
    SecureStoreMock.__clear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('round-trips set/get/remove', async () => {
    const vault = createNativeVault()
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
    expect(await vault.setToken(SID, ORIGIN, 'tok-a')).toBe(true)
    expect(await vault.getToken(SID, ORIGIN)).toBe('tok-a')
    expect(await vault.removeToken(SID, ORIGIN)).toBe(true)
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
  })

  it('tokenKeyFor emits only SecureStore-valid characters (real-regex test)', () => {
    for (const sid of NASTY_IDS) {
      for (const origin of NASTY_ORIGINS) {
        const key = tokenKeyFor(sid, origin)
        expect(key).toMatch(REAL_SECURE_STORE_KEY)
        expect(key.startsWith('keystone.vault.')).toBe(true)
      }
    }
  })

  it('keys are namespaced, deterministic, and isolate (origin, account)', async () => {
    const vault = createNativeVault()
    // Same user, two origins: fully isolated entries.
    expect(await vault.setToken('https://a.example u1', 'https://a.example', 'tok-a')).toBe(true)
    expect(await vault.setToken('https://b.example u1', 'https://b.example', 'tok-b')).toBe(true)
    expect(await vault.getToken('https://a.example u1', 'https://a.example')).toBe('tok-a')
    expect(await vault.getToken('https://b.example u1', 'https://b.example')).toBe('tok-b')
    const keys = SecureStoreMock.__entries().map(([k]) => k)
    expect(keys).toHaveLength(2)
    for (const key of keys) {
      expect(key.startsWith('keystone.vault.')).toBe(true)
      expect(key).toMatch(REAL_SECURE_STORE_KEY)
    }
    expect(keys[0]).not.toBe(keys[1])
    // Deterministic: the vault stores under exactly the documented key.
    expect(keys).toContain(tokenKeyFor('https://a.example u1', 'https://a.example'))
    expect(keys).toContain(tokenKeyFor('https://b.example u1', 'https://b.example'))
  })

  it('setToken reports failure and clears a stale entry when the vault throws', async () => {
    const vault = createNativeVault()
    expect(await vault.setToken(SID, ORIGIN, 'old-token')).toBe(true)
    const spy = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('keystore locked'))
    await expect(vault.setToken(SID, ORIGIN, 'new-token')).resolves.toBe(false)
    spy.mockRestore()
    // The stale entry is gone, so it can never win over a newer token later.
    await expect(vault.getToken(SID, ORIGIN)).resolves.toBeNull()
  })

  it('getToken resolves null (never throws) when reads fail', async () => {
    const vault = createNativeVault()
    const spy = jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('locked'))
    await expect(vault.getToken(SID, ORIGIN)).resolves.toBeNull()
    spy.mockRestore()
  })

  it('removeToken reports failure instead of throwing', async () => {
    const vault = createNativeVault()
    const spy = jest.spyOn(SecureStore, 'deleteItemAsync').mockRejectedValueOnce(new Error('locked'))
    await expect(vault.removeToken(SID, ORIGIN)).resolves.toBe(false)
    spy.mockRestore()
  })

  it('app secrets round-trip under a valid key and report failures', async () => {
    const vault = createNativeVault()
    expect(await vault.getAppSecret(ORIGIN)).toBeNull()
    expect(await vault.setAppSecret(ORIGIN, 's3cret')).toBe(true)
    expect(await vault.getAppSecret(ORIGIN)).toBe('s3cret')
    expect(await vault.removeAppSecret(ORIGIN)).toBe(true)
    expect(await vault.getAppSecret(ORIGIN)).toBeNull()
    const spy = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('locked'))
    await expect(vault.setAppSecret(ORIGIN, 'x')).resolves.toBe(false)
    spy.mockRestore()
    await expect(vault.getAppSecret(ORIGIN)).resolves.toBeNull()
  })
})

describe('web token vault (MMKV, dev-grade)', () => {
  beforeEach(() => {
    sharedMmkv().clearAll()
  })

  it('round-trips set/get/remove', async () => {
    const vault = createWebVault()
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
    await vault.setToken(SID, ORIGIN, 'tok-a')
    expect(await vault.getToken(SID, ORIGIN)).toBe('tok-a')
    await vault.removeToken(SID, ORIGIN)
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
  })

  it('keys tokens per session id AND per origin', async () => {
    const vault = createWebVault()
    await vault.setToken('https://a.example u1', 'https://a.example', 'tok-a')
    await vault.setToken('https://b.example u1', 'https://b.example', 'tok-b')
    expect(await vault.getToken('https://a.example u1', 'https://a.example')).toBe('tok-a')
    expect(await vault.getToken('https://b.example u1', 'https://b.example')).toBe('tok-b')
  })

  it('mirrors the native key shape', () => {
    expect(webTokenKeyFor(SID, ORIGIN)).toBe(tokenKeyFor(SID, ORIGIN))
    expect(webTokenKeyFor(SID, ORIGIN)).toMatch(REAL_SECURE_STORE_KEY)
  })
})
