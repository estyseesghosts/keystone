// Read-only reaction chips (slice 3.3).
//
// The write path (react, unreact, picker) lands in Phase 4 behind the
// post shadow + toggle queue. Here chips are display-only: supported
// servers render disabled chips carrying the reason; unsupported
// servers hide the row entirely. Never wired, never inert, never faked.

import {useState} from 'react'
import {Image, StyleSheet, View} from 'react-native'

import type {Capabilities, ReactionSummary} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {Pressable} from '#/components/Pressable'

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  art: {width: 14, height: 14, resizeMode: 'contain'},
})

const READONLY_REASON = 'Reactions are read-only in this build — the write path lands in Phase 4.'

function ChipArt({reactionKey, url}: {reactionKey: string; url: string | null}) {
  const [failed, setFailed] = useState(false)
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
  testID,
}: {
  reactions: ReactionSummary | null
  capabilities?: Capabilities | null
  testID?: string
}) {
  const theme = useTheme()
  if (!reactions || reactions.entries.length === 0) return null
  if (capabilities?.reactions === 'unsupported') return null
  return (
    <View style={styles.row} testID={testID}>
      {reactions.entries.map(entry => (
        <Pressable
          key={entry.key}
          testID={`reaction-${entry.key}`}
          disabled
          accessibilityRole="button"
          accessibilityState={{disabled: true}}
          accessibilityLabel={`${entry.key}, ${entry.count}. ${READONLY_REASON}`}
          style={[styles.chip, {borderColor: theme.palette.edge}]}>
          <ChipArt reactionKey={entry.key} url={entry.url} />
          <Caption color="muted">{String(entry.count)}</Caption>
        </Pressable>
      ))}
    </View>
  )
}
