// Delete-and-redraft (clickstone §1.7): the composer seed must preserve the
// payload, and a FAILED delete must never seat a composer as if it worked.
// Pure/in-memory: the backend is a stub, navigation lives in the card.

import type {Backend, Post} from '@keystone/fedi'

import {makeMedia, makePost} from '#/components/__tests__/fixtures'

import {
  clearRedraftSeeds,
  deleteAndRedraft,
  putRedraftSeed,
  takeRedraftSeed,
} from './redraft'

function backendWith(over: Partial<Backend> = {}) {
  const deletePost = jest.fn().mockResolvedValue(undefined)
  const post = jest.fn()
  const backend = {
    deletePost,
    post,
    ...over,
  } as unknown as Backend
  return {backend, deletePost, post}
}

function post(over: Partial<Post> = {}): Post {
  return makePost({
    id: 'p1',
    cw: 'spoilers',
    content: {mfm: 'Hello **world**', plain: 'Hello world'},
    visibility: {kind: 'quiet', localOnly: true, raw: 'home'},
    mediaIds: ['m1'],
    media: [makeMedia({id: 'm1', description: 'a cat', url: 'https://x/1.png'})],
    ...over,
  })
}

beforeEach(() => clearRedraftSeeds())

describe('deleteAndRedraft', () => {
  it('deletes with keepMedia BEFORE seeding, then hands the composer the payload', async () => {
    const calls: string[] = []
    const {backend} = backendWith({
      deletePost: jest.fn(async (_id: string, opts) => {
        calls.push(`delete:${String(opts?.keepMedia)}`)
      }),
    })
    const target = post({replyToId: 'parent'})
    await deleteAndRedraft(backend, target, {onDeleted: () => calls.push('onDeleted')})

    expect(calls).toEqual(['delete:true', 'onDeleted'])

    const seed = takeRedraftSeed('p1')
    expect(seed).not.toBeNull()
    expect(seed).toMatchObject({
      text: 'Hello **world**',
      cw: 'spoilers',
      cwEnabled: true,
      visibilityRaw: 'home',
      localOnly: true,
    })
    // Attachments keep their ids AND their current alt text (a redraft must
    // not lose either).
    expect(seed?.media).toEqual([
      {id: 'm1', alt: 'a cat', originalAlt: 'a cat', previewUrl: 'https://x/1.png', sensitive: false},
    ])
    // The seed is consumed once: a second composer cannot repost it.
    expect(takeRedraftSeed('p1')).toBeNull()
  })

  it('never seeds when the delete fails, and reports the failure', async () => {
    const onDeleted = jest.fn()
    const failure = Object.assign(new Error('nope'), {status: 403})
    const {backend} = backendWith({deletePost: jest.fn().mockRejectedValue(failure)})

    await expect(deleteAndRedraft(backend, post(), {onDeleted})).rejects.toBe(failure)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(takeRedraftSeed('p1')).toBeNull()
  })

  it('reattaches a reply target resolved by id, and drops one that is gone', async () => {
    const parent = makePost({id: 'parent'})
    const {backend} = backendWith({post: jest.fn().mockResolvedValue(parent)})
    await deleteAndRedraft(backend, post({replyToId: 'parent'}))
    expect(takeRedraftSeed('p1')?.replyTo).toBe(parent)

    clearRedraftSeeds()
    const gone = backendWith({post: jest.fn().mockRejectedValue(new Error('404'))})
    await deleteAndRedraft(gone.backend, post({replyToId: 'gone'}))
    expect(takeRedraftSeed('p1')?.replyTo).toBeNull()
  })

  it('carries a packed quote; an unloaded one stays null (never guessed)', async () => {
    const quoted = makePost({id: 'q1'})
    const {backend} = backendWith()
    await deleteAndRedraft(backend, post({quote: quoted, quoteUnavailable: false}))
    expect(takeRedraftSeed('p1')?.quote).toBe(quoted)

    clearRedraftSeeds()
    await deleteAndRedraft(backend, post({quote: null, quoteUnavailable: true}))
    expect(takeRedraftSeed('p1')?.quote).toBeNull()
  })

  it('drops a poll rather than reposting an emptied one', async () => {
    const {backend} = backendWith()
    await deleteAndRedraft(
      backend,
      post({
        poll: {
          options: [{text: 'a', votesCount: 3, voted: true}],
          multiple: false,
          expiresAt: null,
          expired: false,
          votesCount: 3,
          votersCount: 3,
        },
      }),
    )
    expect(takeRedraftSeed('p1')?.poll ?? null).toBeNull()
  })
})

describe('seed handoff', () => {
  it('is per post id and consumed once', () => {
    putRedraftSeed('a', {text: 'A'})
    putRedraftSeed('b', {text: 'B'})
    expect(takeRedraftSeed('a')?.text).toBe('A')
    expect(takeRedraftSeed('a')).toBeNull()
    expect(takeRedraftSeed('b')?.text).toBe('B')
  })
})
