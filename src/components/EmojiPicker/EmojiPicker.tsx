import {useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import {FlatList, View} from 'react-native'
import {useQuery} from '@tanstack/react-query'

import {isLocalEmojiHost} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {TextField} from '#/components/forms/TextField'
import {Pressable} from '#/components/Pressable'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {createQueryKey} from '#/state/queries/keys'
import {NO_CUSTOM_EMOJIS, useCustomEmojiSelect, useCustomEmojiStore} from '#/state/customEmojiStores'
import {
  emojiGroupPrefsStore,
  favouritesStore,
  useHiddenGroups,
  usePinnedGroups,
  type EmojiGroupPrefsStore,
  type FavouritesStore,
} from '#/state/emojiPrefs'

import {buildPickerSections, sectionsToRows, pickedFromKey, type PickedEmoji, type PickerRow} from './model'
import {emojiRecentsStore, type EmojiRecentsStore} from './recents'

// Emoji picker (slice 4.5, WS-C store-backed): recents (per session),
// the session's custom emoji grouped by category, remote-host results
// from the same session store, Unicode categories, and search. Used for
// reactions (`reaction.setWithArt(key, url)`) and composer insertion.
//
// Data comes from TWO session-scoped sources that agree (same public
// endpoint on Misskey-family): the `CustomEmojiStore` (local listing +
// remote-host tables + `unavailable` vs `error` states) and the
// react-query `backend.customEmojis()` read (covers Mastodon-family,
// whose store is `unavailable` by design — no Misskey endpoint exists
// there). Store entries win on name conflicts; every request goes
// through the owning session's backend or session-built call only.

export function customEmojiQueryKey(sessionId: string) {
  return createQueryKey(sessionId, 'custom-emoji')
}

export function useCustomEmojis(sessionId: string, opts?: {enabled?: boolean}) {
  const backend = useBackendForSessionId(sessionId)
  return useQuery({
    queryKey: customEmojiQueryKey(sessionId),
    enabled: !!backend && (opts?.enabled ?? true),
    staleTime: 10 * 60 * 1000,
    queryFn: () => backend!.customEmojis(),
  })
}

export type EmojiPickerProps = {
  sessionId: string
  onPick: (emoji: PickedEmoji) => void
  /** Test seam. */
  recentsStore?: EmojiRecentsStore
  favouritesStore?: FavouritesStore
  groupPrefsStore?: EmojiGroupPrefsStore
  testID?: string
}

const CELL = 36

function splitCellKey(key: string): {name: string; host: string | null} {
  const inner = key.length > 2 && key.startsWith(':') && key.endsWith(':') ? key.slice(1, -1) : key
  const at = inner.indexOf('@')
  if (at < 0) return {name: inner, host: null}
  return {name: inner.slice(0, at), host: inner.slice(at + 1) || null}
}

function Cell({sessionId, emoji, onPress}: {sessionId: string; emoji: PickedEmoji; onPress: () => void}) {
  const {name, host} = emoji.kind === 'custom' ? splitCellKey(emoji.key) : {name: '', host: null}
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={emoji.key}
      testID={`emoji-cell-${emoji.key}`}
      style={{width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center'}}>
      {emoji.kind === 'custom' ? (
        // Fixed box: no `:code:` text appears until the image is known to
        // have failed (CustomEmojiGlyph's last resort). The session id
        // lets session-known remote codes (`:name@host:` recents, remote
        // search hits) re-resolve through the store.
        <CustomEmojiGlyph name={name} host={host} src={emoji.url ?? null} sessionId={sessionId} size={24} />
      ) : (
        <UnicodeEmoji sequence={emoji.key} size={24} />
      )}
    </Pressable>
  )
}

export function EmojiPicker({sessionId, onPick, recentsStore = emojiRecentsStore, favouritesStore: favs = favouritesStore, groupPrefsStore: groups = emojiGroupPrefsStore, testID}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  // Live store reads (never bare — the compiler freezes bare method
  // calls on the stable store identity): each selector re-runs on every
  // store emission, so a landing host table re-renders this picker.
  const store = useCustomEmojiStore(sessionId)
  const storeState = useCustomEmojiSelect(store, s => s?.state() ?? 'idle')
  const hosted = useCustomEmojiSelect(store, s =>
    s != null && s.state() === 'ready' ? s.emojis() : NO_CUSTOM_EMOJIS,
  )
  const remote = useCustomEmojiSelect(store, s => s?.remoteEmojis() ?? NO_CUSTOM_EMOJIS)
  // Single source once the store is ready; the query covers
  // Mastodon-family (store `unavailable`) and signed-out trees.
  const custom = useCustomEmojis(sessionId, {enabled: storeState !== 'ready'})
  const merged = useMemo(() => {
    const byName = new Map<string, {name: string; url: string; category: string | null; aliases: string[]}>()
    for (const e of custom.data ?? []) {
      byName.set(e.name, {name: e.name, url: e.url, category: e.category ?? null, aliases: []})
    }
    for (const e of hosted) {
      byName.set(e.name, {name: e.name, url: e.url, category: e.category ?? null, aliases: []})
    }
    return [...byName.values()]
  }, [custom.data, hosted])
  const recents = useSyncExternalStoreShim(recentsStore, sessionId)
  const favourites = useSyncExternalStoreShimFavs(favs, sessionId)
  // Remote recents (`:name@host:`) seed the store's host tables on
  // mount, so search finds them in the Remote section even while the
  // recents row itself is hidden behind the query.
  useEffect(() => {
    if (!store) return
    for (const r of recents) {
      if (r.kind !== 'custom') continue
      const {host} = splitCellKey(r.key)
      if (host && !isLocalEmojiHost(host)) store.ensureHostEmojis(host)
    }
  }, [store, recents])
  const hiddenGroups = useHiddenGroups(groups)
  const pinnedGroups = usePinnedGroups(groups)
  const rows = useMemo(
    () =>
      sectionsToRows(
        buildPickerSections({
          custom: merged,
          remote,
          recents,
          query,
          favourites: favourites.map(pickedFromKey),
          hiddenGroups,
          pinnedGroups,
        }),
      ),
    [merged, remote, recents, query, favourites, hiddenGroups, pinnedGroups],
  )
  // `unavailable` (Pinetree: no listing endpoint; Mastodon-family
  // store) with no data omits the Custom sections silently — never a
  // spinner, never a retry for a server that has nothing to give. A
  // real failure surfaces the store/query error with a retry that
  // re-arms both sources.
  const failed = storeState === 'error' || (custom.isError && storeState !== 'ready')
  const pick = (emoji: PickedEmoji) => {
    recentsStore.touch(sessionId, emoji)
    onPick(emoji)
  }
  const retry = () => {
    store?.retry()
    void custom.refetch()
  }
  const render = ({item}: {item: PickerRow}) =>
    item.type === 'header' ? (
      <Caption color="faint">{item.title}</Caption>
    ) : (
      <View style={atoms.row}>
        {item.items.map(e => (
          <Cell key={e.key} sessionId={sessionId} emoji={e} onPress={() => pick(e)} />
        ))}
      </View>
    )
  return (
    <View style={[atoms.gap_sm, {maxHeight: 360}]} testID={testID ?? 'emoji-picker'}>
      <TextField label="Search emoji" value={query} onChangeText={setQuery} testID="emoji-search" />
      {failed && merged.length === 0 ? (
        <View style={atoms.gap_sm}>
          <Caption color="faint">Could not load custom emoji.</Caption>
          <Button label="Retry" variant="secondary" onPress={retry} testID="emoji-retry" />
        </View>
      ) : null}
      {rows.length === 0 ? <Body>No emoji found.</Body> : null}
      <FlatList data={rows} renderItem={render} keyExtractor={r => r.id} keyboardShouldPersistTaps="handled" />
    </View>
  )
}

function useSyncExternalStoreShim(store: EmojiRecentsStore, sessionId: string) {
  return useSyncExternalStore(store.subscribe, () => store.list(sessionId))
}

function useSyncExternalStoreShimFavs(store: FavouritesStore, sessionId: string) {
  return useSyncExternalStore(store.subscribe, () => store.list(sessionId))
}
