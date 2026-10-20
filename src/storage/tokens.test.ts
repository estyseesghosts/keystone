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

describe('native token vault (expo-secure-store mock)', () => {
  beforeEach(() => {
    SecureStoreMock.__clear()
  })

  it('round-trips set/get/remove', async () => {
    const vault = createNativeVault()
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
    await vault.setToken(SID, ORIGIN, 'tok-a')
    expect(await vault.getToken(SID, ORIGIN)).toBe('tok-a')
    await vault.removeToken(SID, ORIGIN)
    expect(await vault.getToken(SID, ORIGIN)).toBeNull()
  })

  it('keys tokens per session id AND per origin', async () => {
    const vault = createNativeVault()
    // Same user, two origins: fully isolated entries.
    await vault.setToken('https://a.example u1', 'https://a.example', 'tok-a')
    await vault.setToken('https://b.example u1', 'https://b.example', 'tok-b')
    expect(await vault.getToken('https://a.example u1', 'https://a.example')).toBe('tok-a')
    expect(await vault.getToken('https://b.example u1', 'https://b.example')).toBe('tok-b')
    const keys = SecureStoreMock.__entries().map(([k]) => k)
    expect(keys).toHaveLength(2)
    for (const key of keys) {
      expect(key.startsWith('keystone.vault.')).toBe(true)
    }
    expect(keys.some(k => k.includes('https://a.example'))).toBe(true)
    expect(keys.some(k => k.includes('https://b.example'))).toBe(true)
  })

  it('tokenKeyFor embeds both ids', () => {
    const key = tokenKeyFor(SID, ORIGIN)
    expect(key).toContain(SID)
    expect(key).toContain(ORIGIN)
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
  })
})
