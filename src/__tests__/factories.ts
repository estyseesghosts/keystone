// Typed test factories (repair X11.2, test quality).
//
// The app-side door of the single factory convention: `makePost` /
// `makeAccount` / `makeMedia` are re-exported from the existing
// `#/components/__tests__/fixtures` module (extended, not forked — that
// file is untouched and its 20+ importers keep working). Everything else
// here is new: session/notification builders, a fully typed `Backend`
// fake, fetch spies, and the composer-harness narrowers.
//
// Each builder centralises the casts suites used to repeat inline, so the
// `*.test.*` files stay cast-free. The remaining `as` expressions below
// live here, in a non-test helper — never in a suite.

import type {
  Backend,
  Capabilities,
  Notification,
  ServerFamily,
  Session,
} from '@keystone/fedi'

import type {ComposerController} from '#/components/Composer/Composer'

export {makeAccount, makeMedia, makePost} from '#/components/__tests__/fixtures'

// --- Domain builders -------------------------------------------------------

/** A complete `Session`. `id` derives from origin + accountId unless given. */
export function makeSession(over: Partial<Session> = {}): Session {
  const origin = over.origin ?? 'https://s.example'
  const accountId = over.accountId ?? 'acc1'
  return {
    origin,
    family: 'misskey',
    flavor: 'misskey',
    accountId,
    token: 'test-token',
    grant: 'password',
    hosting: 'third-party',
    id: `${origin} ${accountId}`,
    ...over,
  }
}

export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    kind: 'mention',
    rawType: 'mention',
    createdAt: '2026-10-19T12:00:00.000Z',
    read: null,
    actors: [],
    post: null,
    reaction: null,
    ext: {},
    ...overrides,
  }
}

// --- Backend fake ----------------------------------------------------------

type AnyMockFn = (...args: any[]) => unknown

/** Object-typed `Backend` members accept partial sub-modules. */
type SubBackendOverrides<T> = {[K in keyof T]?: T[K] | jest.Mock}

type NestedBackendKey =
  | 'like'
  | 'search'
  | 'notificationRequests'
  | 'drive'
  | 'antennas'
  | 'clips'
  | 'lists'
  | 'channels'
  | 'announcements'
  | 'adminInsight'
  | 'reportsQueue'
  | 'conversations'
  | 'chat'
  | 'scheduled'
  | 'serverDrafts'
  | 'bookmarks'
  | 'filters'
  | 'explore'
  | 'tags'
  | 'recommendations'
  | 'domainBlocks'
  | 'transfer'

/**
 * Overrides for `makeBackend`: every method also accepts a `jest.Mock`
 * (mocks resolve partial rows — `{id, url}` media, `{id}` posts — that a
 * strict method slot would reject; the mock branch keeps those suites
 * compiling without per-site casts). Sub-modules accept partials, so
 * `{scheduled: {create}}` needs no cast either.
 */
export type BackendOverrides = {
  [K in Exclude<keyof Backend, NestedBackendKey>]?: Backend[K] | jest.Mock
} & {
  [K in NestedBackendKey]?: SubBackendOverrides<NonNullable<Backend[K]>> | jest.Mock
}

function stubMethod(name: string): AnyMockFn {
  return (..._args: any[]) => {
    throw new Error(`makeBackend: ${name} is not stubbed`)
  }
}

/**
 * A fully typed `Backend` fake: every required method throws an honest
 * "not stubbed" error unless overridden; every optional sub-module stays
 * `undefined` unless provided (so "unsupported module" branches keep
 * working exactly as with a `{}` literal).
 */
export function makeBackend(overrides: BackendOverrides = {}): Backend {
  const base = {
    family: 'misskey' as ServerFamily,
    capabilities: {} as Capabilities,
    timeline: stubMethod('timeline'),
    post: stubMethod('post'),
    thread: stubMethod('thread'),
    threadReplies: stubMethod('threadReplies'),
    reposts: stubMethod('reposts'),
    noteReactions: stubMethod('noteReactions'),
    createPost: stubMethod('createPost'),
    deletePost: stubMethod('deletePost'),
    editPost: stubMethod('editPost'),
    react: stubMethod('react'),
    unreact: stubMethod('unreact'),
    favourite: stubMethod('favourite'),
    unfavourite: stubMethod('unfavourite'),
    boost: stubMethod('boost'),
    unboost: stubMethod('unboost'),
    votePoll: stubMethod('votePoll'),
    resolveQuoteUri: stubMethod('resolveQuoteUri'),
    featuredPosts: stubMethod('featuredPosts'),
    accountFeaturedPosts: stubMethod('accountFeaturedPosts'),
    me: stubMethod('me'),
    account: stubMethod('account'),
    accountPosts: stubMethod('accountPosts'),
    followers: stubMethod('followers'),
    following: stubMethod('following'),
    relationships: stubMethod('relationships'),
    follow: stubMethod('follow'),
    unfollow: stubMethod('unfollow'),
    accountReactions: stubMethod('accountReactions'),
    pinPost: stubMethod('pinPost'),
    unpinPost: stubMethod('unpinPost'),
    followRequests: stubMethod('followRequests'),
    acceptFollowRequest: stubMethod('acceptFollowRequest'),
    rejectFollowRequest: stubMethod('rejectFollowRequest'),
    cancelFollowRequest: stubMethod('cancelFollowRequest'),
    updateProfile: stubMethod('updateProfile'),
    mutes: stubMethod('mutes'),
    blocks: stubMethod('blocks'),
    mute: stubMethod('mute'),
    unmute: stubMethod('unmute'),
    muteRenotes: stubMethod('muteRenotes'),
    unmuteRenotes: stubMethod('unmuteRenotes'),
    block: stubMethod('block'),
    unblock: stubMethod('unblock'),
    muteThread: stubMethod('muteThread'),
    reportAccount: stubMethod('reportAccount'),
    search: {
      posts: stubMethod('search.posts'),
      tags: stubMethod('search.tags'),
      accounts: stubMethod('search.accounts'),
    },
    notifications: stubMethod('notifications'),
    markNotificationsRead: stubMethod('markNotificationsRead'),
    customEmojis: stubMethod('customEmojis'),
    uploadMedia: stubMethod('uploadMedia'),
    translate: stubMethod('translate'),
    stream: stubMethod('stream'),
  }
  return {...base, ...overrides} as unknown as Backend
}

// --- Fetch doubles ---------------------------------------------------------

export type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>

/**
 * A `typeof fetch`-typed spy around `handler`. The mock handle is returned
 * alongside so tests can assert call counts without casting
 * `fetchImpl.mock.calls[0]` (see `firstFetchCall`).
 */
export function makeFetchSpy(
  handler: FetchHandler = () => new Response('{}', {status: 200}),
): {fetchImpl: typeof fetch; mock: jest.Mock} {
  const mock: jest.Mock = jest.fn((...args: any[]) =>
    handler(String(args[0]), (args[1] ?? {}) as RequestInit),
  )
  const fetchImpl: typeof fetch = mock
  return {fetchImpl, mock}
}

/** The `[url, init]` pair of one recorded fetch call, fully typed. */
export function fetchCallAt(mock: jest.Mock, index = 0): [string, RequestInit] {
  const call = mock.mock.calls[index] as [unknown, unknown?]
  return [String(call[0]), (call[1] ?? {}) as RequestInit]
}

/** Shorthand for the first recorded call (the common single-request case). */
export function firstFetchCall(mock: jest.Mock): [string, RequestInit] {
  return fetchCallAt(mock, 0)
}

// --- Small fakes -----------------------------------------------------------

/** A `File`-shaped stub carrying only size/name/type (never read further). */
export function makeTestFile(init: {size: number; name: string; type?: string}): File {
  return init as File
}

/**
 * Narrow an intentionally partial composer harness to the full controller
 * type. Harnesses build a small slice of a 100+ member hook return; the
 * single sanctioned cast lives here instead of at every call site.
 */
export function asController(c: unknown): ComposerController {
  return c as ComposerController
}

/** Same, for the visibility-options array harnesses build literally. */
export function asControllerOptions(c: unknown): ComposerController['options'] {
  return c as ComposerController['options']
}
