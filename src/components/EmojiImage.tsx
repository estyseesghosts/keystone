// Unicode + custom emoji glyphs (slice 3.9).
//
// Two cases stay separate, per docs/twemoji.md:
// - Unicode emoji: a complete sequence rendered via the selected remote
//   style (OpenMoji by default, version-pinned in `@keystone/fedi`), with
//   a system-font fallback when the asset is missing or fails to load.
// - Custom emoji: a `:code:` rendered ONLY from a packed source (the
//   node's server-vetted `src` or the post's packed map via
//   `lookupPackedEmojis`). Anything else renders the literal `:code:` —
//   never a fabricated URL, never a local lookalike for a remote code.

import {useEffect, useState} from 'react'
import {Image, StyleSheet, Text, type StyleProp, type TextStyle} from 'react-native'

import {
  DEFAULT_EMOJI_STYLE,
  isLocalEmojiHost,
  lookupPackedEmojis,
  resolveEmojiUrl,
  safeHttpUrl,
  type EmojiStyle,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {useCustomEmojiSelect, useCustomEmojiStore} from '#/state/customEmojiStores'

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
export function UnicodeEmoji({sequence, style = DEFAULT_EMOJI_STYLE, size = GLYPH, textStyle, testID}: UnicodeEmojiProps) {
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  const url = style === 'system' ? null : resolveEmojiUrl(style, sequence)
  if (url === null || failed) {
    return (
      <Text
        style={[styles.fallback, {fontSize: size, lineHeight: size + 4}, {color: theme.palette.text}, textStyle]}
        testID={testID}>
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
  /** Owning session id (WS-C remote fallback): the session-scoped
   * custom-emoji store resolves `:name@host:` through that host's
   * public listing and local codes through the session listing. Omit
   * for packed-only resolution (tests, session-less trees). */
  sessionId?: string | null
  /** Origin host hint for host-less codes in remote-authored content
   * (a `:code:` typed on instance H means H's emoji). Null skips it. */
  authorHost?: string | null
  size?: number
  /** Overrides the literal-`:code:` fallback color (e.g. a chip that
   * inverts its background when active). Defaults to `text`. */
  textStyle?: StyleProp<TextStyle>
  testID?: string
}

// A `:code:` emoji from packed sources, with the session-scoped remote
// fallback (WS-C). Resolution order: the node's vetted `src`, the
// packed map, then the session store — the remote host's listing for
// `:name@host:` codes, the author's host listing for host-less codes in
// remote-authored content, then the session's local listing. A URL that
// fails to load falls through to the next source; with no source left,
// the literal `:code:` renders — never a fabricated URL, never blank,
// never a local lookalike for a remote code.
export function CustomEmojiGlyph({
  name,
  host,
  src,
  packed,
  sessionId = null,
  authorHost = null,
  size = GLYPH + 2,
  textStyle,
  testID,
}: CustomEmojiProps) {
  const theme = useTheme()
  const store = useCustomEmojiStore(sessionId)
  const code = host ? `:${name}@${host}:` : `:${name}:`
  // Remote fetches are idempotent per store (one round-trip per host);
  // the kick lives in an effect and the read in a store selector — bare
  // `store.remoteUrlFor(...)` calls in render would be frozen by the
  // React Compiler (memoized on the stable store identity), so a host
  // listing landing later would never swap in.
  useEffect(() => {
    if (!store) return
    if (host && !isLocalEmojiHost(host)) store.ensureHostEmojis(host)
    else if (authorHost && !isLocalEmojiHost(authorHost)) store.ensureHostEmojis(authorHost)
  }, [store, host, authorHost])
  const storeUrl = useCustomEmojiSelect(store, s => {
    if (!s) return null
    if (host && !isLocalEmojiHost(host)) return s.remoteUrlFor(host, name)
    const hinted = authorHost && !isLocalEmojiHost(authorHost) ? s.remoteUrlFor(authorHost, name) : null
    if (hinted !== null) return hinted
    return s.urlFor(host ? `:${name}@${host}:` : `:${name}:`)
  })
  const candidates = [safeHttpUrl(src), safeHttpUrl(lookupPackedEmojis(packed, code)), safeHttpUrl(storeUrl)].filter(
    (u): u is string => u !== null,
  )
  const [index, setIndex] = useState(0)
  if (index >= candidates.length) {
    return (
      <Text testID={testID} style={[{color: theme.palette.text}, textStyle]}>
        {code}
      </Text>
    )
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
