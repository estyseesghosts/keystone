import {useMemo, useState, useSyncExternalStore} from 'react'
import {FlatList, View} from 'react-native'
import {useQuery} from '@tanstack/react-query'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {TextField} from '#/components/forms/TextField'
import {Pressable} from '#/components/Pressable'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {createQueryKey} from '#/state/queries/keys'
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

// Emoji picker (slice 4.5): recents (per session), the session's custom
// emoji grouped by category, Unicode categories, and search. Used for
// reactions (`reaction.setWithArt(key, url)`) and composer insertion.
// The custom list is fetched through the owning session's backend only.

export function customEmojiQueryKey(sessionId: string) {
  return createQueryKey(sessionId, 'custom-emoji')
}

export function useCustomEmojis(sessionId: string) {
  const backend = useBackendForSessionId(sessionId)
  return useQuery({
    queryKey: customEmojiQueryKey(sessionId),
    enabled: !!backend,
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

function Cell({emoji, onPress}: {emoji: PickedEmoji; onPress: () => void}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={emoji.key}
      testID={`emoji-cell-${emoji.key}`}
      style={{width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center'}}>
      {emoji.kind === 'custom' ? (
        // Fixed box: no `:code:` text appears until the image is known to
        // have failed (CustomEmojiGlyph's last resort).
        <CustomEmojiGlyph name={emoji.key.slice(1, -1)} host={null} src={emoji.url ?? null} size={24} />
      ) : (
        <UnicodeEmoji sequence={emoji.key} size={24} />
      )}
    </Pressable>
  )
}

export function EmojiPicker({sessionId, onPick, recentsStore = emojiRecentsStore, favouritesStore: favs = favouritesStore, groupPrefsStore: groups = emojiGroupPrefsStore, testID}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const custom = useCustomEmojis(sessionId)
  const recents = useSyncExternalStore(recentsStore.subscribe, () => recentsStore.list(sessionId))
  const favourites = useSyncExternalStore(favs.subscribe, () => favs.list(sessionId))
  const hiddenGroups = useHiddenGroups(groups)
  const pinnedGroups = usePinnedGroups(groups)
  const rows = useMemo(
    () =>
      sectionsToRows(
        buildPickerSections({
          custom: custom.data ?? [],
          recents,
          query,
          favourites: favourites.map(pickedFromKey),
          hiddenGroups,
          pinnedGroups,
        }),
      ),
    [custom.data, recents, query, favourites, hiddenGroups, pinnedGroups],
  )
  const pick = (emoji: PickedEmoji) => {
    recentsStore.touch(sessionId, emoji)
    onPick(emoji)
  }
  const render = ({item}: {item: PickerRow}) =>
    item.type === 'header' ? (
      <Caption color="faint">{item.title}</Caption>
    ) : (
      <View style={atoms.row}>
        {item.items.map(e => (
          <Cell key={e.key} emoji={e} onPress={() => pick(e)} />
        ))}
      </View>
    )
  return (
    <View style={[atoms.gap_sm, {maxHeight: 360}]} testID={testID ?? 'emoji-picker'}>
      <TextField label="Search emoji" value={query} onChangeText={setQuery} testID="emoji-search" />
      {custom.isError ? <Caption color="faint">Custom emoji are unavailable on this server.</Caption> : null}
      {rows.length === 0 ? <Body>No emoji found.</Body> : null}
      <FlatList data={rows} renderItem={render} keyExtractor={r => r.id} keyboardShouldPersistTaps="handled" />
    </View>
  )
}
