// Channels index (`/channels`): the Misskey-family group timelines the
// server publishes. The directory is `channels/search` with an empty query
// (the paged listing; `channels/featured` is a fixed top-10 with no
// cursor), newest first. Tapping a row opens the channel at
// `/channels/:id`. Gated on `capabilities.channels === "supported"` and a
// present `channels` module: the Mastodon family (and any unverified fork)
// gets the honest "not available" state, never an empty list pretending the
// server has no channels. Create/edit and channel mute are out of this
// slice (clickstone §1.9).

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {isUnsupportedError, type Channel, type Cursor} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

const PAGE_SIZE = 20

export function channelSummaryLine(channel: Channel): string {
  const bits: string[] = []
  if (channel.usersCount != null) bits.push(`${channel.usersCount} members`)
  if (channel.notesCount != null) bits.push(`${channel.notesCount} notes`)
  if (channel.isArchived) bits.push('archived')
  if (channel.isFollowing) bits.push('following')
  return bits.join(' · ')
}

function ChannelRow({
  channel,
  onOpen,
}: {
  channel: Channel
  onOpen: () => void
}) {
  const summary = channelSummaryLine(channel)
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`channels-row-${channel.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={`${channel.name}. Open channel.`}
        testID={`channels-open-${channel.id}`}>
        <Body>{channel.name}</Body>
      </Pressable>
      {channel.description ? <Caption color="faint">{channel.description}</Caption> : null}
      {summary ? <Caption color="faint">{summary}</Caption> : null}
    </View>
  )
}

export function ChannelsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [end, setEnd] = useState(true)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)

  const channelsApi = backend?.channels
  const capable = backend?.capabilities.channels === 'supported'

  const load = useCallback(async () => {
    if (!session || !channelsApi || !capable) {
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      const page = await channelsApi.list({limit: PAGE_SIZE})
      setChannels(page.items)
      setCursor(page.cursor)
      setEnd(page.end)
      setUnsupported(false)
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true)
      else setError(err)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [session, channelsApi, capable])

  const loadMore = useCallback(async () => {
    if (!channelsApi || fetching || end || cursor == null) return
    setFetching(true)
    try {
      const page = await channelsApi.list({cursor, limit: PAGE_SIZE})
      setChannels(prev => {
        const seen = new Set((prev ?? []).map(c => c.id))
        return [...(prev ?? []), ...page.items.filter(c => !seen.has(c.id))]
      })
      setCursor(page.cursor)
      setEnd(page.end)
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true)
      else setError(err)
    } finally {
      setFetching(false)
    }
  }, [channelsApi, cursor, end, fetching])

  useEffect(() => {
    setChannels(null)
    setCursor(null)
    setEnd(true)
    setUnsupported(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channels-screen">
        <Pagehead title="Channels" />
        <Body>Sign in to see channels.</Body>
        <Caption color="faint">Channels never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  // `unknown` deliberately does not unlock the directory: an unverified
  // server gets the same honest answer as one that has no channels.
  if (unsupported || !channelsApi || !capable) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channels-screen">
        <Pagehead title="Channels" />
        <Body>Channels are not available on this server.</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="channels-screen">
      <Pagehead title="Channels" />
      {loading ? (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Loader testID="channels-loading" />
          <Caption color="faint">Loading…</Caption>
        </View>
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>Could not load channels.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => {
              setLoading(true)
              void load()
            }}
            testID="channels-retry"
          />
        </View>
      ) : (
        <FlatList
          data={channels ?? []}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <ChannelRow
              channel={item}
              onOpen={() => navigation.navigate('Channel', {id: item.id})}
            />
          )}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="channels-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>No channels found on this server.</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
