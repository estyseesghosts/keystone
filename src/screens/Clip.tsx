// One clip's notes (`/clips/:id`, v1 `ClipFeed` parity). The clip name
// resolves from `backend.clips.list()` for the title; the posts page
// through the canonical `usePostFeedQuery` clip-feed descriptor
// (`clip|<id>` → `backend.clips.notes`, see `fetchFeedPage`) inside the
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

export function ClipScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Clip'>>()
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
    if (!backend.clips || backend.capabilities.clips === 'unsupported') {
      setNameState('unsupported')
      return
    }
    setNameState('loading')
    setName(null)
    void backend.clips
      .list()
      .then(found => {
        if (cancelled) return
        const match = found.find(c => c.id === id) ?? null
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
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title="Clip" />
        <Body>Sign in to see this clip.</Body>
        <Caption color="faint">Clips never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!backend.clips || backend.capabilities.clips === 'unsupported' || nameState === 'unsupported') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title="Clip" />
        <Body>Clips are not available on this server.</Body>
      </View>
    )
  }

  if (nameState === 'loading') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title="Clip" />
        <Loader testID="clip-loading" />
        <Caption color="faint">Loading…</Caption>
      </View>
    )
  }

  if (nameState === 'error') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="clip-screen">
        <Pagehead title="Clip" />
        <Body>Could not load this clip.</Body>
        <Caption color="faint">Check your connection and try again.</Caption>
        <Button
          label="Retry"
          variant="secondary"
          onPress={() => {
            setNameState('loading')
            if (!backend.clips) return
            void backend.clips
              .list()
              .then(found => {
                const match = found.find(c => c.id === id) ?? null
                setName(match?.name ?? null)
                setNameState(match ? 'ready' : 'missing')
              })
              .catch((err: unknown) => {
                setNameState(isUnsupportedError(err) ? 'unsupported' : 'error')
              })
          }}
          testID="clip-retry"
        />
      </View>
    )
  }

  if (nameState === 'missing') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title="Clip" />
        <Body>This clip does not exist.</Body>
      </View>
    )
  }

  const descriptor = `clip|${id}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="clip-screen">
      <Pagehead title={name ?? 'Clip'} />
      <FeedView sessionId={session.id} descriptor={descriptor} testID="clip-feed" />
    </View>
  )
}
