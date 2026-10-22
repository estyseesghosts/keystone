// Shared threaded row wrapper (feeds + HomeFeed FeedView).
// A reply directly under its parent reads as one thread: a vertical
// connector in the avatar column joins the pair, like Keystone v1
// (`TimelineFeed` feed-row-thread + `computeFeedThreadLinks`).
// Own code, same behavior: adjacency only, via `replyToId`.

import {StyleSheet, View} from 'react-native'

import type {Account, Capabilities, EmojiStyle, Post} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {PostCard} from '#/components/Post/index'

// PostCard geometry: row padding 16h/12v, avatar 40. The line runs down
// the avatar centre (16 + 20 - 1), starting/ending at the avatar centre
// (12 + 20) on open ends — same rule as v1's feed-row ::before.
const LINE_LEFT = 35
const LINE_WIDTH = 2
const AVATAR_CENTER_Y = 32

const styles = StyleSheet.create({
  row: {position: 'relative'},
  line: {position: 'absolute', width: LINE_WIDTH, zIndex: 0},
  lineFirst: {top: AVATAR_CENTER_Y, bottom: 0},
  lineMiddle: {top: 0, bottom: 0},
  lineLast: {top: 0, height: AVATAR_CENTER_Y},
})

export type ThreadRowProps = {
  post: Post
  sessionId: string
  capabilities?: Capabilities | null
  emojiStyle?: EmojiStyle
  /** Aggregated reposters for a collapsed boost group (F17). */
  renoters?: Account[]
  connectedAbove?: boolean
  connectedBelow?: boolean
  /** v1 feed rule: every post is bounded by a horizontal separator except
   * inside a connected reply run (the thread line already joins those —
   * an internal rule would double the separation). */
  showSeparator?: boolean
  testID?: string
}

export function ThreadRow({
  post,
  sessionId,
  capabilities,
  emojiStyle = 'twemoji',
  renoters,
  connectedAbove = false,
  connectedBelow = false,
  showSeparator = false,
  testID,
}: ThreadRowProps) {
  const theme = useTheme()
  const inThread = connectedAbove || connectedBelow
  const variant = connectedAbove && connectedBelow ? styles.lineMiddle : connectedBelow ? styles.lineFirst : styles.lineLast
  return (
    <View style={styles.row} testID={testID ?? `thread-row-${post.id}`}>
      {showSeparator ? (
        <View
          testID={`thread-separator-${post.id}`}
          style={{height: 1, backgroundColor: theme.palette.border}}
        />
      ) : null}
      {inThread ? (
        <View
          testID={`thread-connector-${post.id}`}
          pointerEvents="none"
          style={[styles.line, variant, {left: LINE_LEFT, backgroundColor: theme.palette.border}]}
        />
      ) : null}
      <PostCard post={post} sessionId={sessionId} capabilities={capabilities} emojiStyle={emojiStyle} renoters={renoters} />
    </View>
  )
}
