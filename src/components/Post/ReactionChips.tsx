// Read-only reaction chips (slice 3.3).
//
// The write path (react, unreact, picker) lands in Phase 4 behind the
// post shadow + toggle queue. Here chips are display-only: supported
// servers render disabled chips carrying the reason; unsupported
// servers hide the row entirely. Never wired, never inert, never faked.

import {useState} from 'react'
import {Image, StyleSheet, View} from 'react-native'

import type {Capabilities, ReactionSummary} from '@keystone/fedi'
import {HEART_REACTION, shouldHideChip} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {PendingEmoji} from '#/components/PendingEmoji'
import {Pressable} from '#/components/Pressable'

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
  art: {width: 14, height: 14, resizeMode: 'contain'},
})

const READONLY_REASON = 'Reactions are read-only in this build — the write path lands in Phase 4.'

function ChipArt({
  reactionKey,
  url,
  pending,
}: {
  reactionKey: string
  url: string | null
  pending?: boolean
}) {
  const [failed, setFailed] = useState(false)
  // Optimistic custom emoji with unknown art: fixed box, never `:code:`.
  if (pending && url === null) return <PendingEmoji />
  if (url !== null && !failed) {
    return (
      <Image
        source={{uri: url}}
        style={styles.art}
        accessibilityLabel={reactionKey}
        onError={() => setFailed(true)}
      />
    )
  }
  // Custom `:code:` keys without art render as their literal text —
  // the read-only display fallback, never a fabricated image.
  if (reactionKey.includes(':')) return <Caption>{reactionKey}</Caption>
  return <UnicodeEmoji sequence={reactionKey} size={14} />
}

export function ReactionChips({
  reactions,
  capabilities,
  pendingKeys,
  likeEmoji = HEART_REACTION,
  onToggle,
  testID,
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
}) {
  const theme = useTheme()
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
            <ChipArt reactionKey={entry.key} url={entry.url} pending={pendingKeys?.has(entry.key)} />
            <Caption style={{color: mine ? theme.palette.bg : theme.palette.muted}}>
              {String(entry.count)}
            </Caption>
          </Pressable>
        )
      })}
    </View>
  )
}
