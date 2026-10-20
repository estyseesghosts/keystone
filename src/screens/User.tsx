import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {type Account, type Relationship} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {ProfileActions} from '#/components/ProfileActions'
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
  const {session, backend} = useActiveBackend()
  // No id = the Profile tab = the viewer's own profile.
  const targetId = routeId ?? session?.accountId ?? null
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
      const loaded = routeId ? await backend.account({id: routeId}) : await backend.me()
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
      {!session || !backend || !targetId ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to see profiles.</Body>
          <Caption color="faint">Profiles never show sample data when signed out.</Caption>
          <SignInButton />
        </View>
      ) : loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="profile-loading" />
          <Caption color="faint">Loading profile…</Caption>
        </View>
      ) : error || !account ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load this profile.</Body>
          <Caption color="faint">It may be deleted, suspended, or unreachable.</Caption>
          <Button label="Retry" variant="secondary" onPress={() => void load()} testID="profile-retry" />
        </View>
      ) : (
        <View style={atoms.flex1} testID="profile-body">
          <ProfileHeader
            account={account}
            isSelf={isSelf}
            relationship={relationship}
            actions={
              isSelf ? (
                <Button
                  label="Accounts & settings"
                  variant="secondary"
                  testID="profile-settings"
                  onPress={() => nav.navigate('Settings')}
                />
              ) : (
                <ProfileActions sessionId={session.id} account={account} />
              )
            }
          />
          <ProfileTabs tab={tab} onChange={setTab} hasFeatured={hasFeatured} />
          <View style={atoms.flex1}>
            <FeedView
              sessionId={session.id}
              descriptor={profileTabDescriptor(targetId, tab)}
              testID="profile-feed"
            />
          </View>
        </View>
      )}
    </View>
  )
}
