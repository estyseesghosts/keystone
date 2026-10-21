// One user list's timeline (`/lists/:id`, v1 `ListFeed` parity). The list
// name resolves from `backend.lists.list()` for the title; the posts page
// through the canonical `usePostFeedQuery` list-feed descriptor
// (`list|<id>` → `backend.lists.timeline`, see `fetchFeedPage`) inside the
// shared `FeedView` — the same empty/loading/error honesty as every other
// feed, never faked rows.

import {useEffect, useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {isUnsupportedError, type FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

export function ListScreen() {
  const route = useRoute<RouteProp<RootParamList, 'List'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const [name, setName] = useState<string | null>(null)
  const [nameState, setNameState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unsupported'>(
    'loading',
  )

  useEffect(() => {
    let cancelled = false
    if (!session || !backend) {
      setNameState('loading')
      return
    }
    if (!backend.lists || backend.capabilities.lists === 'unsupported') {
      setNameState('unsupported')
      return
    }
    setNameState('loading')
    setName(null)
    void backend.lists
      .list()
      .then(found => {
        if (cancelled) return
        const match = found.find(l => l.id === id) ?? null
        setName(match?.name ?? null)
        setNameState(match ? 'ready' : 'missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setNameState(isUnsupportedError(err) ? 'unsupported' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [session, backend, id])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="list-screen">
        <Pagehead title="List" />
        <Body>Sign in to see this list.</Body>
        <Caption color="faint">Lists never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!backend.lists || backend.capabilities.lists === 'unsupported' || nameState === 'unsupported') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="list-screen">
        <Pagehead title="List" />
        <Body>Lists are not available on this server.</Body>
      </View>
    )
  }

  if (nameState === 'loading') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="list-screen">
        <Pagehead title="List" />
        <Loader testID="list-loading" />
        <Caption color="faint">Loading…</Caption>
      </View>
    )
  }

  if (nameState === 'error') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="list-screen">
        <Pagehead title="List" />
        <Body>Could not load this list.</Body>
        <Caption color="faint">Check your connection and try again.</Caption>
        <Button
          label="Retry"
          variant="secondary"
          onPress={() => {
            setNameState('loading')
            if (!backend.lists) return
            void backend.lists
              .list()
              .then(found => {
                const match = found.find(l => l.id === id) ?? null
                setName(match?.name ?? null)
                setNameState(match ? 'ready' : 'missing')
              })
              .catch((err: unknown) => {
                setNameState(isUnsupportedError(err) ? 'unsupported' : 'error')
              })
          }}
          testID="list-retry"
        />
      </View>
    )
  }

  if (nameState === 'missing') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="list-screen">
        <Pagehead title="List" />
        <Body>This list does not exist.</Body>
      </View>
    )
  }

  const descriptor = `list|${id}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="list-screen">
      <Pagehead title={name ?? 'List'} />
      <FeedView sessionId={session.id} descriptor={descriptor} testID="list-feed" />
    </View>
  )
}
