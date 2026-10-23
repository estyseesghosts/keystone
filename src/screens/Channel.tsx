// One channel (`/channels/:id`): name, description, follow/unfollow, and
// the channel timeline. The channel resolves with `channels/show` (which
// also carries the viewer's `isFollowing`); the timeline is the canonical
// `channel|<id>` feed descriptor inside the shared `FeedView`, so paging,
// empty/loading/error states and the live `channel` stream all behave like
// every other feed. `isFollowing == null` means the server did not report
// the state — the button is disabled WITH a reason rather than shipped
// inert or guessed. Archived channels say so; the feed stays readable.
//
// Out of this slice: create/edit (channel-editor) and channel mute.

import {useCallback, useEffect, useState} from 'react'
import {Image, View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {ApiError, isUnsupportedError, type Channel, type FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

type ChannelState = 'loading' | 'ready' | 'missing' | 'error' | 'unsupported'

function FollowButton({
  channel,
  onToggle,
}: {
  channel: Channel
  onToggle: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const following = channel.isFollowing
  const unknown = following == null
  return (
    <View style={[atoms.row, atoms.gap_sm]}>
      <Button
        label={following ? 'Unfollow' : 'Follow'}
        variant={following ? 'secondary' : 'primary'}
        disabled={busy || unknown}
        disabledReason={
          unknown ? 'This server does not report whether you follow this channel.' : undefined
        }
        onPress={() => {
          if (busy) return
          setBusy(true)
          void onToggle().finally(() => setBusy(false))
        }}
        testID="channel-follow"
      />
    </View>
  )
}

export function ChannelScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Channel'>>()
  const id = route.params.id
  const {session, backend} = useActiveBackend()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [state, setState] = useState<ChannelState>('loading')
  const [actionError, setActionError] = useState<string | null>(null)

  const channelsApi = backend?.channels
  const capable = backend?.capabilities.channels === 'supported'

  const load = useCallback(async () => {
    if (!session || !channelsApi || !capable) return
    setState('loading')
    setChannel(null)
    try {
      const found = await channelsApi.show(id)
      setChannel(found)
      setState('ready')
    } catch (err) {
      // `channels/show` answers HTTP 400 `NO_SUCH_CHANNEL` for a bad id
      // (not 404), so the honest "does not exist" state has to read the
      // server code. A 404/405 still means the fork lacks the endpoint.
      if (err instanceof ApiError && err.code === 'NO_SUCH_CHANNEL') {
        setState('missing')
        return
      }
      setState(isUnsupportedError(err) ? 'unsupported' : 'error')
    }
  }, [session, channelsApi, capable, id])

  useEffect(() => {
    if (!session || !backend) return
    if (!channelsApi || !capable) {
      setState('unsupported')
      return
    }
    void load()
  }, [session, backend, channelsApi, capable, load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channel-screen">
        <Pagehead title="Channel" />
        <Body>Sign in to see this channel.</Body>
        <Caption color="faint">Channels never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (state === 'unsupported' || !channelsApi || !capable) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channel-screen">
        <Pagehead title="Channel" />
        <Body>Channels are not available on this server.</Body>
      </View>
    )
  }

  if (state === 'loading') {
    return (
      <View style={atoms.flex1} testID="channel-screen">
        <Pagehead title="Channel" />
        <SkeletonList variant="post" testID="channel-loading" />
      </View>
    )
  }

  if (state === 'error') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="channel-screen">
        <Pagehead title="Channel" />
        <Body>Could not load this channel.</Body>
        <Caption color="faint">Check your connection and try again.</Caption>
        <Button label="Retry" variant="secondary" onPress={() => void load()} testID="channel-retry" />
      </View>
    )
  }

  if (state === 'missing' || !channel) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channel-screen">
        <Pagehead title="Channel" />
        <Body>This channel does not exist.</Body>
      </View>
    )
  }

  const descriptor = `channel|${id}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="channel-screen">
      <Pagehead title={channel.name} />
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID="channel-header">
        {channel.bannerUrl ? (
          <Image
            source={{uri: channel.bannerUrl}}
            style={{width: '100%', height: 120, borderRadius: 8}}
            accessibilityIgnoresInvertColors
            testID="channel-banner"
          />
        ) : null}
        {channel.description ? <Body>{channel.description}</Body> : null}
        {channel.isArchived ? <Caption color="faint">This channel is archived.</Caption> : null}
        <FollowButton
          channel={channel}
          onToggle={async () => {
            setActionError(null)
            const wasFollowing = channel.isFollowing === true
            try {
              if (wasFollowing) await channelsApi.unfollow(id)
              else await channelsApi.follow(id)
              setChannel(prev => (prev ? {...prev, isFollowing: !wasFollowing} : prev))
            } catch (err) {
              setActionError(
                err instanceof Error ? err.message : 'Could not update the channel follow.',
              )
            }
          }}
        />
        {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      </View>
      <FeedView sessionId={session.id} descriptor={descriptor} testID="channel-feed" />
    </View>
  )
}
