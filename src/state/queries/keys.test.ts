import {accountQueryKey, createQueryKey, feedQueryKey, notificationsQueryKey, postQueryKey} from './keys'

describe('createQueryKey', () => {
  it('puts the sessionId first', () => {
    const key = createQueryKey('sess-a', 'post-feed', 'timeline|home')
    expect(key[0]).toBe('sess-a')
    expect(key).toEqual(['sess-a', 'post-feed', 'timeline|home'])
  })

  it('scopes identical feeds apart by session', () => {
    expect(feedQueryKey('sess-a', 'timeline|home')).not.toEqual(
      feedQueryKey('sess-b', 'timeline|home'),
    )
    expect(feedQueryKey('sess-a', 'timeline|home')).toEqual(
      feedQueryKey('sess-a', 'timeline|home'),
    )
  })

  it('scopes every helper by session first', () => {
    expect(postQueryKey('sess-a', 'p1')[0]).toBe('sess-a')
    expect(accountQueryKey('sess-a', 'u1')[0]).toBe('sess-a')
    expect(notificationsQueryKey('sess-a')[0]).toBe('sess-a')
    expect(postQueryKey('sess-a', 'p1')).not.toEqual(postQueryKey('sess-b', 'p1'))
  })

  it('refuses an empty sessionId — an unscoped key must never reach the cache', () => {
    expect(() => createQueryKey('')).toThrow()
  })
})
