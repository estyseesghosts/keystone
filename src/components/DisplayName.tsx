// Display name with custom-emoji codes rendered as glyphs (F11).
//
// Names like `Ann :blobcat:` or `Ann :wave@remote:` render the emoji
// inline via the account's packed map; unknown codes stay literal —
// never a fabricated image. Unicode emoji in names render in the
// system font (no per-grapheme Twemoji pass on names).
import {Fragment, useMemo} from 'react'
import {Text, type StyleProp, type TextStyle} from 'react-native'

import {splitNameEmojis, type Account} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {CustomEmojiGlyph} from '#/components/EmojiImage'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

function splitCode(code: string): {name: string; host: string | null} {
  const inner = code.replace(/^:|:$/g, '')
  const at = inner.indexOf('@')
  if (at < 0) return {name: inner, host: null}
  return {name: inner.slice(0, at), host: inner.slice(at + 1) || null}
}

function NameEmoji({
  code,
  emojis,
  sessionId,
  authorHost,
  size,
}: {
  code: string
  emojis: Record<string, string>
  sessionId: string | null
  authorHost: string | null
  size: number
}) {
  const {name, host} = splitCode(code)
  return <CustomEmojiGlyph name={name} host={host} src={null} packed={emojis} sessionId={sessionId} authorHost={authorHost} size={size + 2} />
}

/** Name==handle collapse (v1): when the shown display name is just the
 * handle, render the handle AS the display name — one line, no second
 * smaller handle line underneath.
 *
 * Rule, against `handleOf` semantics (`@user` local, `@user@host`
 * remote): collapse when the trimmed display name exactly equals any of
 * the four handle spellings — `user`, `@user`, `user@host`,
 * `@user@host`. An empty display name collapses too (it falls back to
 * the bare username, so the handle is the honest single line).
 *
 * Deliberately NOT `hasRealDisplayName`'s wider rule: that also folds
 * case-insensitive username echoes (`Alice` for username `alice`),
 * which would regress the established two-line PostCard header for
 * ordinary names. The exact-echo case (`rina` for `rina`) still
 * collapses — that is the no-name-set account, where the old
 * `ProfileHeader` already hid the handle line. Pure. */
export function shouldCollapseName(
  account: Pick<Account, 'displayName' | 'username' | 'host'>,
): boolean {
  const shown = account.displayName.trim()
  if (shown.length === 0) return true
  const bare = account.host != null ? `${account.username}@${account.host}` : account.username
  return shown === account.username || shown === `@${bare}` || shown === bare
}

export function DisplayName({
  account,
  sessionId = null,
  size = 15,
  textStyle,
  numberOfLines = 1,
  testID,
}: {
  account: Pick<Account, 'displayName' | 'emojis'> & {host?: string | null}
  /** Owning session (WS-C remote fallback): explicit wins (per-column
   * accounts); otherwise the active session; null = packed-only. */
  sessionId?: string | null
  size?: number
  textStyle?: StyleProp<TextStyle>
  numberOfLines?: number
  testID?: string
}) {
  const parts = useMemo(() => splitNameEmojis(account.displayName), [account.displayName])
  const activeId = useOptionalActiveSession()?.id ?? null
  const sid = sessionId ?? activeId
  // P1: names scale with the device text setting, like every other prose.
  const theme = useTheme()
  const scaledSize = size * theme.fontScaleMultiplier
  // RN `Text` defaults to black — invisible on the dark theme. Default
  // to the themed text color; an explicit `textStyle` color still wins
  // (it sits later in the array).
  return (
    <Text
      style={[{fontSize: scaledSize, color: theme.palette.text}, textStyle]}
      numberOfLines={numberOfLines}
      testID={testID}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <NameEmoji key={i} code={part.code} emojis={account.emojis} sessionId={sid} authorHost={account.host ?? null} size={scaledSize} />
        ),
      )}
    </Text>
  )
}
