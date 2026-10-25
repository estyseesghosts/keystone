// P4.2 — postActions queue ordering (controller level, no React).
//
// Each test names the contract: server calls run in toggle order per
// (session, post, kind); rapid toggles coalesce to the latest desired
// value; session A's queue never runs session B's backend; one kind's
// in-flight mutation never blocks another kind.
import type {Backend, Capabilities} from '@keystone/fedi'

import {makePost} from '#/components/__tests__/fixtures'
import {createPostActionController} from './postActions'
import {createPostShadowStore} from './post-shadow'

function capsWith(...on: string[]): Capabilities {
  const out: Record<string, string> = {}
  for (const key of on) out[key] = 'supported'
  return out as unknown as Capabilities
}

const favCaps = () => capsWith('reactions', 'favourites_distinct_from_reactions')

function deferred(): {promise: Promise<void>; release: () => void} {
  let release: () => void = () => {}
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return {promise, release}
}

describe('postActionController queue ordering (P4.2)', () => {
  it('true then false runs favourite then unfavourite, in order', async () => {
    const calls: string[] = []
    const gate = deferred()
    const backend = {
      capabilities: favCaps(),
      favourite: async (id: string) => {
        calls.push(`favourite:${id}`)
        await gate.promise
      },
      unfavourite: async (id: string) => {
        calls.push(`unfavourite:${id}`)
      },
    } as unknown as Backend
    const controller = createPostActionController({store: createPostShadowStore()})
    const post = makePost()
    const first = controller.setFavourite('sA', backend, post, true)
    const second = controller.setFavourite('sA', backend, post, false)
    gate.release()
    await Promise.all([first, second])
    expect(calls).toEqual(['favourite:p1', 'unfavourite:p1'])
  })

  it('true-false-true in flight coalesces to a single favourite call', async () => {
    const calls: string[] = []
    const gate = deferred()
    const backend = {
      capabilities: favCaps(),
      favourite: async (id: string) => {
        calls.push(`favourite:${id}`)
        await gate.promise
      },
      unfavourite: async (id: string) => {
        calls.push(`unfavourite:${id}`)
      },
    } as unknown as Backend
    const controller = createPostActionController({store: createPostShadowStore()})
    const post = makePost()
    const p1 = controller.setFavourite('sA', backend, post, true)
    const p2 = controller.setFavourite('sA', backend, post, false)
    const p3 = controller.setFavourite('sA', backend, post, true)
    gate.release()
    await Promise.all([p1, p2, p3])
    // The queue drains to the latest desired value: one create, no delete.
    expect(calls).toEqual(['favourite:p1'])
  })

  it('same post on two sessions runs each session backend, never crossed', async () => {
    const callsA: string[] = []
    const callsB: string[] = []
    const backendA = {
      capabilities: favCaps(),
      favourite: async (id: string) => {
        callsA.push(`favourite:${id}`)
      },
      unfavourite: async () => undefined,
    } as unknown as Backend
    const backendB = {
      capabilities: favCaps(),
      favourite: async (id: string) => {
        callsB.push(`favourite:${id}`)
      },
      unfavourite: async () => undefined,
    } as unknown as Backend
    const controller = createPostActionController({store: createPostShadowStore()})
    const post = makePost()
    await Promise.all([
      controller.setFavourite('sA', backendA, post, true),
      controller.setFavourite('sB', backendB, post, true),
    ])
    expect(callsA).toEqual(['favourite:p1'])
    expect(callsB).toEqual(['favourite:p1'])
  })

  it('an in-flight favourite never blocks a bookmark on the same post', async () => {
    const calls: string[] = []
    const gate = deferred()
    const backend = {
      capabilities: capsWith(
        'reactions',
        'favourites_distinct_from_reactions',
        'bookmarks',
      ),
      favourite: async () => {
        await gate.promise
      },
      unfavourite: async () => undefined,
      bookmarks: {
        add: async (id: string) => {
          calls.push(`bookmark:add:${id}`)
        },
        remove: async () => undefined,
      },
    } as unknown as Backend
    const controller = createPostActionController({store: createPostShadowStore()})
    const post = makePost()
    const fav = controller.setFavourite('sA', backend, post, true)
    await controller.setBookmarked('sA', backend, post, true)
    // The bookmark settled while the favourite was still in flight.
    expect(calls).toEqual(['bookmark:add:p1'])
    gate.release()
    await fav
  })
})
