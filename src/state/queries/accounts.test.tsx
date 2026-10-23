// Mention → account resolution: handle parsing, session-first keys,
// backend lookup, and unresolved fallback (never a throw).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {renderHook, waitFor} from '@testing-library/react-native'

import type {Account, Backend} from '@keystone/fedi'

import {fullAccountQueryKey, mentionedAccountQueryKey, useFullAccount, useMentionedAccount} from './accounts'

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function wrapper(client: QueryClient) {
  return ({children}: {children: React.ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const alice = {
  id: 'u1',
  username: 'alice',
  host: 'example.social',
  acct: 'alice@example.social',
  name: 'Alice Liddell',
  displayName: 'Alice Liddell',
  avatarUrl: 'https://example.social/alice.png',
}

function fakeBackend(account: jest.Mock): Backend {
  return {account} as unknown as Backend
}

describe('useMentionedAccount', () => {
  it('resolves a handle through the session backend', async () => {
    const account = jest.fn(async () => alice)
    const {result} = renderHook(() => useMentionedAccount(fakeBackend(account), 'sess-a', '@alice@example.social'), {
      wrapper: wrapper(testClient()),
    })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.displayName).toBe('Alice Liddell')
    expect(account).toHaveBeenCalledWith({username: 'alice', host: 'example.social'})
  })

  it('keys by session, username and host', async () => {
    const account = jest.fn(async () => alice)
    const {result} = renderHook(() => useMentionedAccount(fakeBackend(account), 'sess-a', '@alice@example.social'), {
      wrapper: wrapper(testClient()),
    })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(mentionedAccountQueryKey('sess-a', 'alice', 'example.social')[0]).toBe('sess-a')
  })

  it('stays unresolved for unparseable labels and missing backends', () => {
    const account = jest.fn(async () => alice)
    const {result: badLabel} = renderHook(() => useMentionedAccount(fakeBackend(account), 'sess-a', 'not a handle!!'), {
      wrapper: wrapper(testClient()),
    })
    expect(badLabel.current).toBeNull()
    expect(account).not.toHaveBeenCalled()
    const {result: noBackend} = renderHook(() => useMentionedAccount(null, 'sess-a', '@alice@example.social'), {
      wrapper: wrapper(testClient()),
    })
    expect(noBackend.current).toBeNull()
  })

  it('stays unresolved when the lookup fails', async () => {
    const account = jest.fn(async () => {
      throw new Error('gone')
    })
    const {result} = renderHook(() => useMentionedAccount(fakeBackend(account), 'sess-a', '@alice@example.social'), {
      wrapper: wrapper(testClient()),
    })
    await waitFor(() => expect(account).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})

describe('useFullAccount', () => {
  const lite = {...alice, headerUrl: null} as unknown as Account
  const full = {...alice, headerUrl: 'https://example.social/banner.png'} as unknown as Account

  it('shows the embedded account immediately, then upgrades to the fetched full account', async () => {
    const account = jest.fn(async () => full)
    const {result} = renderHook(() => useFullAccount(fakeBackend(account), 'sess-a', lite), {
      wrapper: wrapper(testClient()),
    })
    // Embedded data renders at once (no blank card while fetching).
    expect(result.current?.username).toBe('alice')
    await waitFor(() => expect(result.current?.headerUrl).toBe('https://example.social/banner.png'))
    expect(account).toHaveBeenCalledWith({id: 'u1'})
    expect(fullAccountQueryKey('sess-a', 'u1')[0]).toBe('sess-a')
  })

  it('skips the fetch when the embedded account already has a banner', async () => {
    const account = jest.fn(async () => full)
    const {result} = renderHook(() => useFullAccount(fakeBackend(account), 'sess-a', full), {
      wrapper: wrapper(testClient()),
    })
    expect(result.current?.headerUrl).toBe('https://example.social/banner.png')
    // Give the query a chance to (not) fire.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(account).not.toHaveBeenCalled()
  })

  it('returns null without a backend or account and never fetches', () => {
    const account = jest.fn(async () => full)
    const {result: noBackend} = renderHook(() => useFullAccount(null, 'sess-a', lite), {
      wrapper: wrapper(testClient()),
    })
    expect(noBackend.current).toEqual(lite)
    const {result: noAccount} = renderHook(() => useFullAccount(fakeBackend(account), 'sess-a', null), {
      wrapper: wrapper(testClient()),
    })
    expect(noAccount.current).toBeNull()
    expect(account).not.toHaveBeenCalled()
  })
})
