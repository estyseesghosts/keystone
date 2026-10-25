// P4.1: `usePostActions` return identity. A feed scroll re-renders every
// row; if this hook allocated a fresh `PostActions` (and fresh `toggle`
// closures) per render, every memoized row + ActionBar below would
// invalidate on every frame. This pins the contract: same inputs (same
// session/post/backend, no shadow change) → referentially identical
// return; changed post → new return (the memo is keyed, not frozen).
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render} from '@testing-library/react-native'
import React from 'react'

import {createMemoryStore} from '@keystone/fedi'

import {makePost} from '#/components/__tests__/fixtures'
import {SessionProvider} from '#/state/session/SessionProvider'
import {createSessionStore} from '#/state/session/store'

import {usePostActions, type PostActions} from './postActions'

function memoryStore() {
  return createSessionStore({
    storage: createMemoryStore(),
    vault: {
      getToken: async () => null,
      setToken: async () => {},
      removeToken: async () => {},
    },
    homeOrigin: 'https://example.social',
  })
}

function Probe({onActions, postId}: {onActions: (a: PostActions) => void; postId: string}) {
  // Same post id across renders keeps the object identity stable; the
  // caller varies `postId` to prove the memo is keyed, not frozen.
  const post = React.useMemo(() => makePost({id: postId}), [postId])
  const actions = usePostActions('sess-identity', post)
  onActions(actions)
  return null
}

describe('usePostActions identity (P4.1)', () => {
  it('returns the same object across renders that change nothing', () => {
    const client = new QueryClient()
    const store = memoryStore()
    const ui = (postId: string) => (
      <QueryClientProvider client={client}>
        <SessionProvider homeOrigin="https://example.social" store={store}>
          <Probe onActions={a => seen.push(a)} postId={postId} />
        </SessionProvider>
      </QueryClientProvider>
    )
    const seen: PostActions[] = []
    const screen = render(ui('identity-post'))
    screen.rerender(ui('identity-post'))
    screen.rerender(ui('identity-post'))
    // Every render after the first must reuse the memoized value (the
    // probe's own post memo keeps the post identity stable, mirroring a
    // cached feed row whose query data did not change).
    expect(seen.length).toBeGreaterThan(1)
    for (const a of seen) expect(a).toBe(seen[0])
    // …including the nested toggle closures ActionBar invokes.
    expect(seen[1]!.reaction.set).toBe(seen[0]!.reaction.set)
    expect(seen[1]!.delete.run).toBe(seen[0]!.delete.run)
  })

  it('returns a new object when the post actually changes', () => {
    const client = new QueryClient()
    const store = memoryStore()
    const seen: PostActions[] = []
    const ui = (postId: string) => (
      <QueryClientProvider client={client}>
        <SessionProvider homeOrigin="https://example.social" store={store}>
          <Probe onActions={a => seen.push(a)} postId={postId} />
        </SessionProvider>
      </QueryClientProvider>
    )
    const screen = render(ui('identity-before'))
    screen.rerender(ui('identity-after'))
    const last = seen[seen.length - 1]!
    expect(seen.length).toBeGreaterThan(1)
    expect(last).not.toBe(seen[0])
    // …and the new value carries the new post's rendered state.
    expect(last.shadowed.post.id).toBe('identity-after')
  })
})
