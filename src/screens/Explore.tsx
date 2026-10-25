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
//
// Split (D3.7): tab bodies live in `./explore/` — `NewsTab` (own file,
// own pagination), `UsersTab` + `AccountsSearch` (own file), shared
// rows in `./explore/rows`. This file keeps the tab shell, the tags/posts
// tabs, and the search/suggest state.

import {useEffect, useRef, useState} from 'react'
import {FlatList, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {
  type Account,
  type Backend,
  type FeedDescriptor,
  type TrendingTag,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {ExploreSearchBar} from '#/components/Explore/ExploreSearchBar'
import {ExploreSuggestPopup} from '#/components/Explore/ExploreSuggestPopup'
import {ExploreTabBar} from '#/components/Explore/ExploreTabBar'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'
import {applySuggestion, suggestTrigger} from '#/components/Explore/suggest'
import {exploreTabFromParam, type ExploreTab, type RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'
import {safeDescriptorArg} from './explore/safeDescriptor'
import {NewsTab} from './explore/NewsTab'
import {UsersTab} from './explore/UsersTab'
import {RowSeparator, SectionTitle, TagChip} from './explore/rows'

const SUGGEST_LIMIT = 8
const SUGGEST_DEBOUNCE_MS = 250

function stripTagPrefix(query: string): string {
  return query.replace(/^#+/, '').trim()
}

// --- Tab bodies (tags + posts stay here; news/users live in ./explore/) ---

function useOpenTag() {
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  return (tag: string) => navigation.navigate('Tag', {tag})
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
        if (!cancelled) setError(errorText(i18n, err, 'Could not load trending tags.'))
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
    return <SkeletonList variant="row" testID="explore-tags-loading" />
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
      // Conservative windowing (P4.1), mirroring FeedView.
      windowSize={7}
      initialNumToRender={6}
      maxToRenderPerBatch={8}
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
        <Pagehead title={i18n._(msg`Search`)} />
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
      <Pagehead title={i18n._(msg`Search`)} />
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
