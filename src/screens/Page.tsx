// Page reader (P6.5 Pages, slice 2): `pages/show` by id, shared
// `PageView` renderer, actions, related pages. Public: signed-out trees
// render (no like), unsupported family hides with a reason.

import {useCallback, useMemo} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'
import {msg} from '@lingui/macro'

import {isUnsupportedError, type Backend} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {ErrorBoundary} from '#/components/ErrorBoundary'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {SkeletonList} from '#/components/Skeleton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'

import {PageView} from '#/components/Page/PageView'
import {PageActions} from '#/components/Page/PageActions'
import {PageCard} from '#/components/Page/PageCard'
import {usePageQuery, usePagesByUser} from '#/state/queries/pages'

function RelatedPages({
  sessionId,
  backend,
  authorId,
  currentId,
  authorName,
  testID,
}: {
  sessionId: string | null
  backend: Backend | null
  authorId: string
  currentId: string
  authorName: string
  testID?: string
}) {
  const related = usePagesByUser(sessionId, authorId, {backend, limit: 6})
  const items = useMemo(
    () =>
      (related.data?.pages ?? [])
        .flatMap(p => p.items)
        .filter(p => p.id !== currentId)
        .slice(0, 6),
    [related.data, currentId],
  )
  if (related.isPending || items.length === 0) return null
  return (
    <View testID={testID} style={[atoms.gap_sm, atoms.p_md]}>
      <Body>{i18n._(msg`More pages by ${authorName}`)}</Body>
      {items.map(p => (
        <PageCard key={p.id} page={p} testID={testID ? `${testID}-${p.id}` : undefined} />
      ))}
    </View>
  )
}

export function PageScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Page'>>()
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const pageId = route.params.id
  const page = usePageQuery(sessionId, pageId, backend ? {backend} : {})
  // Single document, not an infinite list: refresh is a plain refetch
  // (the trim-then-refetch helper assumes `pages` and would throw here).
  const refresh = useCallback(() => {
    void page.refetch()
  }, [page])

  if (!sessionId) {
    return (
      <View testID="page-screen" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={i18n._(msg`Page`)} />
        <Body>{i18n._(msg`Sign in to see this page.`)}</Body>
        <SignInButton />
      </View>
    )
  }

  if (!backend?.pages) {
    return (
      <View testID="page-screen" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={i18n._(msg`Page`)} />
        <Body>{i18n._(msg`Pages are not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`This server has no Pages feature.`)}</Caption>
      </View>
    )
  }

  if (page.isPending) {
    return (
      <View testID="page-screen" style={atoms.flex1}>
        <Pagehead title={i18n._(msg`Page`)} />
        <SkeletonList variant="post" count={3} testID="page-loading" />
      </View>
    )
  }

  if (page.isError || !page.data) {
    const unavailable = page.error != null && isUnsupportedError(page.error)
    return (
      <View testID="page-screen" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Pagehead title={i18n._(msg`Page`)} />
        <Body>
          {unavailable
            ? i18n._(msg`Page not found or not visible.`)
            : i18n._(msg`Could not load this page.`)}
        </Body>
        <Caption color="faint">
          {unavailable
            ? i18n._(msg`It may have been deleted or set to private.`)
            : i18n._(msg`Check your connection and try again.`)}
        </Caption>
        <Button
          label={i18n._(msg`Retry`)}
          variant="secondary"
          onPress={() => void page.refetch()}
          testID="page-retry"
        />
      </View>
    )
  }

  const data = page.data
  return (
    <View testID="page-screen" style={atoms.flex1}>
      <Pagehead title={data.title || data.name} />
      <FlatList
        data={[0]}
        keyExtractor={() => 'page'}
        refreshControl={
          <RefreshControl refreshing={page.isRefetching} onRefresh={refresh} testID="page-refresh" />
        }
        renderItem={() => (
          <View style={[atoms.p_md, atoms.gap_md]}>
            <ErrorBoundary variant="screen" context={`page:${data.id}`}>
              <PageView page={data} sessionId={sessionId} testID="page-view" />
            </ErrorBoundary>
            <PageActions page={data} sessionId={sessionId} testID={`page-actions-${data.id}`} />
            <RelatedPages
              sessionId={sessionId}
              backend={backend}
              authorId={data.author.id}
              currentId={data.id}
              authorName={data.author.displayName}
              testID="page-related"
            />
          </View>
        )}
      />
    </View>
  )
}
