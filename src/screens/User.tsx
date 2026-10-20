import {useCallback, useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {displayNameOf, handleOf, type Account, type Relationship} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import type {RootParamList} from '#/routes'
import {
  profileTabDescriptor,
  useActiveBackend,
  type ProfileFeedTab,
  FeedView,
} from '#/screens/HomeFeed'

// Profile (`/users/:id?`): header plus posts / replies / media / featured
// tabs addressed by `user|id|…` descriptors. Follow state is READ-ONLY:
// follow/unfollow ship in Phase 4, so no follow buttons render here at
// all — never an inert control.
const TABS: ProfileFeedTab[] = ['posts', 'replies', 'media', 'featured']

function FollowStateCaption({relationship}: {relationship: Relationship | null}) {
  if (!relationship) return null
  const parts: string[] = []
  if (relationship.isFollowing) parts.push('You follow this account.')
  if (relationship.isFollowed) parts.push('Follows you.')
  if (relationship.hasPendingFollowRequestFromYou) parts.push('Follow request pending.')
  if (parts.length === 0) return null
  return <Caption color="faint">{parts.join(' ')}</Caption>
}

export function UserScreen() {
  const route = useRoute<RouteProp<RootParamList, 'User'>>()
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

  return (
    <View style={atoms.flex1} testID="user-screen">
      {!session || !backend || !targetId ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to see profiles.</Body>
          <Caption color="faint">Profiles never show sample data when signed out.</Caption>
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
          <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
            <Heading>{displayNameOf(account)}</Heading>
            <Caption color="faint">{handleOf(account)}</Caption>
            {account.bio.plain ? <Body>{account.bio.plain}</Body> : null}
            <Caption color="faint">
              {`${account.followersCount} followers · ${account.followingCount} following · ${account.statusesCount} posts`}
            </Caption>
            {account.locked ? <Caption color="faint">Locked account.</Caption> : null}
            {account.bot ? <Caption color="faint">Automated account.</Caption> : null}
            <FollowStateCaption relationship={relationship} />
          </View>
          <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="profile-tabs">
            {TABS.map(t => (
              <Button
                key={t}
                label={t === 'posts' ? 'Posts' : t === 'replies' ? 'Replies' : t === 'media' ? 'Media' : 'Featured'}
                variant={t === tab ? 'primary' : 'secondary'}
                onPress={() => setTab(t)}
                testID={`profile-tab-${t}`}
              />
            ))}
          </View>
          <FeedView
            sessionId={session.id}
            descriptor={profileTabDescriptor(targetId, tab)}
            testID="profile-feed"
          />
        </View>
      )}
    </View>
  )
}
