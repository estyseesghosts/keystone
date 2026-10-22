import {QueryClient} from '@tanstack/react-query'

import {createMemoryStore, type Backend, type Relationship} from '@keystone/fedi'

import {makePost} from '#/components/__tests__/fixtures'

import {createGraphController, createSoftMuteStore, isSoftMutedPost, relationshipQueryKey, GraphUnavailableError} from './graph'

const S1 = 'https://a.example acct1'
const S2 = 'https://b.example acct1'
const caps = {lists: 'supported'} as unknown as Backend['capabilities']

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

function fakeBackend(over: Partial<Record<string, jest.Mock>> = {}) {
  const b: any = {
    capabilities: caps,
    follow: jest.fn().mockResolvedValue(undefined),
    unfollow: jest.fn().mockResolvedValue(undefined),
    cancelFollowRequest: jest.fn().mockResolvedValue(undefined),
    mute: jest.fn().mockResolvedValue(undefined),
    unmute: jest.fn().mockResolvedValue(undefined),
    block: jest.fn().mockResolvedValue(undefined),
    unblock: jest.fn().mockResolvedValue(undefined),
    acceptFollowRequest: jest.fn().mockResolvedValue(undefined),
    rejectFollowRequest: jest.fn().mockResolvedValue(undefined),
    lists: {membership: {add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined), containing: jest.fn()}},
    ...over,
  }
  return b as Backend & Record<string, any>
}

const rel = (s: string, qc: QueryClient, id = 'u1') => qc.getQueryData<Relationship>(relationshipQueryKey(s, id))

describe('graph controller (slice 4.4)', () => {
  afterEach(() => jest.useRealTimers())

  it('follow flips optimistically and confirms', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend()
    const p = c.setFollow(S1, b, {id: 'u1'}, 'following')
    expect(rel(S1, qc)?.isFollowing).toBe(true)
    await p
    expect(b.follow).toHaveBeenCalledWith('u1')
  })

  it('locked account becomes requested; unfollow then cancels the request', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend()
    await c.setFollow(S1, b, {id: 'u1', locked: true}, 'following')
    expect(rel(S1, qc)).toMatchObject({hasPendingFollowRequestFromYou: true, isFollowing: false})
    await c.setFollow(S1, b, {id: 'u1', locked: true}, 'none')
    expect(b.cancelFollowRequest).toHaveBeenCalledWith('u1')
    expect(b.unfollow).not.toHaveBeenCalled()
  })

  it('rolls back on reject', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend({follow: jest.fn().mockRejectedValue(new Error('nope'))})
    qc.setQueryData(relationshipQueryKey(S1, 'u1'), {id: 'u1'})
    await expect(c.setFollow(S1, b, {id: 'u1'}, 'following')).rejects.toThrow('nope')
    expect(rel(S1, qc)?.isFollowing).toBeFalsy()
  })

  it('coalesces follow -> unfollow in flight into create then delete', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const d = deferred()
    const b = fakeBackend({follow: jest.fn().mockReturnValue(d.promise)})
    const p1 = c.setFollow(S1, b, {id: 'u1'}, 'following')
    const p2 = c.setFollow(S1, b, {id: 'u1'}, 'none')
    expect(rel(S1, qc)?.isFollowing).toBeFalsy()
    d.resolve()
    await Promise.all([p1, p2])
    expect(b.follow).toHaveBeenCalledTimes(1)
    expect(b.unfollow).toHaveBeenCalledTimes(1)
  })

  it('mute and block with rollback; block clears follow', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend({block: jest.fn().mockRejectedValue(new Error('x'))})
    qc.setQueryData(relationshipQueryKey(S1, 'u1'), {id: 'u1', isFollowing: true})
    await c.setMuted(S1, b, 'u1', true)
    expect(rel(S1, qc)?.isMuted).toBe(true)
    await expect(c.setBlocked(S1, b, 'u1', true)).rejects.toThrow()
    expect(rel(S1, qc)).toEqual({id: 'u1', isFollowing: true, isMuted: true})
  })

  it('gates: no capabilities / self never call the backend', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend()
    await expect(c.setMuted(S1, null, 'u1', true)).rejects.toBeInstanceOf(GraphUnavailableError)
    expect(rel(S1, qc)).toBeUndefined()
    const noMembership = fakeBackend({lists: undefined})
    await expect(c.setListMember(S1, noMembership, 'l1', 'u1', true)).rejects.toBeInstanceOf(GraphUnavailableError)
    const noLists = fakeBackend()
    ;(noLists as any).capabilities = {lists: 'unsupported'}
    await expect(c.setListMember(S1, noLists, 'l1', 'u1', true)).rejects.toMatchObject({reasonCode: 'gate.noLists'})
    expect(b.mute).not.toHaveBeenCalled()
  })

  it('follow request accept/reject with rollback', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    qc.setQueryData(relationshipQueryKey(S1, 'u1'), {id: 'u1', hasPendingFollowRequestToYou: true})
    const b = fakeBackend({rejectFollowRequest: jest.fn().mockRejectedValue(new Error('x'))})
    await c.resolveFollowRequest(S1, b, 'u1', true)
    expect(rel(S1, qc)).toMatchObject({hasPendingFollowRequestToYou: false, isFollowed: true})
    qc.setQueryData(relationshipQueryKey(S1, 'u1'), {id: 'u1', hasPendingFollowRequestToYou: true})
    await expect(c.resolveFollowRequest(S1, b, 'u1', false)).rejects.toThrow()
    expect(rel(S1, qc)?.hasPendingFollowRequestToYou).toBe(true)
  })

  it('list membership optimistic with rollback', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b = fakeBackend()
    b.lists!.membership!.add = jest.fn().mockRejectedValue(new Error('x'))
    qc.setQueryData([S1, 'list-membership', 'u1'], ['l0'])
    await expect(c.setListMember(S1, b, 'l1', 'u1', true)).rejects.toThrow()
    expect(qc.getQueryData([S1, 'list-membership', 'u1'])).toEqual(['l0'])
  })

  it('isolates sessions: state and backends never cross', async () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    const c = createGraphController({queryClient: qc})
    const b1 = fakeBackend()
    const b2 = fakeBackend()
    await c.setFollow(S1, b1, {id: 'u1'}, 'following')
    expect(rel(S2, qc)).toBeUndefined()
    expect(b2.follow).not.toHaveBeenCalled()
    await c.setMuted(S2, b2, 'u1', true)
    expect(rel(S1, qc)?.isMuted).toBeUndefined()
    expect(b1.mute).not.toHaveBeenCalled()
  })

  it('soft mute store is per session and persisted', () => {
    const mem = createMemoryStore()
    const s = createSoftMuteStore(() => mem)
    const fn = jest.fn()
    s.subscribe(fn)
    s.set(S1, 'u1', true)
    expect(s.has(S1, 'u1')).toBe(true)
    expect(s.has(S2, 'u1')).toBe(false)
    expect(fn).toHaveBeenCalled()
    expect(createSoftMuteStore(() => mem).has(S1, 'u1')).toBe(true)
  })
})

// The badge and the feed filter share this predicate, so a note the
// feed would have dropped is exactly the note the card marks.
describe('isSoftMutedPost', () => {
  const muted = makePost({id: 'm', author: {...makePost().author, id: 'muted-user'}})
  const plain = makePost({id: 'plain'})
  const renoteOf = (target: typeof plain) =>
    makePost({id: `rn-${target.id}`, renoteId: target.id, renote: target, content: {plain: ''}})

  it('no mutes means nothing is muted', () => {
    expect(isSoftMutedPost(muted, [])).toBe(false)
  })

  it('matches an author, not just an id in the list', () => {
    expect(isSoftMutedPost(muted, ['muted-user'])).toBe(true)
    expect(isSoftMutedPost(plain, ['muted-user'])).toBe(false)
  })

  it('matches a pure renote of a muted author (the rendered original)', () => {
    const wrapper = renoteOf(muted)
    expect(isSoftMutedPost(wrapper, ['muted-user'])).toBe(true)
  })

  it('leaves a renote of an unmuted author alone', () => {
    expect(isSoftMutedPost(renoteOf(plain), ['muted-user'])).toBe(false)
  })

  it('never marks a quote by an unmuted author, even of a muted one', () => {
    const quote = makePost({
      id: 'q',
      content: {plain: 'look at this'},
      quote: muted,
    })
    expect(isSoftMutedPost(quote, ['muted-user'])).toBe(false)
  })
})
