// Server link-card preview (v1 `LinkCard` parity, F12) + honest client
// unfurl (E9, reverses the W2 decline).
//
// Renders the server-vetted card (`post.card`, Mastodon-family): title,
// description, and image over the linked URL. An unsafe card URL renders
// nothing — a preview without a safe link is never shown.
//
// Posts with a bare URL and NO server card get `UnfurledLinkCard` instead:
// an explicit tap-to-unfurl trigger (never an automatic per-post fetch)
// that resolves through `api/linkpreview` — single-flight per URL plus a
// memory cache, so a feed of identical links costs one fetch. A fetch that
// fails (CORS, offline, no tags) keeps the honest basic domain card.
import {useEffect, useRef, useState} from 'react'
import {Image, Linking, StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {
  fetchLinkPreview,
  safeHttpUrl,
  urisMatch,
  type ContentNode,
  type LinkCard as LinkCardModel,
  type LinkPreview,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {showToast} from '#/lib/toast'

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 10, marginTop: 8, overflow: 'hidden', gap: 0},
  image: {width: '100%', aspectRatio: 16 / 9},
  body: {padding: 10, gap: 2},
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    gap: 8,
  },
  previewButton: {borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6},
  siteRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  icon: {width: 16, height: 16, borderRadius: 3},
})

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function LinkCard({card, testID}: {card: LinkCardModel; testID?: string}) {
  const theme = useTheme()
  const [imageFailed, setImageFailed] = useState(false)
  const url = safeHttpUrl(card.url)
  if (url === null) return null
  const imageUrl = safeHttpUrl(card.image)
  return (
    <Pressable
      testID={testID}
      onPress={() => void Linking.openURL(url).catch(e => showToast(`Could not open: ${String(e)}`))}
      accessibilityRole="link"
      accessibilityLabel={`Open link: ${card.title || url}`}>
      <View
        style={[styles.card, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]}
        testID={testID ? `${testID}-card` : undefined}>
        {imageUrl !== null && !imageFailed ? (
          <Image
            source={{uri: imageUrl}}
            style={styles.image}
            accessibilityRole="image"
            accessibilityLabel={card.title || url}
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <View style={styles.body}>
          {card.title ? <Body numberOfLines={2}>{card.title}</Body> : null}
          {card.description ? (
            <Caption color="muted" numberOfLines={2}>
              {card.description}
            </Caption>
          ) : null}
          <Caption color="faint" numberOfLines={1}>
            {card.providerName || hostOf(url)}
          </Caption>
        </View>
      </View>
    </Pressable>
  )
}

/** First bare URL in rendered body nodes (v1 `NoteBody.cardUrls` parity,
// minus profile cards): a `link` whose only child is its own href text.
// Quote-covered URIs never qualify — the quote card already covers them.
// Pure; the PostCard trigger is its only caller. */
export function firstBareUrl(
  nodes: readonly ContentNode[],
  skip?: readonly string[],
): string | null {
  const skipped = skip ?? []
  let found: string | null = null
  const walk = (list: readonly ContentNode[]): void => {
    for (const node of list) {
      if (found !== null) return
      if (node.kind === 'link') {
        const bare =
          node.children.length === 1 &&
          node.children[0].kind === 'text' &&
          node.children[0].text === node.href
        if (
          bare &&
          safeHttpUrl(node.href) !== null &&
          !skipped.some(uri => urisMatch(uri, node.href))
        ) {
          found = node.href
        }
        continue
      }
      // Mentions/hashtags never source a card (their children are labels,
      // not URLs); code blocks are opaque.
      if (node.kind === 'mention' || node.kind === 'hashtag' || node.kind === 'code') continue
      if (node.kind === 'codeBlock' || node.kind === 'customEmoji') continue
      if ('children' in node) walk(node.children)
    }
  }
  walk(nodes)
  return found
}

/** Honest client unfurl (E9): a post with a bare URL and no server card
 * shows the basic domain card plus an explicit "Preview" trigger. Tapping
 * fetches once through `api/linkpreview` (single-flight + cached per
 * URL); the unfurled title ± image then renders in place. Fetch failure
 * keeps the basic card — never an error, never a retry loop. */
export function UnfurledLinkCard({
  url,
  testID,
  fetchPreview = fetchLinkPreview,
  auto = false,
}: {
  url: string
  testID?: string
  fetchPreview?: (pageUrl: string) => Promise<LinkPreview | null>
  /** Data-saver off: fetch on mount instead of waiting for the trigger. */
  auto?: boolean
}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const [imageFailed, setImageFailed] = useState(false)
  const [iconFailed, setIconFailed] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const mounted = useRef(true)
  const autoStarted = useRef(false)
  const safe = safeHttpUrl(url)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  // A new URL is a new card: back to the un-triggered state.
  useEffect(() => {
    setPhase('idle')
    setPreview(null)
    setImageFailed(false)
    setIconFailed(false)
    autoStarted.current = false
  }, [url])
  // Auto-load (data saver off): fetch on mount. Single-flight + module
  // cache keep a feed of identical links to one fetch.
  useEffect(() => {
    if (!auto || safe === null || autoStarted.current) return
    autoStarted.current = true
    setPhase('loading')
    void fetchPreview(safe).then(
      found => {
        if (!mounted.current) return
        setPreview(found)
        setPhase('done')
      },
      () => {
        if (mounted.current) setPhase('done')
      },
    )
  }, [auto, safe, fetchPreview])

  if (safe === null) return null

  const unfurl = () => {
    if (phase !== 'idle') return
    setPhase('loading')
    void fetchPreview(safe).then(
      found => {
        if (!mounted.current) return
        setPreview(found)
        setPhase('done')
      },
      () => {
        // Failure is silent by design: the basic card below stays, no
        // header, no toast. Keep the mark so a failure never retries
        // itself into a loop.
        if (mounted.current) setPhase('done')
      },
    )
  }

  const open = () =>
    void Linking.openURL(safe).catch(e => showToast(`Could not open: ${String(e)}`))

  const previewImage = preview?.image ? safeHttpUrl(preview.image) : null
  const shownImage = previewImage !== null && !imageFailed ? previewImage : null
  const previewIcon = preview?.icon ? safeHttpUrl(preview.icon) : null
  const shownIcon = previewIcon !== null && !iconFailed ? previewIcon : null

  return (
    <View
      style={[styles.card, {borderColor: theme.palette.edge, backgroundColor: theme.palette.bg}]}
      testID={testID}>
      <Pressable
        testID={testID ? `${testID}-open` : undefined}
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={`Open link: ${preview?.title || safe}`}>
        {shownImage !== null ? (
          <Image
            source={{uri: shownImage}}
            style={styles.image}
            accessibilityRole="image"
            accessibilityLabel={preview?.title || safe}
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <View style={styles.body}>
          {preview?.title ? <Body numberOfLines={2}>{preview.title}</Body> : null}
          {phase === 'done' && preview?.description ? (
            <Caption color="muted" numberOfLines={2}>
              {preview.description}
            </Caption>
          ) : null}
          <View style={styles.siteRow}>
            {shownIcon !== null ? (
              <Image
                source={{uri: shownIcon}}
                style={styles.icon}
                accessibilityRole="image"
                onError={() => setIconFailed(true)}
              />
            ) : null}
            <Caption color="faint" numberOfLines={1}>
              {preview?.siteName || hostOf(safe)}
            </Caption>
          </View>
        </View>
      </Pressable>
      {phase === 'idle' ? (
        <View style={styles.previewRow}>
          <Caption color="muted" numberOfLines={1}>
            {safe}
          </Caption>
          <Pressable
            testID={testID ? `${testID}-preview` : undefined}
            onPress={unfurl}
            accessibilityRole="button"
            accessibilityLabel={i18n._(msg`Preview link`)}>
            <View style={[styles.previewButton, {borderColor: theme.palette.borderStrong}]}>
              <Caption>{i18n._(msg`Preview`)}</Caption>
            </View>
          </Pressable>
        </View>
      ) : null}
      {phase === 'loading' ? (
        <View style={styles.previewRow} testID={testID ? `${testID}-loading` : undefined}>
          <Caption color="muted">{i18n._(msg`Loading preview…`)}</Caption>
        </View>
      ) : null}
    </View>
  )
}
