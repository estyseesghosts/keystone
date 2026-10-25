// Write-failure event channel (repair X1.3 S12): one `storageWriteFailed`
// event per failed write, carrying the key and a coarse scope — never
// values, tokens, or bodies.

import {
  emitStorageWriteFailed,
  onStorageWriteFailed,
  scopeForStorageKey,
  type StorageWriteFailure,
} from './storageEvents'

describe('scopeForStorageKey', () => {
  it('maps key prefixes to scopes without ever touching values', () => {
    expect(scopeForStorageKey('keystone_sessions')).toBe('sessions')
    expect(scopeForStorageKey('keystone_sessions.bak')).toBe('sessions')
    expect(scopeForStorageKey('keystone.device')).toBe('device')
    expect(scopeForStorageKey('keystone.device.bak')).toBe('device')
    expect(scopeForStorageKey('keystone.account.https://a.example u1')).toBe('account')
    expect(scopeForStorageKey('keystone.accountbak.https://a.example u1')).toBe('account')
    expect(scopeForStorageKey('keystone.drafts.sid')).toBe('drafts')
    expect(scopeForStorageKey('keystone.draftopen.sid')).toBe('drafts')
    expect(scopeForStorageKey('keystone.draftbak.sid')).toBe('drafts')
    expect(scopeForStorageKey('keystone_pending_miauth_abc')).toBe('pending')
    expect(scopeForStorageKey('keystone-query-cache')).toBe('persist')
    expect(scopeForStorageKey('keystone-query-cache.sid')).toBe('persist')
    expect(scopeForStorageKey('something-else')).toBe('misc')
  })
})

describe('onStorageWriteFailed / emitStorageWriteFailed', () => {
  it('fans out to subscribers and unsubscribes', () => {
    const a: StorageWriteFailure[] = []
    const b: StorageWriteFailure[] = []
    const offA = onStorageWriteFailed(f => a.push(f))
    const offB = onStorageWriteFailed(f => b.push(f))
    emitStorageWriteFailed('keystone.device', 'device')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]).toMatchObject({key: 'keystone.device', scope: 'device'})
    expect(typeof a[0].at).toBe('number')
    offA()
    emitStorageWriteFailed('keystone.device', 'device')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
    offB()
  })

  it('derives the scope from the key and survives throwing listeners', () => {
    const seen: StorageWriteFailure[] = []
    const offBad = onStorageWriteFailed(() => {
      throw new Error('boom')
    })
    const offGood = onStorageWriteFailed(f => seen.push(f))
    try {
      expect(() => emitStorageWriteFailed('keystone.drafts.sid')).not.toThrow()
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({key: 'keystone.drafts.sid', scope: 'drafts'})
    } finally {
      offBad()
      offGood()
    }
  })

  it('ignores non-function subscribers', () => {
    const off = onStorageWriteFailed(null as unknown as (f: StorageWriteFailure) => void)
    expect(() => emitStorageWriteFailed('k')).not.toThrow()
    off()
  })
})
