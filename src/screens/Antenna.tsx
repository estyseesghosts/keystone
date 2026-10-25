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
import {msg} from '@lingui/macro'

import {isUnsupportedError, type Antenna, type FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

import {antennaSummaryLine} from './Antennas'

/** Display line for the antenna's boolean flags (all-false reads as the
 * honest "no extra filters"). Pure. */
export function antennaFlagsLine(antenna: Antenna): string {
  const flags: string[] = []
  if (antenna.caseSensitive) flags.push(i18n._(msg`case-sensitive`))
  if (antenna.localOnly) flags.push(i18n._(msg`local only`))
  if (antenna.excludeBots) flags.push(i18n._(msg`no bots`))
  if (antenna.withReplies) flags.push(i18n._(msg`with replies`))
  if (antenna.withFile) flags.push(i18n._(msg`with files`))
  return flags.length > 0 ? flags.join(' · ') : i18n._(msg`no extra filters`)
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
        <Pagehead title={i18n._(msg`Antenna`)} />
        <Body>{i18n._(msg`Sign in to see this antenna.`)}</Body>
        <Caption color="faint">
          {i18n._(msg`Antennas never show sample data when signed out.`)}
        </Caption>
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
        <Pagehead title={i18n._(msg`Antenna`)} />
        <Body>{i18n._(msg`Antennas are not available on this server.`)}</Body>
      </View>
    )
  }

  if (antennaState === 'loading') {
    return (
      <View style={atoms.flex1} testID="antenna-screen">
        <Pagehead title={i18n._(msg`Antenna`)} />
        <SkeletonList variant="post" testID="antenna-loading" />
      </View>
    )
  }

  if (antennaState === 'error') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="antenna-screen">
        <Pagehead title={i18n._(msg`Antenna`)} />
        <Body>{i18n._(msg`Could not load this antenna.`)}</Body>
        <Caption color="faint">{i18n._(msg`Check your connection and try again.`)}</Caption>
        <Button
          label={i18n._(msg`Retry`)}
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
        <Pagehead title={i18n._(msg`Antenna`)} />
        <Body>{i18n._(msg`This antenna does not exist.`)}</Body>
      </View>
    )
  }

  const descriptor = `antenna|${id}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="antenna-screen">
      <Pagehead title={antenna.name} />
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID="antenna-params">
        <Caption color="faint">{antennaSummaryLine(antenna)}</Caption>
        <Caption color="faint">{antennaFlagsLine(antenna)}</Caption>
      </View>
      <FeedView sessionId={session.id} descriptor={descriptor} testID="antenna-feed" />
    </View>
  )
}
