// The SOLE content renderer (slices 3.3 + 3.9).
//
// Every post body, bio, CW-adjacent snippet, quote card, and reaction
// label renders through this component on all three targets. Input is
// ALWAYS the allow-listed AST from `@keystone/fedi` (`contentFromMfm` /
// `contentFromHtml`) — never a raw server string. No `innerHTML`, no
// WebView.
//
// Node coverage: text, link, mention, hashtag, customEmoji (packed
// sources only), unicodeEmoji (OpenMoji by default), bold,
// italic, strike, code, codeBlock, quote, br. MFM `fn` extras degrade
// to their children.

import {Fragment, useMemo} from 'react'
import {
  Linking,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'

import {DEFAULT_EMOJI_STYLE, plainTextOf, type ContentNode, type EmojiStyle} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {useContentMode} from '#/state/appearance'

export type RichTextProps = {
  nodes: readonly ContentNode[]
  /** Packed custom-emoji map for `:code:` resolution (MFM path). */
  emojis?: Record<string, string> | null
  /** Unicode emoji style. Defaults to OpenMoji (device setting). */
  emojiStyle?: EmojiStyle
  /** Inline text size. Block code stays fixed. */
  size?: number
  numberOfLines?: number
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  testID?: string
}

type Ctx = {
  emojis: Record<string, string> | null
  emojiStyle: EmojiStyle
  size: number
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  linkColor: string
  textColor: string
  codeBg: string
  quoteEdge: string
}

const styles = StyleSheet.create({
  code: {fontFamily: 'monospace'},
  link: {textDecorationLine: 'underline'},
  mention: {fontWeight: '600'},
  quote: {borderLeftWidth: 2, paddingLeft: 8, marginVertical: 4},
  codeBlock: {borderRadius: 6, padding: 8, marginVertical: 4},
})

function openExternal(href: string) {
  void Linking.openURL(href).catch(() => {})
}

/** Visible label of a mention (`@user`, `@user@host`) for profile
 * resolution — text children concatenated, formatting transparent. */
function labelOf(nodes: readonly ContentNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text
    else if (node.kind === 'br') out += '\n'
    else if ('children' in node) out += labelOf(node.children)
  }
  return out
}

// Inline nodes inside a parent <Text>. Block nodes (codeBlock, quote)
// never appear here — the flow splitter hoists them out.
function Inline({nodes, ctx, depth}: {nodes: readonly ContentNode[]; ctx: Ctx; depth: number}) {
  return (
    <>
      {nodes.map((node, i) => {
        const key = `${depth}-${i}`
        switch (node.kind) {
          // Leaf text renders as a bare fragment (not a nested <Text>)
          // so each visible string owns exactly one host Text ancestor.
          case 'text':
            return <Fragment key={key}>{node.text}</Fragment>
          case 'br':
            return <Fragment key={key}>{'\n'}</Fragment>
          case 'unicodeEmoji':
            return <UnicodeEmoji key={key} sequence={node.emoji} style={ctx.emojiStyle} size={ctx.size} />
          case 'customEmoji':
            return (
              <CustomEmojiGlyph
                key={key}
                name={node.name}
                host={node.host}
                src={node.src}
                packed={ctx.emojis}
                size={ctx.size + 2}
              />
            )
          case 'link':
            return (
              <Text
                key={key}
                style={[styles.link, {color: ctx.linkColor}]}
                accessibilityRole="link"
                onPress={() => (ctx.onLinkPress ? ctx.onLinkPress(node.href) : openExternal(node.href))}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          case 'mention': {
            const pressable = node.href !== null || ctx.onMentionPress !== undefined
            return (
              <Text
                key={key}
                style={[styles.mention, pressable && {color: ctx.linkColor}]}
                accessibilityRole={pressable ? 'link' : undefined}
                onPress={
                  pressable
                    ? () =>
                        ctx.onMentionPress
                          ? ctx.onMentionPress(node.href, labelOf(node.children))
                          : node.href && openExternal(node.href)
                    : undefined
                }>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          }
          case 'hashtag':
            return (
              <Text
                key={key}
                style={[styles.mention, {color: ctx.linkColor}]}
                accessibilityRole="link"
                onPress={() =>
                  ctx.onHashtagPress ? ctx.onHashtagPress(node.tag) : node.href && openExternal(node.href)
                }>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          case 'bold':
            return (
              <Text key={key} style={{fontWeight: '700'}}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          case 'italic':
            return (
              <Text key={key} style={{fontStyle: 'italic'}}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          case 'strike':
            return (
              <Text key={key} style={{textDecorationLine: 'line-through'}}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          case 'code':
            return (
              <Text key={key} style={[styles.code, {backgroundColor: ctx.codeBg, fontSize: ctx.size}]}>
                {node.code}
              </Text>
            )
          case 'fn':
            // MFM extras degrade to their children. Never interpreted.
            return <Inline key={key} nodes={node.children} ctx={ctx} depth={depth + 1} />
          case 'codeBlock':
          case 'quote':
            // Block nodes are hoisted by Flow; reaching here means a
            // container nested them inline — render their text content.
            return (
              <Text key={key} style={{color: ctx.textColor}}>
                <Inline
                  nodes={node.kind === 'quote' ? node.children : [{kind: 'text', text: node.code}]}
                  ctx={ctx}
                  depth={depth + 1}
                />
              </Text>
            )
        }
      })}
    </>
  )
}

function isBlock(node: ContentNode): boolean {
  return node.kind === 'codeBlock' || node.kind === 'quote'
}

// Top-level flow: runs of inline nodes share one <Text>; block nodes
// (codeBlock, quote) render as block views.
function Flow({nodes, ctx}: {nodes: readonly ContentNode[]; ctx: Ctx}) {
  const parts: React.ReactNode[] = []
  let run: ContentNode[] = []
  let n = 0
  const flush = () => {
    if (run.length === 0) return
    parts.push(
      <Text key={`t-${n++}`} style={{fontSize: ctx.size, lineHeight: ctx.size + 5, color: ctx.textColor}}>
        <Inline nodes={run} ctx={ctx} depth={n} />
      </Text>,
    )
    run = []
  }
  for (const node of nodes) {
    if (!isBlock(node)) {
      run.push(node)
      continue
    }
    flush()
    if (node.kind === 'codeBlock') {
      parts.push(
        <View key={`b-${n++}`} style={[styles.codeBlock, {backgroundColor: ctx.codeBg}]}>
          <Text style={[styles.code, {fontSize: ctx.size - 1, color: ctx.textColor}]}>{node.code}</Text>
        </View>,
      )
    } else if (node.kind === 'quote') {
      parts.push(
        <View key={`b-${n++}`} style={[styles.quote, {borderLeftColor: ctx.quoteEdge}]}>
          <Flow nodes={node.children} ctx={ctx} />
        </View>,
      )
    }
  }
  flush()
  return <>{parts}</>
}

export function RichText({
  nodes,
  emojis = null,
  emojiStyle = DEFAULT_EMOJI_STYLE,
  size = 15,
  numberOfLines,
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  style,
  textStyle,
  testID,
}: RichTextProps) {
  const theme = useTheme()
  // P1: prose scales with the device text setting — the one alf source
  // (`fontScaleMultiplier`) reaches every post body, bio, quote and CW
  // rendered through this sole renderer.
  const scaledSize = size * theme.fontScaleMultiplier
  // P3: the `plain` content mode renders the plain-text projection instead
  // of the rich tree (one mode per string, never both).
  const contentMode = useContentMode()
  const ctx: Ctx = useMemo(
    () => ({
      emojis,
      emojiStyle,
      size: scaledSize,
      onMentionPress,
      onHashtagPress,
      onLinkPress,
      linkColor: theme.palette.text,
      textColor: theme.palette.text,
      codeBg: theme.palette.bgSoft,
      quoteEdge: theme.palette.edge,
    }),
    [emojis, emojiStyle, scaledSize, onMentionPress, onHashtagPress, onLinkPress, theme],
  )
  if (contentMode === 'plain') {
    return (
      <View style={style} testID={testID}>
        <Text
          numberOfLines={numberOfLines}
          style={[
            {fontSize: scaledSize, lineHeight: scaledSize + 5, color: theme.palette.text},
            textStyle,
          ]}>
          {plainTextOf(nodes)}
        </Text>
      </View>
    )
  }
  const hasBlock = useMemo(() => nodes.some(isBlock), [nodes])
  if (!hasBlock) {
    return (
      <View style={style} testID={testID}>
        <Text
          numberOfLines={numberOfLines}
          style={[{fontSize: scaledSize, lineHeight: scaledSize + 5, color: theme.palette.text}, textStyle]}>
          <Inline nodes={nodes} ctx={ctx} depth={0} />
        </Text>
      </View>
    )
  }
  return (
    <View style={style} testID={testID}>
      <Flow nodes={nodes} ctx={ctx} />
    </View>
  )
}
