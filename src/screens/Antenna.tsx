// One antenna's feed (`/antennas/:id`, v1 `AntennaFeed` parity). The
// antenna resolves from `backend.antennas.list()`; its params render
// read-only above the posts, which page through the canonical
// `usePostFeedQuery` antenna-feed descriptor (`antenna|<id>` →
// `backend.antennas.notes`, see `fetchFeedPage`) inside the shared
// `FeedView` — the same empty/loading/error honesty as every other feed,
// never faked rows.

import {useEffect, useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {isUnsupportedError, type Antenna, type FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

import {antennaSummaryLine} from './Antennas'

function flagsLine(antenna: Antenna): string {
  const flags: string[] = []
  if (antenna.caseSensitive) flags.push('case-sensitive')
  if (antenna.localOnly) flags.push('local only')
  if (antenna.excludeBots) flags.push('no bots')
  if (antenna.withReplies) flags.push('with replies')
  if (antenna.withFile) flags.push('with files')
  return flags.length > 0 ? flags.join(' · ') : 'no extra filters'
}

export function AntennaScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Antenna'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const [antenna, setAntenna] = useState<Antenna | null>(null)
  const [antennaState, setAntennaState] = useState<
    'loading' | 'ready' | 'missing' | 'error' | 'unsupported'
  >('loading')

  useEffect(() => {
    let cancelled = false
    if (!session || !backend) {
      setAntennaState('loading')
      return
    }
    if (!backend.antennas || backend.capabilities.antennas === 'unsupported') {
      setAntennaState('unsupported')
      return
    }
    setAntennaState('loading')
    setAntenna(null)
    void backend.antennas
      .list()
      .then(found => {
        if (cancelled) return
        const match = found.find(a => a.id === id) ?? null
        setAntenna(match)
        setAntennaState(match ? 'ready' : 'missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setAntennaState(isUnsupportedError(err) ? 'unsupported' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [session, backend, id])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antenna-screen">
        <Pagehead title="Antenna" />
        <Body>Sign in to see this antenna.</Body>
        <Caption color="faint">Antennas never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (
    !backend.antennas ||
    backend.capabilities.antennas === 'unsupported' ||
    antennaState === 'unsupported'
  ) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antenna-screen">
        <Pagehead title="Antenna" />
        <Body>Antennas are not available on this server.</Body>
      </View>
    )
  }

  if (antennaState === 'loading') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antenna-screen">
        <Pagehead title="Antenna" />
        <Loader testID="antenna-loading" />
        <Caption color="faint">Loading…</Caption>
      </View>
    )
  }

  if (antennaState === 'error') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="antenna-screen">
        <Pagehead title="Antenna" />
        <Body>Could not load this antenna.</Body>
        <Caption color="faint">Check your connection and try again.</Caption>
        <Button
          label="Retry"
          variant="secondary"
          onPress={() => {
            setAntennaState('loading')
            if (!backend.antennas) return
            void backend.antennas
              .list()
              .then(found => {
                const match = found.find(a => a.id === id) ?? null
                setAntenna(match)
                setAntennaState(match ? 'ready' : 'missing')
              })
              .catch((err: unknown) => {
                setAntennaState(isUnsupportedError(err) ? 'unsupported' : 'error')
              })
          }}
          testID="antenna-retry"
        />
      </View>
    )
  }

  if (antennaState === 'missing' || !antenna) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="antenna-screen">
        <Pagehead title="Antenna" />
        <Body>This antenna does not exist.</Body>
      </View>
    )
  }

  const descriptor = `antenna|${id}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="antenna-screen">
      <Pagehead title={antenna.name} />
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID="antenna-params">
        <Caption color="faint">{antennaSummaryLine(antenna)}</Caption>
        <Caption color="faint">{flagsLine(antenna)}</Caption>
      </View>
      <FeedView sessionId={session.id} descriptor={descriptor} testID="antenna-feed" />
    </View>
  )
}
