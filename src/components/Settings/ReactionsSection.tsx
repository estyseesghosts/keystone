import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {isUnsupportedError, UNICODE_EMOJI_GROUPS} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {Button} from '#/components/Button'
import {Pressable} from '#/components/Pressable'
import {TextField} from '#/components/forms/TextField'
import {useActiveBackend} from '#/screens/HomeFeed'
import {
  ANON_SCOPE,
  DEFAULT_LIKE_EMOJI,
  emojiGroupPrefsStore,
  favouritesStore,
  likeEmojiStore,
  useFavourites,
  useHiddenGroups,
  useLikeEmoji,
  usePinnedGroups,
  type EmojiGroupPrefsStore,
  type FavouritesStore,
  type LikeEmojiStore,
} from '#/state/emojiPrefs'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint, SettingRow} from './rows'

// Reactions section (v1 `/settings/reactions` parity): the device-local
// like emoji, the favourites list, and unicode-group pin/hide management
// (the picker is the main path; this page is the keyboard/touch
// equivalent). The like emoji also best-effort persists server-side
// (`i/update { defaultReaction }`, v1 `tryPersistLikeEmoji` parity) where
// the family supports it — the device value stays the source of truth.

function scopeOf(sessionId: string | null): string {
  return sessionId ?? ANON_SCOPE
}

function LikeEmojiRow({
  scope,
  likes = likeEmojiStore,
}: {
  scope: string
  likes?: LikeEmojiStore
}) {
  const {backend} = useActiveBackend()
  const current = useLikeEmoji(scope, likes)
  const [draft, setDraft] = useState(current)
  const [busy, setBusy] = useState(false)
  const [serverNote, setServerNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(current)
  }, [current])

  const persistServer = async (emoji: string): Promise<void> => {
    if (!backend) {
      setServerNote('Device only while signed out.')
      return
    }
    if (backend.family !== 'misskey') {
      setServerNote('Device only: this server has no default-reaction field.')
      return
    }
    setBusy(true)
    try {
      await backend.updateProfile({ext: {defaultReaction: emoji}})
      setServerNote(null)
    } catch (err) {
      if (isUnsupportedError(err)) {
        setServerNote('Device only: this server has no default-reaction field.')
      } else {
        setServerNote('Device only: the server refused the value.')
      }
    } finally {
      setBusy(false)
    }
  }

  const save = (emoji: string) => {
    const clean = emoji.trim()
    if (clean.length === 0) {
      setError('Enter an emoji first.')
      return
    }
    setError(null)
    likes.set(scope, clean)
    void persistServer(clean)
  }

  return (
    <SettingRow
      title="Like emoji"
      hint="The one-tap like on every post. Saved on this device; sent to the server where supported."
      testID="like-emoji-row">
      <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
        <UnicodeEmoji sequence={current} size={28} />
        <Body testID="like-emoji-current">{current}</Body>
      </View>
      <TextField
        label="Custom like emoji"
        value={draft}
        onChangeText={setDraft}
        placeholder={DEFAULT_LIKE_EMOJI}
        error={error ?? undefined}
        testID="like-emoji-field"
      />
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label="Save"
          variant="primary"
          disabled={busy}
          onPress={() => save(draft)}
          testID="like-emoji-save"
        />
        <Button
          label="Reset to heart"
          variant="secondary"
          disabled={busy || current === DEFAULT_LIKE_EMOJI}
          disabledReason={current === DEFAULT_LIKE_EMOJI ? 'Already the default heart.' : undefined}
          onPress={() => save(DEFAULT_LIKE_EMOJI)}
          testID="like-emoji-reset"
        />
      </View>
      {serverNote ? <Caption color="faint">{serverNote}</Caption> : null}
    </SettingRow>
  )
}

function FavouritesRow({scope, favs = favouritesStore}: {scope: string; favs?: FavouritesStore}) {
  const list = useFavourites(scope, favs)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    const clean = draft.trim()
    if (clean.length === 0) {
      setError('Enter an emoji first.')
      return
    }
    setError(null)
    favs.toggle(scope, clean)
    setDraft('')
  }
  return (
    <SettingRow
      title="Favourite emoji"
      hint="Pinned at the top of the emoji picker, after recents."
      testID="favourites-row">
      {list.length === 0 ? (
        <Caption color="faint">No favourites yet. Add one below, or star emoji in the picker.</Caption>
      ) : (
        <View style={[atoms.gap_sm]} testID="favourites-list">
          {list.map(emoji => (
            <View key={emoji} style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
              <UnicodeEmoji sequence={emoji} size={24} />
              <Body>{emoji}</Body>
              <Button
                label="Remove"
                variant="secondary"
                onPress={() => favs.remove(scope, emoji)}
                testID={`favourite-remove-${emoji}`}
              />
            </View>
          ))}
        </View>
      )}
      <TextField
        label="Add a favourite"
        value={draft}
        onChangeText={setDraft}
        placeholder="👍"
        error={error ?? undefined}
        testID="favourite-field"
      />
      <Button label="Add favourite" variant="secondary" onPress={add} testID="favourite-add" />
    </SettingRow>
  )
}

function UnicodeGroupsRow({groups = emojiGroupPrefsStore}: {groups?: EmojiGroupPrefsStore}) {
  const pinned = usePinnedGroups(groups)
  const hidden = useHiddenGroups(groups)
  return (
    <SettingRow
      title="Unicode groups"
      hint="Pin groups to the top of the picker, or hide the ones you never use."
      testID="unicode-groups-row">
      <View style={[atoms.gap_sm]}>
        {UNICODE_EMOJI_GROUPS.map(group => {
          const isPinned = pinned.includes(group.category)
          const isHidden = hidden.includes(group.category)
          return (
            <View key={group.category} style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
              <Body>{group.category}</Body>
              <Caption color="faint">
                {isPinned ? 'pinned' : isHidden ? 'hidden' : ''}
              </Caption>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: isPinned}}
                accessibilityLabel={`Pin ${group.category}`}
                onPress={() => (isPinned ? groups.unpin(group.category) : groups.pin(group.category))}
                testID={`group-pin-${group.category}`}>
                <Body>{isPinned ? 'Unpin' : 'Pin'}</Body>
              </Pressable>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: isHidden}}
                accessibilityLabel={`Hide ${group.category}`}
                onPress={() =>
                  isHidden ? groups.unhide(group.category) : groups.hide(group.category)
                }
                testID={`group-hide-${group.category}`}>
                <Body>{isHidden ? 'Unhide' : 'Hide'}</Body>
              </Pressable>
            </View>
          )
        })}
      </View>
    </SettingRow>
  )
}

export function ReactionsSection() {
  const session = useOptionalActiveSession()
  const scope = scopeOf(session?.id ?? null)
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-reactions">
      {!session ? (
        <SectionHint>
          Signed out: likes and favourites save to this device only, under a shared account.
        </SectionHint>
      ) : null}
      <LikeEmojiRow scope={scope} />
      <FavouritesRow scope={scope} />
      <UnicodeGroupsRow />
      <PlaceholderRow
        title="Back up emoji prefs"
        hint="Export likes, pins, and hides to a file; import them back."
        reason="Needs file sharing — not available in this build."
        testID="placeholder-emoji-backup"
      />
    </View>
  )
}
