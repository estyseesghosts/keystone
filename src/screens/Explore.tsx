// Explore (`/explore/:tab?`, v1 `routes/Explore.tsx` parity): trending
// content per tab when idle, search results while a query is active.
//
// Tabs are URL-backed: the active tab lives in the `:tab` route param
// (read with `useRoute`), so browser back and deep links like
// `/explore/tags` restore it. Switching tabs navigates to `Explore` with
// `{tab}`. `users` / `tags` / `posts` always render; `news` renders ONLY
// when `backend.explore.news` exists — otherwise the tab is hidden, never
// disabled (v1 hides unsupported tabs). Bare `/explore` opens `posts`,
// and legacy `/search?tag=cats` arrives here with a `tag` query param
// that seeds the posts-tab query.
//
// Every list is gated on a real backend member: a missing `explore`
// module degrades to search-only with honest unavailable states, and
// each `#`/`@` autocomplete popup renders only when its `suggest*`
// member exists. No fake data, ever.

import {useEffect, useRef, useState} from 'react'
import {FlatList, Image, StyleSheet, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {
  displayNameOf,
  handleOf,
  isUnsupportedError,
  type Account,
  type Backend,
  type ExploreUsers,
  type FeedDescriptor,
  type NewsLink,
  type Post,
  type TrendingTag,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import {ExploreSearchBar} from '#/components/Explore/ExploreSearchBar'
import {ExploreSuggestPopup} from '#/components/Explore/ExploreSuggestPopup'
import {ExploreTabBar} from '#/components/Explore/ExploreTabBar'
import {i18n} from '#/locale/i18n'
import {applySuggestion, suggestTrigger} from '#/components/Explore/suggest'
import {exploreTabFromParam, type ExploreTab, type RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

const SUGGEST_LIMIT = 8
const SUGGEST_DEBOUNCE_MS = 250

/** `|` is the descriptor segment separator — never content. */
function safeDescriptorArg(value: string): string {
  return value.replace(/\|/g, ' ').trim()
}

function stripTagPrefix(query: string): string {
  return query.replace(/^#+/, '').trim()
}

// --- Rows -------------------------------------------------------------------

/** 1px theme-border rule between explore entries (v1 feed rule, same as
 * the post separators). */
function RowSeparator({testID}: {testID: string}) {
  const theme = useTheme()
  return <View testID={testID} style={{height: 1, backgroundColor: theme.palette.border}} />
}

function ExploreAvatar({account}: {account: Account}) {
  const theme = useTheme()
  const label = displayNameOf(account).slice(0, 1).toUpperCase()
  if (account.avatarUrl) {
    return (
      <Image
        source={{uri: account.avatarUrl}}
        style={styles.avatar}
        accessibilityIgnoresInvertColors
        accessibilityLabel={`${displayNameOf(account)} profile picture`}
        testID={`explore-avatar-${account.id}`}
      />
    )
  }
  return (
    <View
      style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.raise}]}
      testID={`explore-avatar-${account.id}`}>
      <Body>{label}</Body>
    </View>
  )
}

function AccountRow({account, onOpen}: {account: Account; onOpen: () => void}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={displayNameOf(account)}
      testID={`explore-account-${account.id}`}>
      <View style={[atoms.py_sm, atoms.px_md, styles.accountRow]}>
        <ExploreAvatar account={account} />
        <View style={styles.accountText}>
          <Body>{displayNameOf(account)}</Body>
          <Caption color="faint">{handleOf(account)}</Caption>
        </View>
      </View>
    </Pressable>
  )
}

function TagChip({tag, onOpen}: {tag: TrendingTag; onOpen: () => void}) {
  const counts =
    tag.users != null || tag.uses != null
      ? [tag.users != null ? `${tag.users} people` : null, tag.uses != null ? `${tag.uses} posts` : null]
          .filter(Boolean)
          .join(' · ')
      : null
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`#${tag.name}`}
      testID={`explore-tag-${tag.name}`}>
      <View style={[atoms.py_sm, atoms.px_md]}>
        <Body>{`#${tag.name}`}</Body>
        {counts ? <Caption color="faint">{counts}</Caption> : null}
      </View>
    </Pressable>
  )
}

function NewsCard({link}: {link: NewsLink}) {
  const theme = useTheme()
  return (
    <View style={[atoms.py_sm, atoms.px_md, styles.newsRow]} testID="explore-news-item">
      {link.image ? (
        <Image
          source={{uri: link.image}}
          style={[styles.newsPhoto, {backgroundColor: theme.palette.raise}]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          testID="explore-news-photo"
        />
      ) : null}
      <View style={styles.newsText}>
        <Body>{link.title}</Body>
        {link.providerName ? <Caption color="faint">{link.providerName}</Caption> : null}
        {link.description ? <Caption color="faint">{link.description}</Caption> : null}
      </View>
    </View>
  )
}

function SectionTitle({label}: {label: string}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Caption color="faint">{label}</Caption>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {width: 44, height: 44, borderRadius: 22},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  accountRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  accountText: {flex: 1, minWidth: 0},
  // News photo: one fixed width everywhere, height follows each image's
  // own aspect (RN measures the intrinsic size once loaded). minHeight +
  // raise background holds a calm placeholder until the bytes arrive.
  newsRow: {flexDirection: 'row', gap: 12},
  newsPhoto: {width: 112, minHeight: 64, borderRadius: 8},
  newsText: {flex: 1, minWidth: 0, justifyContent: 'center'},
})

// --- Tab bodies --------------------------------------------------------------

function useOpenAccount() {
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  return (id: string) => navigation.navigate('User', {id})
}

function useOpenTag() {
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  return (tag: string) => navigation.navigate('Tag', {tag})
}

function AccountsSearch({backend, query}: {backend: Backend; query: string}) {
  const openAccount = useOpenAccount()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setAccounts(null)
    setError(false)
    void backend.search
      .accounts(query, {limit: 20})
      .then(page => {
        if (!cancelled) setAccounts(page.items)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [backend, query, attempt])
  if (error) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not search profiles.`)}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-accounts-retry" />
      </View>
    )
  }
  if (!accounts) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="explore-accounts-loading" />
      </View>
    )
  }
  if (accounts.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="explore-accounts-empty">
        <Body>{i18n._(msg`No profiles found.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      data={accounts}
      keyExtractor={a => a.id}
      testID="explore-accounts"
      ItemSeparatorComponent={() => <RowSeparator testID="explore-accounts-sep" />}
      renderItem={({item}) => <AccountRow account={item} onOpen={() => openAccount(item.id)} />}
    />
  )
}

function UsersTab({backend, submitted}: {backend: Backend; submitted: string | null}) {
  const openAccount = useOpenAccount()
  const [users, setUsers] = useState<ExploreUsers | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auth, setAuth] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (submitted != null) return
    if (!backend.explore) return
    let cancelled = false
    setUsers(null)
    setError(null)
    setAuth(false)
    void backend.explore
      .users({limit: 10})
      .then(u => {
        if (!cancelled) setUsers(u)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isUnsupportedError(err)) {
          setError('Trending users are not available on this server.')
        } else if (err instanceof Error && /401|403/.test(err.message)) {
          setAuth(true)
        } else {
          setError(err instanceof Error ? err.message : 'Could not load trending users.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [backend, submitted, attempt])
  if (submitted != null) {
    const name = submitted.replace(/^@+/, '').trim()
    if (!name) {
      return (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Type a profile name to search.`)}</Body>
        </View>
      )
    }
    return <AccountsSearch backend={backend} query={name} />
  }
  if (!backend.explore) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="explore-users-unavailable">
        <Body>{i18n._(msg`Trending users are not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`Type a query above to search profiles.`)}</Caption>
      </View>
    )
  }
  if (auth) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`Sign in to see suggested users.`)}</Body>
        <SignInButton />
      </View>
    )
  }
  if (error) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{error}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-users-retry" />
      </View>
    )
  }
  if (!users) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="explore-users-loading" />
      </View>
    )
  }
  if (users.pinned.length === 0 && users.suggested.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`No trending users right now.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      testID="explore-users"
      ItemSeparatorComponent={() => <RowSeparator testID="explore-users-sep" />}
      data={[
        ...(users.pinned.length > 0 ? [{key: 'pinned-label', label: 'Pinned'}] : []),
        ...users.pinned.map(a => ({key: `pinned-${a.id}`, account: a})),
        ...(users.suggested.length > 0 ? [{key: 'suggested-label', label: 'Suggested'}] : []),
        ...users.suggested.map(a => ({key: `suggested-${a.id}`, account: a})),
      ]}
      keyExtractor={row => row.key}
      renderItem={({item}) =>
        'label' in item ? (
          <SectionTitle label={item.label} />
        ) : (
          <AccountRow account={item.account} onOpen={() => openAccount(item.account.id)} />
        )
      }
    />
  )
}

function TagsTab({
  sessionId,
  backend,
  submitted,
}: {
  sessionId: string
  backend: Backend
  submitted: string | null
}) {
  const openTag = useOpenTag()
  const [tags, setTags] = useState<TrendingTag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [related, setRelated] = useState<string[] | null>(null)
  useEffect(() => {
    if (submitted != null) return
    if (!backend.explore) return
    let cancelled = false
    setTags(null)
    setError(null)
    void backend.explore
      .tags({limit: 10})
      .then(t => {
        if (!cancelled) setTags(t)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load trending tags.')
      })
    return () => {
      cancelled = true
    }
  }, [backend, submitted, attempt])
  useEffect(() => {
    if (submitted == null) {
      setRelated(null)
      return
    }
    if (!backend.search.suggestTags) {
      setRelated(null)
      return
    }
    let cancelled = false
    void backend.search
      .suggestTags(stripTagPrefix(submitted), {limit: 8})
      .then(names => {
        if (!cancelled) setRelated(names)
      })
      .catch(() => {
        if (!cancelled) setRelated(null)
      })
    return () => {
      cancelled = true
    }
  }, [backend, submitted])
  if (submitted != null) {
    const name = safeDescriptorArg(stripTagPrefix(submitted).replace(/^#+/, ''))
    if (!name) {
      return (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Type a tag to search.`)}</Body>
        </View>
      )
    }
    return (
      <View style={atoms.flex1}>
        {(related ?? []).length > 0 ? (
          <View testID="explore-related-tags">
            <SectionTitle label={i18n._(msg`Related tags`)} />
            {(related ?? []).map(n => (
              <TagChip key={n} tag={{name: n, users: null, uses: null}} onOpen={() => openTag(n)} />
            ))}
          </View>
        ) : null}
        <FeedView
          sessionId={sessionId}
          backend={backend}
          descriptor={`tag|${name}` as FeedDescriptor}
          testID="explore-tag-feed"
        />
      </View>
    )
  }
  if (!backend.explore) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="explore-tags-unavailable">
        <Body>{i18n._(msg`Trending tags are not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`Type a query above to browse a tag.`)}</Caption>
      </View>
    )
  }
  if (error) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{error}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-tags-retry" />
      </View>
    )
  }
  if (!tags) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="explore-tags-loading" />
      </View>
    )
  }
  if (tags.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`No trending tags right now.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      testID="explore-tags"
      data={tags}
      keyExtractor={t => t.name}
      ItemSeparatorComponent={() => <RowSeparator testID="explore-tags-sep" />}
      renderItem={({item}) => <TagChip tag={item} onOpen={() => openTag(item.name)} />}
    />
  )
}

function PostsTab({
  sessionId,
  backend,
  submitted,
}: {
  sessionId: string
  backend: Backend
  submitted: string | null
}) {
  // The posts tab is a normal feed, never a special view: idle shows the
  // trending-posts feed through the shared FeedView (same cards, same
  // moderation, same empty/loading/error honesty as every other feed); a
  // submitted query pages `search.posts` instead.
  if (submitted == null) {
    return (
      <FeedView
        sessionId={sessionId}
        backend={backend}
        descriptor="explore|posts"
        testID="explore-posts-feed"
      />
    )
  }
  const q = safeDescriptorArg(submitted.replace(/^#+/, ''))
  if (!q) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`Type a query to search posts.`)}</Body>
      </View>
    )
  }
  return (
    <FeedView
      sessionId={sessionId}
      backend={backend}
      descriptor={`search|${q}` as FeedDescriptor}
      testID="explore-search-feed"
    />
  )
}

function NewsTab({backend}: {backend: Backend}) {
  const [links, setLinks] = useState<NewsLink[]>([])
  const [cursor, setCursor] = useState<unknown>(null)
  const [end, setEnd] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!backend.explore?.news) return
    const news = backend.explore.news
    let cancelled = false
    setLoading(true)
    setError(null)
    void news({limit: 10})
      .then(page => {
        if (cancelled) return
        setLinks(page.items)
        setCursor(page.cursor)
        setEnd(page.end)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load news.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [backend, attempt])
  if (!backend.explore?.news) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`News is not available on this server.`)}</Body>
      </View>
    )
  }
  if (loading && links.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="explore-news-loading" />
      </View>
    )
  }
  if (error && links.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{error}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-news-retry" />
      </View>
    )
  }
  if (links.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`No news right now.`)}</Body>
      </View>
    )
  }
  const loadMore = () => {
    const news = backend.explore?.news
    if (!news || loading || end || cursor == null) return
    setLoading(true)
    void news({limit: 10, cursor: cursor as never})
      .then(page => {
        const seen = new Set(links.map(l => l.url))
        setLinks(prev => [...prev, ...page.items.filter(l => !seen.has(l.url))])
        setCursor(page.cursor)
        setEnd(page.end)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load more news.')
      })
      .finally(() => setLoading(false))
  }
  return (
    <FlatList
      testID="explore-news"
      data={links}
      keyExtractor={l => l.url}
      ItemSeparatorComponent={() => <RowSeparator testID="explore-news-sep" />}
      renderItem={({item}) => <NewsCard link={item} />}
      // Infinite scroll with early prefetch: the next page starts loading
      // well before the bottom edge, so the button-less list never stalls.
      // `loadMore` is already guarded (loading/end/cursor), never a dupe.
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={2}
    />
  )
}

// --- Screen -------------------------------------------------------------------

export function ExploreScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Explore'>>()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const {session, backend} = useActiveBackend()
  // Legacy `/search?tag=` rewrites to `/explore?tag=`: the query string
  // lands in the route params on web. Only the posts tab reads it.
  const rawTagSeed = (route.params as {tag?: unknown} | undefined)?.tag
  const tagSeed =
    typeof rawTagSeed === 'string' && rawTagSeed.replace(/^#+/, '').length > 0
      ? rawTagSeed.replace(/^#+/, '')
      : null
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (tagSeed && seededRef.current !== tagSeed) {
      seededRef.current = tagSeed
      const q = `#${tagSeed}`
      setQuery(q)
      setSubmitted(q)
    }
  }, [tagSeed])
  const suggestGen = useRef(0)
  const [tagNames, setTagNames] = useState<string[] | null>(null)
  const [accountNames, setAccountNames] = useState<Account[] | null>(null)
  const closeSuggest = () => {
    suggestGen.current += 1
    setTagNames(null)
    setAccountNames(null)
  }
  useEffect(() => {
    if (!backend) {
      setTagNames(null)
      setAccountNames(null)
      return
    }
    const timer = setTimeout(() => {
      const gen = ++suggestGen.current
      const trigger = suggestTrigger(query, query.length)
      if (!trigger) {
        setTagNames(null)
        setAccountNames(null)
        return
      }
      if (trigger.kind === 'tag') {
        if (!backend.search.suggestTags) {
          setTagNames(null)
          return
        }
        void backend.search
          .suggestTags(trigger.prefix, {limit: SUGGEST_LIMIT})
          .then(names => {
            if (suggestGen.current !== gen) return
            setAccountNames(null)
            setTagNames(names.length > 0 ? names : null)
          })
          .catch(() => {
            // Autocomplete is assistive: failures hide the popup, never
            // error the page.
            if (suggestGen.current === gen) {
              setTagNames(null)
              setAccountNames(null)
            }
          })
      } else {
        if (!backend.search.suggestAccounts) {
          setAccountNames(null)
          return
        }
        void backend.search
          .suggestAccounts(trigger.prefix, {limit: SUGGEST_LIMIT})
          .then(page => {
            if (suggestGen.current !== gen) return
            setTagNames(null)
            setAccountNames(page.items.length > 0 ? page.items : null)
          })
          .catch(() => {
            if (suggestGen.current === gen) {
              setTagNames(null)
              setAccountNames(null)
            }
          })
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, backend])
  const pickSuggestion = (index: number) => {
    const trigger = suggestTrigger(query, query.length)
    if (!trigger) {
      closeSuggest()
      return
    }
    let insert: string | null = null
    if (trigger.kind === 'tag' && tagNames) {
      const name = tagNames[index]
      if (name) insert = `#${name}`
    } else if (trigger.kind === 'account' && accountNames) {
      const account = accountNames[index]
      if (account) insert = `@${account.acct || account.username}`
    }
    if (!insert) {
      closeSuggest()
      return
    }
    const next = applySuggestion(query, query.length, trigger, insert)
    setQuery(next.value)
    closeSuggest()
  }
  const submit = () => {
    const q = query.trim()
    closeSuggest()
    setSubmitted(q.length > 0 ? q : null)
  }
  const clear = () => {
    closeSuggest()
    setSubmitted(null)
    setQuery('')
  }
  const hasNews = !!backend?.explore?.news
  const tabs: ExploreTab[] = hasNews ? ['users', 'tags', 'posts', 'news'] : ['users', 'tags', 'posts']
  const requested = exploreTabFromParam(route.params?.tab)
  const active: ExploreTab =
    requested && (requested !== 'news' || hasNews) ? requested : 'posts'
  if (!session || !backend) {
    return (
      <View style={atoms.flex1} testID="explore-screen">
        <Pagehead title="Search" />
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Sign in to explore.`)}</Body>
          <Caption color="faint">{i18n._(msg`Explore never shows sample data when signed out.`)}</Caption>
          <SignInButton />
        </View>
      </View>
    )
  }
  return (
    <View style={atoms.flex1} testID="explore-screen">
      <Pagehead title="Search" />
      <ExploreSearchBar
        value={query}
        onChangeText={setQuery}
        onSubmit={submit}
        onClear={clear}
      />
      <ExploreSuggestPopup
        tags={tagNames}
        accounts={accountNames}
        activeIndex={0}
        onPick={pickSuggestion}
      />
      <ExploreTabBar
        tabs={tabs}
        active={active}
        onChange={t => navigation.setParams({tab: t} as never)}
      />
      <View style={atoms.flex1}>
        {active === 'users' ? (
          <UsersTab backend={backend} submitted={submitted} />
        ) : active === 'tags' ? (
          <TagsTab sessionId={session.id} backend={backend} submitted={submitted} />
        ) : active === 'posts' ? (
          <PostsTab sessionId={session.id} backend={backend} submitted={submitted} />
        ) : (
          <NewsTab backend={backend} />
        )}
      </View>
    </View>
  )
}
