// Explore News tab (D3.7 split of `src/screens/Explore.tsx`): the news
// card + the paginated NewsTab. R2.4 wiring is preserved verbatim — the
// in-flight ref, the functional-updater `mergeNewsLinks` dedupe, the
// footer retry (never a cleared list, never a silent swallow), and the
// `safeHttpUrl` gate before opening a link.

import {useEffect, useRef, useState} from 'react'
import {FlatList, Image, Linking, StyleSheet, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {safeHttpUrl, type Backend, type NewsLink} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'
import {errorText} from '#/lib/localeErrors'
import {i18n, useI18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'

import {mergeNewsLinks} from './news'
import {RowSeparator} from './rows'

function NewsCard({link}: {link: NewsLink}) {
  const theme = useTheme()
  const i18n = useI18n()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const openLink = () => {
    const safe = safeHttpUrl(link.url)
    if (!safe) {
      showToast(i18n._(msg`Could not open this link.`))
      return
    }
    void Linking.openURL(safe).catch(() => showToast(i18n._(msg`Could not open this link.`)))
  }
  return (
    <View style={[atoms.py_sm, atoms.px_md]} testID="explore-news-item">
      {/* The Discussions pill nests inside the article link target: the RN
          responder hands the tap to the innermost pressable, so the pill
          navigates while the article around it still opens the link. */}
      <Pressable
        onPress={openLink}
        accessibilityRole="link"
        accessibilityLabel={i18n._(msg`Open link: ${link.title}`)}
        testID="explore-news-open"
        style={styles.newsRow}>
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
          <View style={styles.descRow}>
            {link.description ? (
              <Caption color="faint" style={styles.descText}>
                {link.description}
              </Caption>
            ) : (
              <View style={styles.descText} />
            )}
            <Pressable
              onPress={() => navigation.navigate('NewsDiscussions', {url: link.url, title: link.title})}
              accessibilityRole="button"
              accessibilityLabel={i18n._(msg`Discussions about ${link.title}`)}
              hitSlop={12}
              testID="explore-news-discussions"
              style={styles.discussPillWrap}>
              <View style={[styles.discussPill, {borderColor: theme.palette.edge}]}>
                <Caption>{i18n._(msg`Discussions`)}</Caption>
              </View>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // News photo: one fixed width everywhere, height follows each image's
  // own aspect (RN measures the intrinsic size once loaded). minHeight +
  // raise background holds a calm placeholder until the bytes arrive.
  newsRow: {flexDirection: 'row', gap: 12},
  newsPhoto: {width: 112, minHeight: 64, borderRadius: 8},
  newsText: {flex: 1, minWidth: 0, justifyContent: 'center'},
  // Blurb + pill share one row: the description wraps down the pill's
  // left while the pill pins to its bottom-right — no full-width row.
  descRow: {flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'flex-end'},
  descText: {flex: 1, minWidth: 0},
  discussPillWrap: {flexShrink: 0},
  discussPill: {borderWidth: 1, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6},
})

export function NewsTab({backend}: {backend: Backend}) {
  const [links, setLinks] = useState<NewsLink[]>([])
  const [cursor, setCursor] = useState<unknown>(null)
  const [end, setEnd] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // `loading` state commits a render late, so two rapid `onEndReached`
  // fires could share one stale `links` snapshot — the ref closes that
  // gap, and the functional updater below dedupes against the freshest
  // list either way.
  const loadingRef = useRef(false)
  useEffect(() => {
    if (!backend.explore?.news) return
    const news = backend.explore.news
    let cancelled = false
    loadingRef.current = true
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
        if (!cancelled) setError(errorText(i18n, err, i18n._(msg`Could not load news.`)))
      })
      .finally(() => {
        if (!cancelled) {
          loadingRef.current = false
          setLoading(false)
        }
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
    return <SkeletonList variant="card" testID="explore-news-loading" />
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
    if (!news || loadingRef.current || end || cursor == null) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    void news({limit: 10, cursor: cursor as never})
      .then(page => {
        setLinks(prev => mergeNewsLinks(prev, page.items))
        setCursor(page.cursor)
        setEnd(page.end)
      })
      .catch((err: unknown) => {
        setError(errorText(i18n, err, i18n._(msg`Could not load more news.`)))
      })
      .finally(() => {
        loadingRef.current = false
        setLoading(false)
      })
  }
  return (
    <FlatList
      testID="explore-news"
      data={links}
      keyExtractor={l => l.url}
      // Conservative windowing (P4.1), mirroring FeedView. No
      // `getItemLayout` (variable card heights) and no
      // `removeClippedSubviews` (unverified on Android).
      windowSize={7}
      initialNumToRender={6}
      maxToRenderPerBatch={8}
      ItemSeparatorComponent={() => <RowSeparator testID="explore-news-sep" />}
      renderItem={({item}) => <NewsCard link={item} />}
      // Infinite scroll with early prefetch: the next page starts loading
      // well before the bottom edge, so the button-less list never stalls.
      // `loadMore` is already guarded (in-flight/end/cursor), never a dupe.
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={2}
      ListFooterComponent={
        // A load-more failure with items on screen keeps the list and
        // offers a retry — never a silent swallow, never a cleared list.
        error ? (
          <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
            <Caption color="faint">{error}</Caption>
            <Button
              label={i18n._(msg`Retry`)}
              variant="secondary"
              onPress={() => {
                setError(null)
                loadMore()
              }}
              testID="explore-news-more-retry"
            />
          </View>
        ) : null
      }
    />
  )
}
