// Read-only reaction chips (slice 3.3).
//
// The write path (react, unreact, picker) lands in Phase 4 behind the
// post shadow + toggle queue. Here chips are display-only: supported
// servers render disabled chips carrying the reason; unsupported
// servers hide the row entirely. Never wired, never inert, never faked.

import {StyleSheet, View} from 'react-native'

import type {Capabilities, ReactionSummary} from '@keystone/fedi'
import {HEART_REACTION, parseEmojiCode, shouldHideChip} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {PendingEmoji} from '#/components/PendingEmoji'
import {Pressable} from '#/components/Pressable'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
})

const READONLY_REASON = 'Reactions are read-only here.'

function ChipArt({
  reactionKey,
  url,
  packed,
  sessionId,
  authorHost,
  pending,
  mine,
}: {
  reactionKey: string
  url: string | null
  /** Packed per-object map (`reactions.urls`) for tolerant lookup. */
  packed: Record<string, string> | null
  /** Owning session (WS-C remote fallback): explicit wins, otherwise
   * the active session; null = packed-only resolution. */
  sessionId: string | null
  /** Origin host hint for host-less codes in remote-authored content. */
  authorHost: string | null
  pending?: boolean
  mine: boolean
}) {
  const theme = useTheme()
  // An inverted (mine) chip paints its background with `text`, so its
  // foreground must be `bg` — otherwise the fallback label vanishes.
  const fallbackColor = mine ? theme.palette.bg : theme.palette.text
  // Optimistic custom emoji with unknown art: fixed box, never `:code:`.
  if (pending && url === null) return <PendingEmoji />
  // Custom keys route through the glyph's full chain (E1): the packed
  // entry URL, the tolerant packed-map lookup (colon-wrapped or bare
  // server key shapes), the session listing, then the remote/author
  // host tables — literal `:code:` only when nothing resolves, never a
  // fabricated image. Mastodon-family keys arrive as bare shortcodes
  // (`hehe` with a packed URL); those take the same path.
  const parsed = parseEmojiCode(reactionKey)
  const bareCustom = parsed === null && url !== null && /^[A-Za-z0-9_+-]+$/.test(reactionKey)
  if (parsed !== null || bareCustom) {
    return (
      <CustomEmojiGlyph
        name={parsed ? parsed.name : reactionKey}
        host={parsed ? parsed.host : null}
        src={url}
        packed={packed}
        sessionId={sessionId}
        authorHost={authorHost}
        size={14}
        textStyle={{color: fallbackColor}}
      />
    )
  }
  return <UnicodeEmoji sequence={reactionKey} size={14} textStyle={{color: fallbackColor}} />
}

export function ReactionChips({
  reactions,
  capabilities,
  pendingKeys,
  likeEmoji = HEART_REACTION,
  onToggle,
  testID,
  sessionId = null,
  authorHost = null,
}: {
  /** Tap a chip to react with / clear that key. Omit = read-only chips. */
  onToggle?: (key: string) => void
  reactions: ReactionSummary | null
  /** `usePostShadow(...).pendingEmojiKeys` */
  pendingKeys?: ReadonlySet<string>
  /** The configured like key: like-kind reactions live on the like
   * button, never as chips (v1 `visibleReactions` parity, F18). */
  likeEmoji?: string
  capabilities?: Capabilities | null
  testID?: string
  /** Owning session for the WS-C remote fallback (E1): explicit wins
   * (per-column accounts), otherwise the active session, else
   * packed-only. PostCard does not thread this yet (WS-A file) — the
   * fallback covers cards until it does. */
  sessionId?: string | null
  /** Origin host hint for host-less codes in remote-authored content
   * (v1 `host={note.author.host}` parity). */
  authorHost?: string | null
}) {
  const theme = useTheme()
  const activeId = useOptionalActiveSession()?.id ?? null
  const sid = sessionId ?? activeId
  if (!reactions || reactions.entries.length === 0) return null
  if (capabilities?.reactions === 'unsupported') return null
  // Hearts always hide (they live on the like button), plus the
  // configured custom like emoji.
  const entries = reactions.entries.filter(e => !shouldHideChip(e.key, likeEmoji))
  if (entries.length === 0) return null
  return (
    <View style={styles.row} testID={testID}>
      {entries.map(entry => {
        const mine = reactions.mine === entry.key
        return (
          <Pressable
            key={entry.key}
            testID={`reaction-${entry.key}`}
            disabled={!onToggle}
            onPress={onToggle ? () => onToggle(entry.key) : undefined}
            accessibilityRole="button"
            accessibilityState={{disabled: !onToggle, selected: mine}}
            accessibilityLabel={
              onToggle
                ? `${entry.key}, ${entry.count}${mine ? ', yours' : ''}`
                : `${entry.key}, ${entry.count}. ${READONLY_REASON}`
            }
            style={[
              styles.chip,
              {
                borderColor: mine ? theme.palette.text : theme.palette.edge,
                backgroundColor: mine ? theme.palette.text : theme.palette.bgSoft,
              },
            ]}>
            <ChipArt reactionKey={entry.key} url={entry.url} packed={reactions.urls} sessionId={sid} authorHost={authorHost} pending={pendingKeys?.has(entry.key)} mine={mine} />
            <Caption style={{color: mine ? theme.palette.bg : theme.palette.muted}}>
              {String(entry.count)}
            </Caption>
          </Pressable>
        )
      })}
    </View>
  )
}
