// Display name with custom-emoji codes rendered as glyphs (F11).
//
// Names like `Ann :blobcat:` or `Ann :wave@remote:` render the emoji
// inline via the account's packed map; unknown codes stay literal —
// never a fabricated image. Unicode emoji in names render in the
// system font (no per-grapheme Twemoji pass on names).
import {Fragment, useMemo} from 'react'
import {Text, type StyleProp, type TextStyle} from 'react-native'

import {splitNameEmojis, type Account} from '@keystone/fedi'

import {CustomEmojiGlyph} from '#/components/EmojiImage'

function splitCode(code: string): {name: string; host: string | null} {
  const inner = code.replace(/^:|:$/g, '')
  const at = inner.indexOf('@')
  if (at < 0) return {name: inner, host: null}
  return {name: inner.slice(0, at), host: inner.slice(at + 1) || null}
}

function NameEmoji({
  code,
  emojis,
  size,
}: {
  code: string
  emojis: Record<string, string>
  size: number
}) {
  const {name, host} = splitCode(code)
  return <CustomEmojiGlyph name={name} host={host} src={null} packed={emojis} size={size + 2} />
}

export function DisplayName({
  account,
  size = 15,
  textStyle,
  numberOfLines = 1,
  testID,
}: {
  account: Pick<Account, 'displayName' | 'emojis'>
  size?: number
  textStyle?: StyleProp<TextStyle>
  numberOfLines?: number
  testID?: string
}) {
  const parts = useMemo(() => splitNameEmojis(account.displayName), [account.displayName])
  return (
    <Text style={[{fontSize: size}, textStyle]} numberOfLines={numberOfLines} testID={testID}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <NameEmoji key={i} code={part.code} emojis={account.emojis} size={size} />
        ),
      )}
    </Text>
  )
}
