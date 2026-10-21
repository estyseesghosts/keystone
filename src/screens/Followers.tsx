// Followers list (`/users/:id/followers`, v1 `FollowersPage` parity):
// the accounts following this user, cursor-paged with a `Load more`
// next-page button and pull-to-refresh. Data comes straight from
// `backend.followers` (both families serve it). The target's
// `ffVisibility` gates the list exactly like the profile stats line —
// a hidden list renders the honest hidden message, never an empty
// page. Signed out renders the honest signed-out state, never sample
// data. UI sees only domain models; no wire types cross in.
import {useCallback, useEffect, useRef, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native'

import {
  displayNameOf,
  handleOf,
  isPermissionError,
  isUnsupportedError,
  type Account,
  type Cursor,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {DisplayName} from '#/components/DisplayName'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {ProfileAvatar} from '#/components/Profile/ProfileAvatar'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

const PAGE_LIMIT = 20

function FollowerRow({account}: {account: Account}) {
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  return (
    <Pressable
      testID={`follower-row-${account.id}`}
      onPress={() => navigation.navigate('User', {id: account.id})}
      accessibilityRole="link"
      accessibilityLabel={`Open profile of ${displayNameOf(account)}`}>
      <View
        style={[
          atoms.px_md,
          atoms.py_sm,
          {flexDirection: 'row', alignItems: 'center', gap: 12},
        ]}>
        <ProfileAvatar
          uri={account.avatarUrl}
          name={displayNameOf(account)}
          testID={`follower-avatar-${account.id}`}
        />
        <View style={{flex: 1}}>
          <DisplayName account={account} size={15} />
          <Caption color="faint">{handleOf(account)}</Caption>
        </View>
      </View>
    </Pressable>
  )
}

export function FollowersScreen() {
  const theme = useTheme()
  const route = useRoute<RouteProp<RootParamList, 'Followers'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const sessionId = session?.id ?? null
  const [items, setItems] = useState<Account[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [denied, setDenied] = useState(false)
  const [hidden, setHidden] = useState<'private' | 'followers' | null>(null)
  const cursorRef = useRef<Cursor | null>(null)
  const generationRef = useRef(0)

  const load = useCallback(
    async (mode: 'initial' | 'more' | 'refresh') => {
      if (!session || !backend) {
        setLoading(false)
        return
      }
      const generation = ++generationRef.current
      if (mode === 'initial') {
        setLoading(true)
        setHidden(null)
      } else if (mode === 'more') {
        setLoadingMore(true)
      } else {
        setRefreshing(true)
        setHidden(null)
      }
      setError(null)
      setUnsupported(false)
      setDenied(false)
      try {
        if (mode !== 'more') {
          // Privacy gate first (mirrors the profile StatsLine): the
          // target's ffVisibility decides whether the viewer may see
          // this list at all.
          let target: Account | null = null
          try {
            target = await backend.account({id})
          } catch {
            target = null
          }
          if (generationRef.current !== generation) return
          if (target) {
            const isSelf = session.accountId === target.id
            if (target.ffVisibility === 'private' && !isSelf) {
              cursorRef.current = null
              setItems([])
              setHasMore(false)
              setHidden('private')
              return
            }
            if (target.ffVisibility === 'followers' && !isSelf && !target.isFollowing) {
              cursorRef.current = null
              setItems([])
              setHasMore(false)
              setHidden('followers')
              return
            }
          }
          setHidden(null)
        }
        const page = await backend.followers(id, {
          limit: PAGE_LIMIT,
          cursor: mode === 'more' ? cursorRef.current : null,
        })
        if (generationRef.current !== generation) return
        cursorRef.current = page.cursor
        setHasMore(!page.end)
        if (mode === 'more') {
          setItems(prev => {
            const seen = new Set((prev ?? []).map(a => a.id))
            return [...(prev ?? []), ...page.items.filter(a => !seen.has(a.id))]
          })
        } else {
          setItems(page.items)
        }
      } catch (err) {
        if (generationRef.current !== generation) return
        if (isUnsupportedError(err)) setUnsupported(true)
        else if (isPermissionError(err)) setDenied(true)
        else setError(err)
      } finally {
        if (generationRef.current === generation) {
          setLoading(false)
          setLoadingMore(false)
          setRefreshing(false)
        }
      }
    },
    [session, backend, id],
  )

  // Keyed on (session, backend, id): switching accounts or targets
  // never shows the previous data — in-flight loads are generation
  // guarded and the list resets before the fresh load lands.
  useEffect(() => {
    cursorRef.current = null
    generationRef.current += 1
    setItems(null)
    setHasMore(false)
    setError(null)
    setUnsupported(false)
    setDenied(false)
    setHidden(null)
    setLoading(true)
    setRefreshing(false)
    setLoadingMore(false)
    void load('initial')
  }, [load])

  if (!session || !backend || !sessionId) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="followers-screen">
        <Pagehead title="Followers" />
        <Body>Sign in to see followers.</Body>
        <Caption color="faint">Follow lists never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (hidden) {
    return (
      <View style={atoms.flex1} testID="followers-screen">
        <Pagehead title="Followers" />
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>
            {hidden === 'private'
              ? 'Following and followers are hidden.'
              : 'Following and followers are visible to followers.'}
          </Body>
        </View>
      </View>
    )
  }

  if (unsupported) {
    return (
      <View style={atoms.flex1} testID="followers-screen">
        <Pagehead title="Followers" />
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Followers are not available on this server.</Body>
        </View>
      </View>
    )
  }

  if (denied || (error && (items === null || items.length === 0))) {
    return (
      <View style={atoms.flex1} testID="followers-screen">
        <Pagehead title="Followers" />
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>
            {denied ? 'This list is not visible to you.' : 'Could not load followers.'}
          </Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => void load('initial')}
            testID="followers-retry"
          />
        </View>
      </View>
    )
  }

  if (loading || items === null) {
    return (
      <View style={atoms.flex1} testID="followers-screen">
        <Pagehead title="Followers" />
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="followers-loading" />
          <Caption color="faint">Loading…</Caption>
        </View>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="followers-screen">
      <Pagehead title="Followers" />
      <FlatList
        testID="followers-list"
        data={items}
        keyExtractor={item => `${sessionId}:${item.id}`}
        renderItem={({item}) => <FollowerRow account={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            testID="followers-refresh"
            tintColor={theme.palette.muted}
            colors={[theme.palette.muted]}
            progressBackgroundColor={theme.palette.bg}
          />
        }
        ListEmptyComponent={
          <View style={[atoms.centered, atoms.p_md]}>
            <Body>No followers yet.</Body>
          </View>
        }
        ListFooterComponent={
          <>
            {error ? (
              <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
                <Caption color="faint">Could not load more followers.</Caption>
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={() => void load('more')}
                  testID="followers-retry"
                />
              </View>
            ) : null}
            {!error && hasMore ? (
              <View style={[atoms.px_md, atoms.py_sm]}>
                <Button
                  label={loadingMore ? 'Loading…' : 'Load more'}
                  variant="secondary"
                  disabled={loadingMore}
                  onPress={() => void load('more')}
                  testID="followers-more"
                />
              </View>
            ) : null}
          </>
        }
      />
    </View>
  )
}
