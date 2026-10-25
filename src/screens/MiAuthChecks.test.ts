// X2.3 / ADR 0012: the MiAuth callback is single-use, origin-bound, and
// expires — and the verified account must belong to the pending host.
import {createMemoryStore} from '@keystone/fedi'

import {miauthAccountMatchesHost, miauthPendingMatchesOrigin} from './AuthCallback'
import {saveMisskeyPending, takeMisskeyPending} from './LoginFlows'

describe('takeMisskeyPending (single-use, host/scheme, 15-minute expiry)', () => {
  it('takes a fresh row exactly once (replay guard)', () => {
    const store = createMemoryStore()
    saveMisskeyPending(store, {scheme: 'https', host: 'a.example', session: 'sess-1', createdAt: Date.now()})
    expect(takeMisskeyPending(store, 'sess-1')).toMatchObject({scheme: 'https', host: 'a.example', session: 'sess-1'})
    expect(takeMisskeyPending(store, 'sess-1')).toBeNull()
  })

  it('rejects rows with a bad scheme, a missing host, or a session mismatch', () => {
    const store = createMemoryStore()
    saveMisskeyPending(store, {scheme: 'ftp', host: 'a.example', session: 'bad-scheme', createdAt: Date.now()} as never)
    expect(takeMisskeyPending(store, 'bad-scheme')).toBeNull()
    saveMisskeyPending(store, {scheme: 'https', host: '', session: 'bad-host', createdAt: Date.now()})
    expect(takeMisskeyPending(store, 'bad-host')).toBeNull()
    saveMisskeyPending(store, {scheme: 'https', host: 'a.example', session: 'real', createdAt: Date.now()})
    expect(takeMisskeyPending(store, 'other')).toBeNull()
    // The untouched row is still takeable.
    expect(takeMisskeyPending(store, 'real')).not.toBeNull()
  })

  it('rejects rows older than 15 minutes', () => {
    const store = createMemoryStore()
    saveMisskeyPending(store, {scheme: 'https', host: 'a.example', session: 'old', createdAt: Date.now() - 16 * 60 * 1000})
    expect(takeMisskeyPending(store, 'old')).toBeNull()
    saveMisskeyPending(store, {scheme: 'https', host: 'a.example', session: 'fresh', createdAt: Date.now() - 14 * 60 * 1000})
    expect(takeMisskeyPending(store, 'fresh')).not.toBeNull()
  })
})

describe('miauthPendingMatchesOrigin', () => {
  it('matches the exact pending origin, case-insensitively', () => {
    expect(miauthPendingMatchesOrigin({scheme: 'https', host: 'a.example'}, 'https://a.example')).toBe(true)
    expect(miauthPendingMatchesOrigin({scheme: 'https', host: 'A.Example'}, 'https://a.example')).toBe(true)
  })

  it('rejects a changed scheme or host', () => {
    expect(miauthPendingMatchesOrigin({scheme: 'https', host: 'a.example'}, 'https://b.example')).toBe(false)
    expect(miauthPendingMatchesOrigin({scheme: 'https', host: 'a.example'}, 'http://a.example')).toBe(false)
    expect(miauthPendingMatchesOrigin({scheme: 'http', host: 'a.example'}, 'https://a.example')).toBe(false)
  })
})

describe('miauthAccountMatchesHost', () => {
  it('accepts local accounts and same-host remotes', () => {
    expect(miauthAccountMatchesHost({host: null}, 'a.example')).toBe(true)
    expect(miauthAccountMatchesHost({host: 'a.example'}, 'a.example')).toBe(true)
    expect(miauthAccountMatchesHost({host: 'A.Example'}, 'a.example')).toBe(true)
  })

  it('discards accounts naming a different host', () => {
    expect(miauthAccountMatchesHost({host: 'evil.example'}, 'a.example')).toBe(false)
    expect(miauthAccountMatchesHost({host: 'b.example'}, 'a.example')).toBe(false)
  })
})
