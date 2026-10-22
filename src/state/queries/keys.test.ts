import {
  accountQueryKey,
  conversationQueryKey,
  conversationsQueryKey,
  createQueryKey,
  feedQueryKey,
  notificationsQueryKey,
  postQueryKey,
  reportRulesQueryKey,
} from './keys'

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
    // The report chooser's rule list is public per server but still cached
    // per session (two accounts on the same origin are separate sessions,
    // and the key rule is unconditional).
    expect(reportRulesQueryKey('sess-a')).toEqual(['sess-a', 'report-rules'])
    expect(reportRulesQueryKey('sess-a')).toEqual(reportRulesQueryKey('sess-a'))
  })

  it('refuses an empty sessionId — an unscoped key must never reach the cache', () => {
    expect(() => createQueryKey('')).toThrow()
  })

  it('scopes the DM inbox and threads by session first', () => {
    expect(conversationsQueryKey('sess-a')).toEqual(['sess-a', 'conversations'])
    expect(conversationsQueryKey('sess-a')).not.toEqual(conversationsQueryKey('sess-b'))
    expect(conversationQueryKey('sess-a', 'c1')).toEqual(['sess-a', 'conversation', 'c1'])
    expect(conversationQueryKey('sess-a', 'c1')).not.toEqual(conversationQueryKey('sess-b', 'c1'))
    expect(conversationQueryKey('sess-a', 'c1')).not.toEqual(conversationQueryKey('sess-a', 'c2'))
  })
})
