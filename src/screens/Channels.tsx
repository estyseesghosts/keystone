// Channels index (`/channels`): the Misskey-family group timelines. Two
// tabs: My channels (the viewer's followed channels) and Server channels
// (the whole public directory). Tapping a row opens the channel at
// `/channels/:id`. Gated on `capabilities.channels === "supported"` and a
// present `channels` module: the Mastodon family (and any unverified fork)
// gets the honest "not available" state, never an empty list pretending the
// server has no channels. Create/edit and channel mute are out of this
// slice (clickstone §1.9).

import {useCallback, useEffect, useRef, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {msg, plural} from '@lingui/macro'

import {
  isUnsupportedError,
  type Channel,
  type Cursor,
  type Page,
  type PageOpts,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import {Tabs} from '#/components/Tabs'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'

const PAGE_SIZE = 20

type ChannelsTab = 'mine' | 'server'

/** One-line channel summary (members · notes · archived · following).
 * Counts are real numbers, so they use `plural`. Pure. */
export function channelSummaryLine(channel: Channel): string {
  const bits: string[] = []
  if (channel.usersCount != null) {
    bits.push(
      i18n._(
        plural(channel.usersCount, {
          one: '# member',
          other: '# members',
        }),
      ),
    )
  }
  if (channel.notesCount != null) {
    bits.push(
      i18n._(
        plural(channel.notesCount, {
          one: '# note',
          other: '# notes',
        }),
      ),
    )
  }
  if (channel.isArchived) bits.push(i18n._(msg`archived`))
  if (channel.isFollowing) bits.push(i18n._(msg`following`))
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
        accessibilityLabel={i18n._(msg`${channel.name}. Open channel.`)}
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
  // A next-page failure never replaces the loaded list (rn-ui M3): it
  // parks here and renders as a footer with a working Retry instead.
  const [moreError, setMoreError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)
  // Stale-response guard (mirrors `User.tsx`'s `generationRef`): every
  // fresh load bumps the generation and aborts the previous request. A
  // resolution from an older generation (tab switch, account switch) is
  // ignored — its items and cursor never land under the new tab.
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const channelsApi = backend?.channels
  const capable = backend?.capabilities.channels === 'supported'
  const [tab, setTab] = useState<ChannelsTab>('mine')

  // Mine = the viewer's followed channels; server = the whole public
  // directory. Both page the same way, so one loader serves both tabs.
  const fetchPage = useCallback(
    (opts: PageOpts): Promise<Page<Channel>> => {
      if (!channelsApi) return Promise.reject(new Error('no channels module'))
      return tab === 'mine' ? channelsApi.followed(opts) : channelsApi.list(opts)
    },
    [channelsApi, tab],
  )

  const load = useCallback(async () => {
    // Bump first, even for the no-session early return below: signing out
    // (or losing the module) while a request is in flight must orphan it.
    const generation = ++generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (!session || !channelsApi || !capable) {
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    setMoreError(null)
    try {
      const page = await fetchPage({limit: PAGE_SIZE, signal: controller.signal})
      if (generationRef.current !== generation) return
      setChannels(page.items)
      setCursor(page.cursor)
      setEnd(page.end)
      setUnsupported(false)
    } catch (err) {
      if (generationRef.current !== generation) return
      if (isUnsupportedError(err)) setUnsupported(true)
      else setError(err)
    } finally {
      if (generationRef.current === generation) {
        setLoading(false)
        setFetching(false)
      }
    }
  }, [session, channelsApi, capable, fetchPage])

  const loadMore = useCallback(async () => {
    if (!channelsApi || fetching || end || cursor == null) return
    // No generation bump: this extends the current list, so it must still
    // be current when the page lands, or its items are dropped.
    const generation = generationRef.current
    setFetching(true)
    try {
      const page = await fetchPage({cursor, limit: PAGE_SIZE, signal: abortRef.current?.signal})
      if (generationRef.current !== generation) return
      setChannels(prev => {
        const seen = new Set((prev ?? []).map(c => c.id))
        return [...(prev ?? []), ...page.items.filter(c => !seen.has(c.id))]
      })
      setCursor(page.cursor)
      setEnd(page.end)
      setMoreError(null)
    } catch (err) {
      if (generationRef.current !== generation) return
      if (isUnsupportedError(err)) setUnsupported(true)
      else setMoreError(err)
    } finally {
      if (generationRef.current === generation) setFetching(false)
    }
  }, [channelsApi, cursor, end, fetching, fetchPage])

  useEffect(() => {
    setChannels(null)
    setCursor(null)
    setEnd(true)
    setUnsupported(false)
    setError(null)
    setMoreError(null)
    setLoading(true)
    void load()
    // A remount for a new tab/session aborts the previous request; its
    // late resolution is ignored by the generation check above.
    return () => abortRef.current?.abort()
  }, [load])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channels-screen">
        <Pagehead title={i18n._(msg`Channels`)} />
        <Body>{i18n._(msg`Sign in to see channels.`)}</Body>
        <Caption color="faint">
          {i18n._(msg`Channels never show sample data when signed out.`)}
        </Caption>
        <SignInButton />
      </View>
    )
  }

  // `unknown` deliberately does not unlock the directory: an unverified
  // server gets the same honest answer as one that has no channels.
  if (unsupported || !channelsApi || !capable) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="channels-screen">
        <Pagehead title={i18n._(msg`Channels`)} />
        <Body>{i18n._(msg`Channels are not available on this server.`)}</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="channels-screen">
      <Pagehead title={i18n._(msg`Channels`)} />
      <Tabs
        tabs={[
          {key: 'mine', label: i18n._(msg`My channels`)},
          {key: 'server', label: i18n._(msg`Server channels`)},
        ]}
        active={tab}
        onChange={setTab}
        testID="channels-tabs"
        testIDPrefix="channels-tab"
        accessibilityLabel={i18n._(msg`Channels`)}
      />
      {loading ? (
        <SkeletonList variant="row" testID="channels-loading" />
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load channels.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
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
          testID="channels-list"
          keyExtractor={item => item.id}
          ItemSeparatorComponent={() => (
            <View testID="channels-sep" style={{height: 1, backgroundColor: theme.palette.border}} />
          )}
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
            tab === 'mine' ? (
              <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
                <Body>{i18n._(msg`You are not following any channels yet.`)}</Body>
                <Button
                  label={i18n._(msg`Browse server channels`)}
                  variant="secondary"
                  onPress={() => setTab('server')}
                  testID="channels-browse-server"
                />
              </View>
            ) : (
              <View style={[atoms.centered, atoms.p_md]}>
                <Body>{i18n._(msg`No channels found on this server.`)}</Body>
              </View>
            )
          }
          ListFooterComponent={
            moreError ? (
              <View style={[atoms.centered, atoms.gap_sm, atoms.py_sm]}>
                <Caption color="faint">{i18n._(msg`Could not load more channels.`)}</Caption>
                <Button
                  label={i18n._(msg`Retry`)}
                  variant="secondary"
                  onPress={() => void loadMore()}
                  testID="channels-more-retry"
                />
              </View>
            ) : null
          }
        />
      )}
    </View>
  )
}
