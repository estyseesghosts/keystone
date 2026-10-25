// Repair X3.1 — unmount and account-switch abort in-flight reads.
//
// - Unmounting a screen mid-request aborts its fetch: the fetch mock sees
//   `signal.aborted` flip (react-query consumes the signal only when the
//   queryFn threads it — an ignored signal never aborts).
// - Switching accounts aborts the previous session's requests and never
//   shows its data (signal of session A aborts; session B still resolves).
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'
import React from 'react'

import {
  type Backend,
  type Page,
  type Post,
} from '@keystone/fedi'

import {feedItems, usePostFeedQuery} from './usePostFeedQuery'

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

function post(id: string): Post {
  return {id} as unknown as Post
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: 60_000}},
  })
}

function wrapper(client: QueryClient) {
  return function Wrapper({children}: {children: React.ReactNode}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** A backend whose timeline hangs until its signal aborts (like a real fetch). */
function hangingTimeline(seen: Array<AbortSignal | undefined>) {
  return jest.fn(async (_kind: string, opts?: {signal?: AbortSignal}) => {
    seen.push(opts?.signal)
    await new Promise<never>((_resolve, reject) => {
      opts?.signal?.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})),
        {once: true},
      )
    })
    throw new Error('unreachable: abort should have settled the query first')
  })
}

describe('X3.1 unmount aborts the in-flight feed request', () => {
  it('the fetch mock sees signal.aborted after unmount', async () => {
    const seen: Array<AbortSignal | undefined> = []
    const backend = {timeline: hangingTimeline(seen)} as unknown as Backend
    const {unmount} = renderHook(
      () => usePostFeedQuery('sess-a', 'timeline|home', {backend, retry: false}),
      {wrapper: wrapper(testClient())},
    )
    await waitFor(() => expect(backend.timeline).toHaveBeenCalled())
    expect(seen).toHaveLength(1)
    expect(seen[0]?.aborted).toBe(false)
    unmount()
    await waitFor(() => expect(seen[0]?.aborted).toBe(true))
  })
})

describe('X3.1 account switch aborts the previous session request', () => {
  it("session A's signal aborts; session B still resolves and never shows A's rows", async () => {
    const seenA: Array<AbortSignal | undefined> = []
    const seenB: Array<AbortSignal | undefined> = []
    const backendA = {timeline: hangingTimeline(seenA)} as unknown as Backend
    const backendB = {
      timeline: jest.fn(async (_kind: string, opts?: {signal?: AbortSignal}) => {
        seenB.push(opts?.signal)
        return page([post('b1')])
      }),
    } as unknown as Backend
    const {result, rerender} = renderHook(
      ({sessionId, backend}: {sessionId: string; backend: Backend}) =>
        usePostFeedQuery(sessionId, 'timeline|home', {backend, retry: false}),
      {initialProps: {sessionId: 'sess-a', backend: backendA}, wrapper: wrapper(testClient())},
    )
    await waitFor(() => expect(backendA.timeline).toHaveBeenCalled())
    rerender({sessionId: 'sess-b', backend: backendB})
    await waitFor(() => expect(feedItems(result.current.data).map(p => p.id)).toEqual(['b1']))
    expect(result.current.queryKey[0]).toBe('sess-b')
    // The previous session's request was aborted, not left running.
    expect(seenA).toHaveLength(1)
    expect(seenA[0]?.aborted).toBe(true)
    // The new session's request ran to completion on its own signal.
    expect(seenB).toHaveLength(1)
    expect(seenB[0]?.aborted).toBe(false)
    expect(feedItems(result.current.data).map(p => p.id)).not.toContain('a1')
  })
})
