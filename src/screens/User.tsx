import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {type Account, type Relationship, parseAcct} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {ProfileActions} from '#/components/ProfileActions'
import {AccountReactionsBlock} from '#/components/Profile/AccountReactions'
import {ProfileHeader, ProfileTabs} from '#/components/Profile'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {profileTabDescriptor, type ProfileFeedTab} from '#/state/queries'

// Profile (`/users/:id?`): v1-style header (banner, overlapping avatar
// row, name/handle, bio, gated stats) plus an underline tablist over the
// shared FeedView. Follow state is READ-ONLY here: follow/unfollow ships
// in Phase 4, so no follow buttons render in this file at all — the
// action slot holds the Phase 4 `ProfileActions` (others) or the
// settings entry (self), never an inert control.
export function UserScreen() {
  const route = useRoute<RouteProp<RootParamList, 'User'>>()
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const routeId = route.params?.id
  const routeAcct = route.params?.acct
  const {session, backend} = useActiveBackend()
  // Mention taps land here with an acct, not an id (F9): look the
  // account up once, then run the normal id path. A failed lookup is
  // an honest error, never a guessed profile.
  const [resolvedId, setResolvedId] = useState<string | null>(routeId ?? null)
  const [resolveError, setResolveError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setResolveError(false)
    if (routeId || !routeAcct) {
      setResolvedId(routeId ?? null)
      return
    }
    const ref = parseAcct(routeAcct)
    if (!ref || !backend) {
      // Unparseable handle is an honest error; no backend (signed out)
      // just leaves the signed-out branch to render.
      setResolvedId(null)
      if (!ref) setResolveError(true)
      return
    }
    let cancelled = false
    setResolvedId(null)
    backend
      .account({username: ref.username, host: ref.host})
      .then(a => {
        if (!cancelled) setResolvedId(a.id)
      })
      .catch(() => {
        if (!cancelled) setResolveError(true)
      })
    return () => {
      cancelled = true
    }
  }, [routeId, routeAcct, backend, attempt])
  // No id and no acct = the Profile tab = the viewer's own profile.
  const targetId = resolvedId ?? (routeAcct ? null : (session?.accountId ?? null))
  const resolving = routeId == null && routeAcct != null && resolvedId == null && !resolveError
  const [tab, setTab] = useState<ProfileFeedTab>('posts')
  const [account, setAccount] = useState<Account | null>(null)
  const [relationship, setRelationship] = useState<Relationship | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const generationRef = useRef(0)

  const load = useCallback(async () => {
    if (!session || !backend || !targetId) {
      setLoading(false)
      return
    }
    const generation = ++generationRef.current
    setLoading(true)
    setError(null)
    try {
      const loaded =
        routeId || routeAcct
          ? await backend.account({id: targetId})
          : await backend.me()
      if (generationRef.current !== generation) return
      setAccount(loaded)
      // Read-only follow state: the relation endpoint names the state;
      // absence (signed-out edge, unsupported) renders without a caption.
      if (session.accountId !== loaded.id) {
        try {
          const [rel] = await backend.relationships([loaded.id])
          if (generationRef.current !== generation) return
          setRelationship(rel ?? null)
        } catch {
          if (generationRef.current !== generation) return
          setRelationship(null)
        }
      } else {
        setRelationship(null)
      }
    } catch (err) {
      if (generationRef.current !== generation) return
      setError(err)
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [session, backend, targetId])

  useEffect(() => {
    setAccount(null)
    setRelationship(null)
    setLoading(true)
    setError(null)
    void load()
  }, [load])

  // Featured ships absent when the backend packed no source (pinned
  // posts/ids) — never faked. The tab hides until then.
  const hasFeatured =
    (account?.pinnedPosts?.length ?? 0) > 0 || (account?.pinnedPostIds?.length ?? 0) > 0
  const isSelf = !!session && !!account && session.accountId === account.id

  return (
    <View style={atoms.flex1} testID="user-screen">
      {!session || !backend || (!targetId && !resolving && !resolveError) ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to see profiles.</Body>
          <Caption color="faint">Profiles never show sample data when signed out.</Caption>
          <SignInButton />
        </View>
      ) : resolving || loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="profile-loading" />
          <Caption color="faint">Loading profile…</Caption>
        </View>
      ) : resolveError || error || !account ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load this profile.</Body>
          <Caption color="faint">It may be deleted, suspended, or unreachable.</Caption>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => {
              setResolveError(false)
              setAttempt(a => a + 1)
              void load()
            }}
            testID="profile-retry"
          />
        </View>
      ) : (
        <View style={atoms.flex1} testID="profile-body">
          <ProfileHeader
            account={account}
            isSelf={isSelf}
            relationship={relationship}
            actions={
              isSelf ? (
                <View style={[atoms.row, atoms.gap_sm]}>
                  <Button
                    label="Edit profile"
                    variant="secondary"
                    testID="profile-edit"
                    onPress={() => nav.navigate('ProfileEdit')}
                  />
                  <Button
                    label="Accounts & settings"
                    variant="secondary"
                    testID="profile-settings"
                    onPress={() => nav.navigate('Settings')}
                  />
                </View>
              ) : (
                <ProfileActions sessionId={session.id} account={account} />
              )
            }
          />
          <AccountReactionsBlock backend={backend} accountId={account.id} />
          <ProfileTabs tab={tab} onChange={setTab} hasFeatured={hasFeatured} />
          <View style={atoms.flex1}>
            <FeedView
              sessionId={session.id}
              descriptor={profileTabDescriptor(account.id, tab)}
              testID="profile-feed"
            />
          </View>
        </View>
      )}
    </View>
  )
}
