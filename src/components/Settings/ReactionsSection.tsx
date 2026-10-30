import {useContext, useEffect, useMemo, useState} from 'react'
import {View} from 'react-native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'
import {QueryClientContext} from '@tanstack/react-query'

import {isUnsupportedError, UNICODE_EMOJI_GROUPS} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {Button} from '#/components/Button'
import {useCustomEmojis} from '#/components/EmojiPicker/EmojiPicker'
import {Pressable} from '#/components/Pressable'
import {TextField} from '#/components/forms/TextField'
import {useActiveBackend} from '#/screens/HomeFeed'
import {NO_CUSTOM_EMOJIS, useCustomEmojiSelect, useCustomEmojiStore} from '#/state/customEmojiStores'
import {
  ANON_SCOPE,
  DEFAULT_LIKE_EMOJI,
  emojiGroupPrefsStore,
  favouritesStore,
  likeEmojiStore,
  persistLikeEmojiServer,
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
  const i18n = useI18n()

  useEffect(() => {
    setDraft(current)
  }, [current])

  const persistServer = async (emoji: string): Promise<void> => {
    if (!backend) {
      setServerNote(i18n._(msg`Device only while signed out.`))
      return
    }
    setBusy(true)
    try {
      const failure = await persistLikeEmojiServer(backend, emoji)
      if (failure === null) setServerNote(null)
      else if (failure === 'unsupported') {
        setServerNote(i18n._(msg`Device only: this server has no default-reaction field.`))
      } else {
        setServerNote(i18n._(msg`Device only: the server refused the value.`))
      }
    } finally {
      setBusy(false)
    }
  }

  const save = (emoji: string) => {
    const clean = emoji.trim()
    if (clean.length === 0) {
      setError(i18n._(msg`Enter an emoji first.`))
      return
    }
    setError(null)
    likes.set(scope, clean)
    void persistServer(clean)
  }

  return (
    <SettingRow
      title={i18n._(msg`Like emoji`)}
      hint={i18n._(msg`The one-tap like on every post. Saved on this device; sent to the server where supported.`)}
      testID="like-emoji-row">
      <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
        <UnicodeEmoji sequence={current} size={28} />
        <Body testID="like-emoji-current">{current}</Body>
      </View>
      <TextField
        label={i18n._(msg`Custom like emoji`)}
        value={draft}
        onChangeText={setDraft}
        placeholder={DEFAULT_LIKE_EMOJI}
        error={error ?? undefined}
        testID="like-emoji-field"
      />
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={i18n._(msg({message: 'Save', context: 'settings button', comment: 'Save the custom like emoji'}))}
          variant="primary"
          disabled={busy}
          onPress={() => save(draft)}
          testID="like-emoji-save"
        />
        <Button
          label={i18n._(msg`Reset to heart`)}
          variant="secondary"
          disabled={busy || current === DEFAULT_LIKE_EMOJI}
          disabledReason={current === DEFAULT_LIKE_EMOJI ? i18n._(msg`Already the default heart.`) : undefined}
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
  const i18n = useI18n()
  const add = () => {
    const clean = draft.trim()
    if (clean.length === 0) {
      setError(i18n._(msg`Enter an emoji first.`))
      return
    }
    setError(null)
    favs.toggle(scope, clean)
    setDraft('')
  }
  return (
    <SettingRow
      title={i18n._(msg`Favourite emoji`)}
      hint={i18n._(msg`Pinned at the very top of the emoji picker.`)}
      testID="favourites-row">
      {list.length === 0 ? (
        <Caption color="faint">{i18n._(msg`No favourites yet. Add one below, or star emoji in the picker.`)}</Caption>
      ) : (
        <View style={[atoms.gap_sm]} testID="favourites-list">
          {list.map(emoji => (
            <View key={emoji} style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
              <UnicodeEmoji sequence={emoji} size={24} />
              <Body>{emoji}</Body>
              <Button
                label={i18n._(
                  msg({message: 'Remove', context: 'settings button', comment: 'Remove the emoji from favourites'}),
                )}
                variant="secondary"
                onPress={() => favs.remove(scope, emoji)}
                testID={`favourite-remove-${emoji}`}
              />
            </View>
          ))}
        </View>
      )}
      <TextField
        label={i18n._(msg`Add a favourite`)}
        value={draft}
        onChangeText={setDraft}
        placeholder="👍"
        error={error ?? undefined}
        testID="favourite-field"
      />
      <Button label={i18n._(msg`Add favourite`)} variant="secondary" onPress={add} testID="favourite-add" />
    </SettingRow>
  )
}

function GroupToggleRow({
  category,
  pinned,
  hidden,
  onPin,
  onHide,
  testPrefix,
}: {
  category: string
  pinned: boolean
  hidden: boolean
  onPin: () => void
  onHide: () => void
  testPrefix: string
}) {
  const i18n = useI18n()
  return (
    <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
      <Body>{category}</Body>
      <Caption color="faint">
        {pinned
          ? i18n._(msg({message: 'pinned', context: 'emoji group status', comment: 'Status: the group is pinned'}))
          : hidden
            ? i18n._(msg({message: 'hidden', context: 'emoji group status', comment: 'Status: the group is hidden'}))
            : ''}
      </Caption>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{checked: pinned}}
        accessibilityLabel={i18n._(msg`Pin ${category}`)}
        onPress={onPin}
        testID={`${testPrefix}-pin-${category}`}>
        <Body>
          {pinned
            ? i18n._(msg({message: 'Unpin', context: 'emoji group toggle', comment: 'Unpin the emoji group'}))
            : i18n._(msg({message: 'Pin', context: 'emoji group toggle', comment: 'Pin the emoji group'}))}
        </Body>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{checked: hidden}}
        accessibilityLabel={i18n._(msg`Hide ${category}`)}
        onPress={onHide}
        testID={`${testPrefix}-hide-${category}`}>
        <Body>
          {hidden
            ? i18n._(msg({message: 'Unhide', context: 'emoji group toggle', comment: 'Show the emoji group again'}))
            : i18n._(msg({message: 'Hide', context: 'emoji group toggle', comment: 'Hide the emoji group'}))}
        </Body>
      </Pressable>
    </View>
  )
}

function UnicodeGroupsRow({groups = emojiGroupPrefsStore}: {groups?: EmojiGroupPrefsStore}) {
  const pinned = usePinnedGroups(groups)
  const hidden = useHiddenGroups(groups)
  const i18n = useI18n()
  return (
    <SettingRow
      title={i18n._(msg`Unicode groups`)}
      hint={i18n._(msg`Pin groups to the top of the picker, or hide the ones you never use.`)}
      testID="unicode-groups-row">
      <View style={[atoms.gap_sm]}>
        {UNICODE_EMOJI_GROUPS.map(group => (
          <GroupToggleRow
            key={group.category}
            category={group.category}
            pinned={pinned.includes(group.category)}
            hidden={hidden.includes(group.category)}
            onPin={() =>
              pinned.includes(group.category) ? groups.unpin(group.category) : groups.pin(group.category)
            }
            onHide={() =>
              hidden.includes(group.category) ? groups.unhide(group.category) : groups.hide(group.category)
            }
            testPrefix="group"
          />
        ))}
      </View>
    </SettingRow>
  )
}

/**
 * Custom (server) emoji groups for the active session: pin/hide, plus
 * the restore path for hidden ones. Hidden names with no live category
 * still list (unhide restores them when the server has them again).
 * Signed-out trees have no session listing — unicode groups only.
 * Provider-less trees (tests, bare shells) render nothing: the custom
 * listing is a react-query read, so it can only run inside the inner
 * component (same guard as the shell notification host).
 */
function CustomGroupsRow({
  sessionId,
  groups = emojiGroupPrefsStore,
}: {
  sessionId: string
  groups?: EmojiGroupPrefsStore
}) {
  const qc = useContext(QueryClientContext)
  if (!qc) return null
  return <CustomGroupsRowInner sessionId={sessionId} groups={groups} />
}

function CustomGroupsRowInner({
  sessionId,
  groups = emojiGroupPrefsStore,
}: {
  sessionId: string
  groups?: EmojiGroupPrefsStore
}) {
  const pinned = usePinnedGroups(groups)
  const hidden = useHiddenGroups(groups)
  const i18n = useI18n()
  const store = useCustomEmojiStore(sessionId)
  const hosted = useCustomEmojiSelect(store, s =>
    s != null && s.state() === 'ready' ? s.emojis() : NO_CUSTOM_EMOJIS,
  )
  const custom = useCustomEmojis(sessionId)
  const known = useMemo(() => {
    const seen: string[] = []
    for (const e of [...(custom.data ?? []), ...hosted]) {
      const category = e.category ?? null
      if (category != null && !seen.includes(category)) seen.push(category)
    }
    return seen
  }, [custom.data, hosted])
  const categories = useMemo(
    () => [...known, ...hidden.filter(h => !known.includes(h))],
    [known, hidden],
  )
  if (categories.length === 0) return null
  return (
    <SettingRow
      title={i18n._(msg`Custom emoji groups`)}
      hint={i18n._(msg`Pin server groups to the top of the picker, or hide the ones you never use. Unhide restores a hidden group.`)}
      testID="custom-groups-row">
      <View style={[atoms.gap_sm]}>
        {categories.map(category => (
          <GroupToggleRow
            key={category}
            category={category}
            pinned={pinned.includes(category)}
            hidden={hidden.includes(category)}
            onPin={() => (pinned.includes(category) ? groups.unpin(category) : groups.pin(category))}
            onHide={() => (hidden.includes(category) ? groups.unhide(category) : groups.hide(category))}
            testPrefix="group-custom"
          />
        ))}
      </View>
    </SettingRow>
  )
}

export function ReactionsSection({groups = emojiGroupPrefsStore}: {groups?: EmojiGroupPrefsStore}) {
  const session = useOptionalActiveSession()
  const scope = scopeOf(session?.id ?? null)
  const sessionIdForGroups = session?.id ?? null
  const i18n = useI18n()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-reactions">
      {!session ? (
        <SectionHint>
          {i18n._(msg`Signed out: likes and favourites save to this device only, under a shared account.`)}
        </SectionHint>
      ) : null}
      <LikeEmojiRow scope={scope} />
      <FavouritesRow scope={scope} />
      <UnicodeGroupsRow groups={groups} />
      {sessionIdForGroups != null ? <CustomGroupsRow sessionId={sessionIdForGroups} groups={groups} /> : null}
      <PlaceholderRow
        title={i18n._(msg`Back up emoji prefs`)}
        hint={i18n._(msg`Export likes, pins, and hides to a file; import them back.`)}
        reason={i18n._(msg`Needs file sharing — not available in this build.`)}
        testID="placeholder-emoji-backup"
      />
    </View>
  )
}
