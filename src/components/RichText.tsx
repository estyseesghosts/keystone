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
// italic, strike, code, codeBlock, quote, br, plus the structural markers
// `bullet` (list items), `heading` (h1–h6, styled by level) and
// `invisible` (server-hidden spans: zero-width, never visible text).
// MFM `fn` decorations render allow-listed styles (`x2`/`x3`/`x4`,
// `size`/`scale`, `color`/`bg`, `rotate`, `font`, `small`, `center`);
// motion (`spin`, `tada`, …), `blur` and unknown functions degrade to
// their children — content is never dropped, effects never faked.

import {Fragment, useContext, useMemo} from 'react'
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'

import {DEFAULT_EMOJI_STYLE, bareLinkLabel, displayNameOf, parseAcct, plainTextOf, type Backend, type ContentNode, type EmojiStyle} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {ProfileIcon} from '#/components/icons'
import {Pressable} from '#/components/Pressable'
import {QueryClientContext} from '@tanstack/react-query'
import {useMentionedAccount} from '#/state/queries'
import {HoverPreview} from '#/components/Profile/HoverPreview'
import {useContentMode} from '#/state/appearance'
import {navigationRef} from '#/navigationRef'

export type RichTextProps = {
  nodes: readonly ContentNode[]
  /** Packed custom-emoji map for `:code:` resolution (MFM path). */
  emojis?: Record<string, string> | null
  // WS-C (remote emoji fallback, additive only — no core change): the
  // owning session id and the content author's host, threaded to
  // custom-emoji glyphs for session-scoped remote-host resolution.
  // Omit both for packed-only resolution (tests, session-less trees).
  // (WS-B owns this file's core; this prop pair is the agreed seam.)
  sessionId?: string | null
  authorHost?: string | null
  /** Unicode emoji style. Defaults to OpenMoji (device setting). */
  emojiStyle?: EmojiStyle
  /** Inline text size. Block code stays fixed. */
  size?: number
  numberOfLines?: number
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  /** Backend for mention → account resolution (avatar + display name
   * in chips). Omit where no backend is handy (bio, logged-out trees):
   * chips fall back to the handle label, never a spinner. */
  backend?: Backend | null
  /** Page titles keyed by link href: bare-link chips show the title
   * (capped) instead of the truncated URL when known. */
  linkTitles?: Record<string, string>
  /** Lone-link rule: when a post has exactly one bare link AND an embed
   * card for it, the chip degrades to plain text (the card carries the
   * action). Pass the href to hide, else null. */
  hideLoneLinkChipFor?: string | null
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  testID?: string
}

type Ctx = {
  emojis: Record<string, string> | null
  // WS-C seam (see props): session-scoped remote emoji resolution.
  sessionId: string | null
  authorHost: string | null
  emojiStyle: EmojiStyle
  size: number
  onMentionPress?: (href: string | null, label: string) => void
  onHashtagPress?: (tag: string) => void
  onLinkPress?: (href: string) => void
  backend?: Backend | null
  /** Page titles keyed by link href: bare-link chips show the title
   * (capped) instead of the truncated URL when known. */
  linkTitles?: Record<string, string>
  /** Lone-link rule: when a post has exactly one bare link AND an embed
   * card for it, the chip degrades to plain text (the card carries the
   * action). Pass the href to hide, else null. */
  hideLoneLinkChipFor?: string | null
  linkColor: string
  textColor: string
  codeBg: string
  quoteEdge: string
  /** Hairline color for inline chips (border only). */
  edge: string
  /** Set when rendering inside a centered block: every line centers. */
  align?: 'center'
}

const styles = StyleSheet.create({
  code: {fontFamily: 'monospace'},
  link: {textDecorationLine: 'underline'},
  mention: {fontWeight: '600'},
  quote: {borderLeftWidth: 2, paddingLeft: 8, marginVertical: 4},
  codeBlock: {borderRadius: 6, padding: 8, marginVertical: 4},
  // Inline chips (v1 `.mchip` parity): an atomic pill the line-box never
  // splits mid-word, so long URLs and handles wrap as a unit instead of
  // chopping across lines.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
})

function openExternal(href: string) {
  void Linking.openURL(href).catch(() => {})
}

/** Profile navigation for a mention tap (E2): the `User` screen resolves
 * an `acct` (`user` or `user@host`) through the session backend. Silent
 * no-op in provider-less trees. */
function openMentionProfile(acct: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {acct}} as never)
}

/** Tag navigation for a hashtag tap (E3): the tag route, never the
 * browser. Silent no-op in provider-less trees. */
function openTagPosts(tag: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Tag', {tag})
}

/** Best-effort account handle from a profile URL (`/@user`,
 * `/users/user` shapes — Mastodon/Misskey/Akkoma profile links).
 * Returns `user@host` (bare hostname, no port) or null. Used when the
 * mention label is not a full `user@host` handle — a bare `@user` label
 * on a remote href, or a display-name label — where the server-provided
 * URL is authoritative and the label is display text. Pure. */
export function acctFromProfileUrl(href: string | null | undefined): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const segments = url.pathname.split('/').filter(s => s.length > 0)
  let username: string | null = null
  if (segments.length >= 2 && segments[0] === 'users') username = segments[1] ?? null
  else if (segments.length >= 1 && segments[0]?.startsWith('@')) username = segments[0].slice(1)
  if (!username || !/^[\w-]+$/.test(username)) return null
  if (!url.hostname) return null
  return `${username}@${url.hostname}`
}

/** Default mention tap (E2): a full `user@host` label wins outright;
 * otherwise the server-provided profile URL names the account (a bare
 * `@user` label on a remote href, or a display-name label anywhere) —
 * the URL is authoritative, the label is display text. A bare label with
 * no URL resolves locally; only an unresolvable mention with a URL
 * leaves the app (plain links still can). */
export function defaultMentionPress(href: string | null, label: string): void {
  const ref = parseAcct(label)
  if (ref?.host) {
    openMentionProfile(`${ref.username}@${ref.host}`)
    return
  }
  const acct = acctFromProfileUrl(href)
  if (acct) {
    openMentionProfile(acct)
    return
  }
  if (ref) {
    openMentionProfile(ref.username)
    return
  }
  if (href) openExternal(href)
}

/** Default hashtag tap (E3): the Tag screen, everywhere. Hashtags never
 * open the browser — a tag is always a known in-app route. */
export function defaultHashtagPress(tag: string): void {
  openTagPosts(tag)
}

/** Visible label of a mention (`@user`, `@user@host`) for profile
 * resolution — text children concatenated, formatting transparent.
 * Structural markers contribute nothing. */
function labelOf(nodes: readonly ContentNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text
    else if (node.kind === 'br') out += '\n'
    else if ('children' in node) out += labelOf(node.children)
  }
  return out
}

// MFM decoration args (v1 `MfmRenderer` parity, real mfm-js 0.27 shapes):
// `$[name.key=value …]` string values, `$[name.value …]` flag keys
// (`{value: true}`), then any first string value. Unknown shapes degrade
// to the children — content is never dropped, never faked.
function fnArg(args: Record<string, string | true>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  for (const key of Object.keys(args)) {
    if (args[key] === true && key.length > 0) return key
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string') return value
  }
  return null
}

function clampNum(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Allow-listed MFM color: `#rgb`/`#rrggbb` only. Anything else (names,
 * functions, URLs) is rejected — never a raw server string in a style. */
function safeHexColor(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : null
}

/** Allow-listed MFM font: only families with a safe cross-platform
 * mapping render; the rest degrade to the default. */
function safeFontFamily(raw: string | null): 'monospace' | 'serif' | null {
  const name = (raw ?? '').trim().toLowerCase()
  if (name === 'monospace') return 'monospace'
  if (name === 'serif') return 'serif'
  return null
}

/** Heading size step over the body size, by level. */
function headingDelta(level: number): number {
  switch (level) {
    case 1:
      return 6
    case 2:
      return 4
    case 3:
      return 2
    case 4:
      return 1
    case 5:
      return 0
    default:
      return -1
  }
}

// One MFM `fn` decoration. Static styles render; motion (`spin`, `tada`,
// …), `blur` and unknown functions degrade to their children — the
// renderer is motion-free by design (the OS reduced-motion setting is the
// safe default, and per-node loops would cost every feed list), and RN
// has no text-blur primitive to be honest with. Content never drops.
//
// Size changes thread through the context as well as the wrapper style,
// so nested decorations compose multiplicatively (`$[x2 $[small …]]`).
function Fn({node, ctx, depth}: {node: Extract<ContentNode, {kind: 'fn'}>; ctx: Ctx; depth: number}) {
  const scaled = (size: number) => {
    const next: Ctx = {...ctx, size}
    return (
      <Text style={{fontSize: size}}>
        <Inline nodes={node.children} ctx={next} depth={depth + 1} />
      </Text>
    )
  }
  const inner = <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
  switch (node.name) {
    case 'x2':
    case 'x3':
    case 'x4': {
      const mult = node.name === 'x2' ? 2 : node.name === 'x3' ? 3 : 4
      return scaled(ctx.size * mult)
    }
    case 'size':
    case 'scale': {
      const mult = clampNum(fnArg(node.args, 'n', 'size', 'x'), 0.5, 4, 1)
      if (mult === 1) return inner
      return scaled(ctx.size * mult)
    }
    case 'small':
      return scaled(ctx.size * 0.85)
    case 'color':
    case 'colour': {
      const color = safeHexColor(fnArg(node.args, 'color', 'colour', 'c'))
      if (color === null) return inner
      return <Text style={{color}}>{inner}</Text>
    }
    case 'bg':
    case 'background': {
      const backgroundColor = safeHexColor(fnArg(node.args, 'color', 'colour', 'c'))
      if (backgroundColor === null) return inner
      return <Text style={{backgroundColor}}>{inner}</Text>
    }
    case 'rotate':
    case 'rotation': {
      const deg = clampNum(fnArg(node.args, 'deg'), -360, 360, 0)
      if (deg === 0) return inner
      return <Text style={{transform: [{rotate: `${deg}deg`}]}}>{inner}</Text>
    }
    case 'font': {
      const fontFamily = safeFontFamily(fnArg(node.args, 'name'))
      if (fontFamily === null) return inner
      return <Text style={{fontFamily}}>{inner}</Text>
    }
    case 'center':
      // Nested occurrences center best-effort; top-level `center` hoists
      // to a block in Flow so the whole paragraph centers.
      return <Text style={{textAlign: 'center'}}>{inner}</Text>
    default:
      return inner
  }
}

// Inline avatar chip for a resolvable mention (v1 parity). Resolves the
// handle to an account over the passed backend (cached per session):
// display name + photo when loaded, handle + glyph meanwhile, in
// backend-less trees, or when the lookup fails. Taps always route;
// the label (not the photo) is authoritative for the destination.
//
// Resolver trees need a QueryClient (the card usually has one; bare
// presentational/test trees do not): without one the chip renders static
// — never a hook crash, never a spinner.
function StaticMentionChip({
  name,
  avatar,
  label,
  ctx,
  onPress,
}: {
  name: string
  avatar: string | null
  label: string
  ctx: Ctx
  onPress: () => void
}) {
  return (
    <Pressable
      style={[styles.chip, {borderColor: ctx.edge}]}
      accessibilityRole="link"
      accessibilityLabel={`Open profile: ${name}`}
      testID="richtext-mention-chip"
      onPress={onPress}>
      {avatar ? (
        <Image
          source={{uri: avatar}}
          style={{width: 16, height: 16, borderRadius: 8}}
          accessibilityIgnoresInvertColors
          testID="richtext-mention-avatar"
        />
      ) : (
        <ProfileIcon size={14} color={ctx.textColor} />
      )}
      <Text style={{fontSize: ctx.size, color: ctx.textColor}} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  )
}

function ResolvingMentionChip({
  label,
  ctx,
  onPress,
}: {
  label: string
  ctx: Ctx
  onPress: () => void
}) {
  const account = useMentionedAccount(ctx.backend ?? null, ctx.sessionId, label)
  const chip = (
    <StaticMentionChip
      name={account ? displayNameOf(account) : label}
      avatar={account?.avatarUrl ?? null}
      label={label}
      ctx={ctx}
      onPress={onPress}
    />
  )
  // Hover previews the resolved account; the handle-only fallback has
  // nothing to preview (and HoverPreview no-ops on native anyway).
  if (!account) return chip
  return (
    <HoverPreview
      account={account}
      sessionId={ctx.sessionId ?? 'signed-out'}
      onOpenProfile={() => defaultMentionPress(null, label)}>
      {chip}
    </HoverPreview>
  )
}

function MentionChip({
  label,
  ctx,
  onPress,
}: {
  label: string
  ctx: Ctx
  onPress: () => void
}) {
  const qc = useContext(QueryClientContext)
  if (!qc || !ctx.backend) {
    return <StaticMentionChip name={label} avatar={null} label={label} ctx={ctx} onPress={onPress} />
  }
  return <ResolvingMentionChip label={label} ctx={ctx} onPress={onPress} />
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
                sessionId={ctx.sessionId}
                authorHost={ctx.authorHost}
                size={ctx.size + 2}
              />
            )
          case 'link': {
            const bareLabel = bareLinkLabel(node)
            if (bareLabel !== null) {
              // Lone link with its own embed card: no pill, just the
              // words (the card below carries the action).
              if (ctx.hideLoneLinkChipFor === node.href) {
                return (
                  <Text key={key} style={{color: ctx.textColor}}>
                    {bareLabel}
                  </Text>
                )
              }
              const title = ctx.linkTitles?.[node.href]
              const chipLabel =
                title && title.length > 0
                  ? title.length > 48
                    ? `${title.slice(0, 47)}…`
                    : title
                  : bareLabel
              return (
                <Pressable
                  key={key}
                  style={[styles.chip, {borderColor: ctx.edge}]}
                  accessibilityRole="link"
                  accessibilityLabel={`Open link: ${node.href}`}
                  testID="richtext-link-chip"
                  onPress={() => (ctx.onLinkPress ? ctx.onLinkPress(node.href) : openExternal(node.href))}>
                  <Text style={{fontSize: ctx.size, color: ctx.textColor}} numberOfLines={1}>
                    {chipLabel}
                  </Text>
                </Pressable>
              )
            }
            return (
              <Text
                key={key}
                style={[styles.link, {color: ctx.linkColor}]}
                accessibilityRole="link"
                onPress={() => (ctx.onLinkPress ? ctx.onLinkPress(node.href) : openExternal(node.href))}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          }
          case 'mention': {
            // Handler-less surfaces (bio, fields, notification excerpts)
            // land in-app through the defaults — never the browser, never
            // a dead tap for a resolvable mention.
            const label = labelOf(node.children)
            const pressable =
              node.href !== null ||
              ctx.onMentionPress !== undefined ||
              parseAcct(label) !== null ||
              acctFromProfileUrl(node.href) !== null
            // Resolvable mentions render as an inline avatar chip (v1
            // parity): display name + photo once the account resolves,
            // handle + glyph meanwhile or where no backend is handy.
            // Unresolvable mentions stay plain text — never a dead chip.
            if (pressable) {
              return (
                <MentionChip
                  key={key}
                  label={label}
                  ctx={ctx}
                  onPress={() =>
                    ctx.onMentionPress
                      ? ctx.onMentionPress(node.href, label)
                      : defaultMentionPress(node.href, label)
                  }
                />
              )
            }
            return (
              <Text key={key} style={styles.mention}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          }
          case 'hashtag':
            // Handler-less surfaces land on the Tag screen through the
            // default — hashtags never open the browser.
            return (
              <Text
                key={key}
                style={[styles.mention, {color: ctx.linkColor}]}
                accessibilityRole="link"
                onPress={() =>
                  ctx.onHashtagPress ? ctx.onHashtagPress(node.tag) : defaultHashtagPress(node.tag)
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
          case 'bullet':
            // List-item marker: the renderer owns the glyph so pruning can
            // never leave a stray "• " text node behind.
            return <Text key={key}>{'• '}</Text>
          case 'heading': {
            const size = ctx.size + headingDelta(node.level)
            return (
              <Text key={key} style={{fontWeight: '700', fontSize: size, lineHeight: size + 5}}>
                <Inline nodes={node.children} ctx={ctx} depth={depth + 1} />
              </Text>
            )
          }
          case 'invisible':
            // Server-hidden text: zero-width, never visible, never counted.
            // The node survives in the AST (structure, not content); the
            // renderer emits only a zero-width space so wrapping matches
            // the server without ever showing the hidden run.
            return <Fragment key={key}>{'\u200B'}</Fragment>
          case 'fn':
            return <Fn key={key} node={node} ctx={ctx} depth={depth} />
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
  if (node.kind === 'codeBlock' || node.kind === 'quote') return true
  // A top-level `center` decoration is a block (the whole paragraph
  // centers); nested occurrences stay inline best-effort.
  return node.kind === 'fn' && node.name === 'center'
}

// Top-level flow: runs of inline nodes share one <Text>; block nodes
// (codeBlock, quote, top-level center) render as block views.
function Flow({nodes, ctx}: {nodes: readonly ContentNode[]; ctx: Ctx}) {
  const parts: React.ReactNode[] = []
  let run: ContentNode[] = []
  let n = 0
  const flush = () => {
    if (run.length === 0) return
    parts.push(
      <Text
        key={`t-${n++}`}
        style={[
          {fontSize: ctx.size, lineHeight: ctx.size + 5, color: ctx.textColor},
          ctx.align === 'center' ? {textAlign: 'center' as const} : null,
        ]}>
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
    } else if (node.kind === 'fn') {
      // Top-level `center`: the whole paragraph centers (block view so
      // the alignment actually applies on every target).
      parts.push(
        <View key={`b-${n++}`}>
          <Flow nodes={node.children} ctx={{...ctx, align: 'center'}} />
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
  sessionId = null,
  authorHost = null,
  emojiStyle = DEFAULT_EMOJI_STYLE,
  size = 15,
  numberOfLines,
  onMentionPress,
  onHashtagPress,
  onLinkPress,
  backend = null,
  linkTitles,
  hideLoneLinkChipFor = null,
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
      sessionId,
      authorHost,
      emojiStyle,
      size: scaledSize,
      onMentionPress,
      onHashtagPress,
      onLinkPress,
      backend,
      linkTitles: linkTitles ?? {},
      hideLoneLinkChipFor,
      linkColor: theme.palette.text,
      textColor: theme.palette.text,
      codeBg: theme.palette.bgSoft,
      quoteEdge: theme.palette.edge,
      edge: theme.palette.edge,
    }),
    [emojis, sessionId, authorHost, emojiStyle, scaledSize, onMentionPress, onHashtagPress, onLinkPress, backend, linkTitles, hideLoneLinkChipFor, theme],
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
