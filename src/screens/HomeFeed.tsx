// Shared feed contract for the read-path screens (slices 3.4–3.7).
//
// FALLBACK STUB — owned by slice 3.4. Slice 3.2 (query layer) owns the real
// `usePostFeedQuery(sessionId, descriptor)` built on TanStack Query with
// persisted storage. This stub implements the SAME signature and return
// shape against the session's Backend directly, so every screen below can
// be written against the contract now and switch to the 3.2 hook without
// changing call sites. Delete this stub when 3.2 lands.
//
// The old Keystone feed-visibility RULE (ported as data, not the component):
// Local is hidden while Social exists, and Federated/Global is never the
// default tab. See `visibleNetworkTabs` / `defaultNetworkTab`.
import {useMemo, useSyncExternalStore, useEffect, useRef, useState, useCallback} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {
  appendOlder,
  backendForSession,
  displayNameOf,
  handleOf,
  isPureRenote,
  isUnsupportedError,
  type Backend,
  type Cursor,
  type Page,
  type Post,
  type ServerFamily,
  type Session,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import type {NetworkTab} from '#/routes'
import {useSessionStore} from '#/state/session/SessionProvider'

// --- Feed descriptors (plan §2; the deck's addressing from day one) --------

export type TimelineFeedKind = 'home' | 'local' | 'social' | 'global'
export type ProfileFeedTab = 'posts' | 'replies' | 'media' | 'featured'

export type FeedDescriptor =
  | `timeline|${TimelineFeedKind}`
  | `user|${string}|${ProfileFeedTab}`
  | `tag|${string}`

export type ParsedDescriptor =
  | {kind: 'timeline'; timeline: TimelineFeedKind}
  | {kind: 'user'; userId: string; tab: ProfileFeedTab}
  | {kind: 'tag'; tag: string}
  | {kind: 'unknown'}

/** Parse a descriptor string. Never throws; unknown shapes report `unknown`. */
export function parseFeedDescriptor(descriptor: FeedDescriptor): ParsedDescriptor {
  const parts = descriptor.split('|')
  if (parts[0] === 'timeline' && parts.length === 2) {
    const timeline = parts[1]
    if (timeline === 'home' || timeline === 'local' || timeline === 'social' || timeline === 'global') {
      return {kind: 'timeline', timeline}
    }
  }
  if (parts[0] === 'user' && parts.length >= 3) {
    const tab = parts[parts.length - 1]
    if (tab === 'posts' || tab === 'replies' || tab === 'media' || tab === 'featured') {
      return {kind: 'user', userId: parts.slice(1, -1).join('|'), tab}
    }
  }
  if (parts[0] === 'tag' && parts.length === 2 && parts[1].length > 0) {
    return {kind: 'tag', tag: parts[1]}
  }
  return {kind: 'unknown'}
}

/** Every query key includes the session id: switching accounts can never
 * show the previous account's data. The 3.2 hook must keep this key shape. */
export function feedQueryKey(
  sessionId: string | null,
  descriptor: FeedDescriptor,
): ['post-feed', string | null, FeedDescriptor] {
  return ['post-feed', sessionId, descriptor]
}

// --- Feed-visibility rule (ported rule, own code) ---------------------------

/** Social (Misskey hybrid) exists everywhere except the Mastodon family,
 * which answers it as unsupported rather than an empty feed. */
export function supportsSocialTimeline(family: ServerFamily | null | undefined): boolean {
  return family === 'misskey'
}

/**
 * Visible Network tabs for a server family. Local is hidden while Social
 * exists (Misskey family); the Mastodon family has no Social timeline, so
 * Local stays visible there.
 */
export function visibleNetworkTabs(family: ServerFamily | null | undefined): NetworkTab[] {
  if (supportsSocialTimeline(family)) return ['social', 'global']
  return ['local', 'global']
}

/** Federated/Global is never the default tab. */
export function defaultNetworkTab(family: ServerFamily | null | undefined): NetworkTab {
  const [first] = visibleNetworkTabs(family)
  return first === 'global' ? 'local' : first
}

export function descriptorForNetworkTab(tab: NetworkTab): FeedDescriptor {
  return `timeline|${tab}`
}

export function profileTabDescriptor(userId: string, tab: ProfileFeedTab): FeedDescriptor {
  return `user|${userId}|${tab}`
}

/** Account-post options per profile tab. The `posts` tab sends explicit
 * `false`s because the server defaults differ (`withRenotes` defaults to
 * true server-side). */
export function profileTabOpts(tab: ProfileFeedTab): {
  withReplies?: boolean
  withRenotes?: boolean
  withFiles?: boolean
  featured?: boolean
} {
  switch (tab) {
    case 'posts':
      return {withReplies: false, withRenotes: false}
    case 'replies':
      return {withReplies: true, withRenotes: false}
    case 'media':
      return {withFiles: true}
    case 'featured':
      return {featured: true}
  }
}

// --- New-posts pill counting (pure, tested) ---------------------------------

/**
 * How many items sit above the last-seen first id. First load (no baseline)
 * reports 0 — the list IS the baseline. A baseline the server no longer
 * returns means everything on screen is unseen.
 */
export function countNewItems(items: Array<{id: string}>, baselineFirstId: string | null): number {
  if (!baselineFirstId) return 0
  const idx = items.findIndex(i => i.id === baselineFirstId)
  return idx < 0 ? items.length : idx
}

// --- Session / backend access -----------------------------------------------

export function useActiveBackend(): {session: Session | null; backend: Backend | null} {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const session = snapshot.sessions.find(s => s.id === snapshot.activeId) ?? null
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  return {session, backend}
}

/** Resolve the Backend for an arbitrary session id (per-column accounts). */
export function useBackendForSessionId(sessionId: string | null): Backend | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => {
    if (!sessionId) return null
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
    return session ? backendForSession(session) : null
  }, [snapshot, sessionId])
}

// --- Feed fetching ----------------------------------------------------------

async function fetchFeedPage(
  backend: Backend,
  descriptor: FeedDescriptor,
  cursor: Cursor | null,
): Promise<Page<Post>> {
  const parsed = parseFeedDescriptor(descriptor)
  if (parsed.kind === 'timeline') return backend.timeline(parsed.timeline, {cursor})
  if (parsed.kind === 'user') {
    if (parsed.tab === 'featured') return backend.accountFeaturedPosts(parsed.userId, {cursor})
    return backend.accountPosts(parsed.userId, {...profileTabOpts(parsed.tab), cursor})
  }
  if (parsed.kind === 'tag') return backend.search.tags(parsed.tag, {cursor})
  throw new Error(`Unsupported feed descriptor: ${descriptor}`)
}

export interface PostFeedResult {
  items: Post[]
  isLoading: boolean
  isError: boolean
  error: unknown
  /** True when the server honestly lacks this feed (unsupported endpoint). */
  unavailable: boolean
  isFetching: boolean
  isFetchingMore: boolean
  hasMore: boolean
  newCount: number
  queryKey: ['post-feed', string | null, FeedDescriptor]
  refetch: () => Promise<void>
  fetchMore: () => Promise<void>
  acknowledgeNew: () => void
}

const EMPTY: Post[] = []

/**
 * Fallback `usePostFeedQuery(sessionId, descriptor)` (see header). Plain
 * fetch + cursor paging; state is keyed by session id + descriptor so an
 * account switch resets instead of leaking rows across accounts.
 */
export function usePostFeedQuery(
  sessionId: string | null,
  descriptor: FeedDescriptor,
  opts: {backend?: Backend | null} = {},
): PostFeedResult {
  const storeBackend = useBackendForSessionId(sessionId)
  const backend = opts.backend !== undefined ? opts.backend : storeBackend
  const [items, setItems] = useState<Post[]>(EMPTY)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [newCount, setNewCount] = useState(0)
  const baselineRef = useRef<string | null>(null)
  const generationRef = useRef(0)

  const queryKey = feedQueryKey(sessionId, descriptor)

  const loadFirst = useCallback(async () => {
    if (!sessionId || !backend) {
      setItems(EMPTY)
      setIsLoading(false)
      setIsFetching(false)
      return
    }
    const generation = ++generationRef.current
    setIsFetching(true)
    setError(null)
    try {
      const page = await fetchFeedPage(backend, descriptor, null)
      if (generationRef.current !== generation) return
      setNewCount(countNewItems(page.items, baselineRef.current))
      if (!baselineRef.current && page.items.length > 0) baselineRef.current = page.items[0].id
      setItems(page.items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      if (generationRef.current !== generation) return
      setError(err)
    } finally {
      if (generationRef.current === generation) {
        setIsLoading(false)
        setIsFetching(false)
      }
    }
  }, [sessionId, backend, descriptor])

  // Reset on key change (account switch or descriptor change).
  useEffect(() => {
    baselineRef.current = null
    setItems(EMPTY)
    setCursor(null)
    setHasMore(true)
    setIsLoading(true)
    setError(null)
    setNewCount(0)
    void loadFirst()
  }, [loadFirst])

  const fetchMore = useCallback(async () => {
    if (!sessionId || !backend || isFetchingMore || isLoading || !hasMore) return
    const generation = generationRef.current
    setIsFetchingMore(true)
    try {
      const page = await fetchFeedPage(backend, descriptor, cursor)
      if (generationRef.current !== generation) return
      setItems(prev => appendOlder(prev, page.items).items)
      setCursor(page.cursor)
      setHasMore(!page.end)
    } catch (err) {
      if (generationRef.current !== generation) return
      setError(err)
    } finally {
      if (generationRef.current === generation) setIsFetchingMore(false)
    }
  }, [sessionId, backend, descriptor, cursor, isFetchingMore, isLoading, hasMore])

  const acknowledgeNew = useCallback(() => {
    setNewCount(0)
    baselineRef.current = items[0]?.id ?? null
  }, [items])

  return {
    items,
    isLoading,
    isError: error != null,
    error,
    unavailable: error != null && isUnsupportedError(error),
    isFetching,
    isFetchingMore,
    hasMore,
    newCount,
    queryKey,
    refetch: loadFirst,
    fetchMore,
    acknowledgeNew,
  }
}

// --- Post row (read-only; actions are Phase 4) ------------------------------

function countsLine(post: Post): string {
  const parts = [`${post.counts.replies} replies`, `${post.counts.boosts} boosts`]
  if (post.reactions) parts.push(`${post.reactions.total} reactions`)
  if (post.favourite) parts.push(`${post.favourite.count} likes`)
  return parts.join(' · ')
}

export function PostRow({post, testID}: {post: Post; testID?: string}) {
  const renoteHeader = isPureRenote(post) ? (
    <Caption color="faint">{`@${post.author.username} reposted`}</Caption>
  ) : null
  const shown = isPureRenote(post) && post.renote ? post.renote : post
  return (
    <View testID={testID ?? `post-${shown.id}`} style={[atoms.py_sm, atoms.px_md]}>
      {renoteHeader}
      <Body>{displayNameOf(shown.author)}</Body>
      <Caption color="faint">{handleOf(shown.author)}</Caption>
      <Caption color="faint">{shown.createdAt}</Caption>
      {shown.cw ? <Body>{`CW: ${shown.cw}`}</Body> : null}
      <Body>{shown.content.plain}</Body>
      <Caption color="faint">{countsLine(shown)}</Caption>
    </View>
  )
}

// --- Feed view: refresh + pill + empty/loading/error ------------------------

export function FeedView({
  sessionId,
  descriptor,
  backend,
  testID,
}: {
  sessionId: string | null
  descriptor: FeedDescriptor
  /** Injected backend (tests, per-column accounts). Defaults to the session's. */
  backend?: Backend | null
  testID?: string
}) {
  const storeBackend = useBackendForSessionId(sessionId)
  const resolved = backend !== undefined ? backend : storeBackend
  const feed = usePostFeedQuery(sessionId, descriptor, {backend: resolved})

  if (!sessionId || !resolved) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>Sign in to see this feed.</Body>
        <Caption color="faint">Feeds never show sample data when signed out.</Caption>
      </View>
    )
  }

  if (feed.isLoading) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="feed-loading" />
        <Caption color="faint">Loading…</Caption>
      </View>
    )
  }

  if (feed.isError) {
    return (
      <View testID={testID} style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{feed.unavailable ? 'Not on this server.' : 'Could not load this feed.'}</Body>
        <Caption color="faint">
          {feed.unavailable
            ? 'This server has no equivalent for this timeline.'
            : 'Check your connection and try again.'}
        </Caption>
        <Button label="Retry" variant="secondary" onPress={() => void feed.refetch()} testID="feed-retry" />
      </View>
    )
  }

  return (
    <View testID={testID} style={atoms.flex1}>
      {feed.newCount > 0 ? (
        <View style={[atoms.itemsCenter, atoms.py_sm]}>
          <Button
            label={`${feed.newCount} new posts`}
            variant="secondary"
            onPress={feed.acknowledgeNew}
            testID="new-posts-pill"
          />
        </View>
      ) : null}
      <FlatList
        data={feed.items}
        keyExtractor={item => item.id}
        renderItem={({item}) => <PostRow post={item} />}
        refreshControl={
          <RefreshControl refreshing={feed.isFetching} onRefresh={() => void feed.refetch()} />
        }
        onEndReached={() => void feed.fetchMore()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <View style={[atoms.centered, atoms.p_md]}>
            <Body>Nothing here yet.</Body>
            <Caption color="faint">Pull to refresh.</Caption>
          </View>
        }
        ListFooterComponent={
          feed.isFetchingMore ? (
            <View style={[atoms.centered, atoms.py_sm]}>
              <Loader testID="feed-more-loading" />
            </View>
          ) : null
        }
      />
    </View>
  )
}

/** Screen heading helper: keeps Home/Network/User/Notifications chrome consistent. */
export function FeedHeading({title, subtitle}: {title: string; subtitle?: string}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Heading>{title}</Heading>
      {subtitle ? <Caption color="faint">{subtitle}</Caption> : null}
    </View>
  )
}
