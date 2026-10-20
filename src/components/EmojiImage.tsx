// Unicode + custom emoji glyphs (slice 3.9).
//
// Two cases stay separate, per docs/twemoji.md:
// - Unicode emoji: a complete sequence rendered via the selected remote
//   style (Twemoji by default, version-pinned in `@keystone/fedi`), with
//   a system-font fallback when the asset is missing or fails to load.
// - Custom emoji: a `:code:` rendered ONLY from a packed source (the
//   node's server-vetted `src` or the post's packed map via
//   `lookupPackedEmojis`). Anything else renders the literal `:code:` —
//   never a fabricated URL, never a local lookalike for a remote code.

import {useState} from 'react'
import {Image, StyleSheet, Text, type StyleProp, type TextStyle} from 'react-native'

import {
  lookupPackedEmojis,
  resolveEmojiUrl,
  safeHttpUrl,
  type EmojiStyle,
} from '@keystone/fedi'

const GLYPH = 16

const styles = StyleSheet.create({
  remote: {resizeMode: 'contain'},
  fallback: {fontSize: GLYPH, lineHeight: GLYPH + 4},
})

export type UnicodeEmojiProps = {
  sequence: string
  style?: EmojiStyle
  size?: number
  textStyle?: StyleProp<TextStyle>
  testID?: string
}

// One complete Unicode emoji sequence in the selected style. Falls back
// to the system font when the style is `system`, the asset is unknown,
// or the image fails to load (never a broken-image icon).
export function UnicodeEmoji({sequence, style = 'twemoji', size = GLYPH, textStyle, testID}: UnicodeEmojiProps) {
  const [failed, setFailed] = useState(false)
  const url = style === 'system' ? null : resolveEmojiUrl(style, sequence)
  if (url === null || failed) {
    return (
      <Text style={[styles.fallback, {fontSize: size, lineHeight: size + 4}, textStyle]} testID={testID}>
        {sequence}
      </Text>
    )
  }
  return (
    <Image
      source={{uri: url}}
      style={[styles.remote, {width: size, height: size}]}
      onError={() => setFailed(true)}
      accessibilityRole="image"
      accessibilityLabel={sequence}
      testID={testID}
    />
  )
}

export type CustomEmojiProps = {
  name: string
  host: string | null
  /** Server-vetted image URL (HTML emoji images arrive vetted). */
  src: string | null
  /** The post's packed emoji map (MFM codes resolve here). */
  packed?: Record<string, string> | null
  size?: number
  testID?: string
}

// A `:code:` emoji from packed sources only. Resolution order: the
// node's vetted `src`, then the packed map. A URL that fails to load
// falls through to the next source; with no source left, the literal
// `:code:` renders.
export function CustomEmojiGlyph({name, host, src, packed, size = GLYPH + 2, testID}: CustomEmojiProps) {
  const code = host ? `:${name}@${host}:` : `:${name}:`
  const candidates = [safeHttpUrl(src), safeHttpUrl(lookupPackedEmojis(packed, code))].filter(
    (u): u is string => u !== null,
  )
  const [index, setIndex] = useState(0)
  if (index >= candidates.length) {
    return <Text testID={testID}>{code}</Text>
  }
  return (
    <Image
      source={{uri: candidates[index]}}
      style={[styles.remote, {width: size, height: size}]}
      onError={() => setIndex(i => i + 1)}
      accessibilityRole="image"
      accessibilityLabel={code}
      testID={testID}
    />
  )
}
