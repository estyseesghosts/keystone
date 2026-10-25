// Quote-target resolution for PostCardView (D3.6 decomposition).
// Verbatim move of the quote-resolution block out of `PostCard.tsx`
// (no behavior change): the normalized target (packed renote/quote,
// Pinetree ext, or the MFM textual fallback), the async URI lookup,
// the conceal gate, and the covered-URI set the body uses to strip
// duplicated markers. Dependencies arrive as arguments; session-id
// threading stays at the JSX call sites (R2.4). This hook returns
// data — the view still renders. No JSX here.

import {useEffect, useMemo, useRef, useState, type ComponentProps} from 'react'

import {
  contentFromHtml,
  findTextualQuoteMarker,
  getQuoteTarget,
  statusLabelFor,
  structuredUrisOf,
  type EmojiStyle,
  type Media,
  type Post,
} from '@keystone/fedi'

import {useOnlyAuthorizedQuotes} from '#/state/appearance'

import type {PostQuote} from './PostQuote'

export type QuoteTargetState = {
  visibleQuote: Post | null
  resolvingQuote: boolean
  structuredQuoteUnavailable: boolean
  quoteStatus: string | null
  quoteConcealed: boolean
  setQuoteRevealed: React.Dispatch<React.SetStateAction<boolean>>
  coveredQuoteUris: string[]
}

export function useQuoteTarget(
  effective: Post,
  resolveQuoteUri: ((uri: string) => Promise<Post | null>) | undefined,
  onlyAuthorizedQuotes: boolean | undefined,
  seedSeenQuote?: (note: Post) => void,
  resolveQuoteById?: ((id: string) => Promise<Post | null>) | undefined,
): QuoteTargetState {
  // --- Quote cards: structured + textual/URI fallback (WS-A) --------
  // The normalized target (packed renote/quote, Pinetree ext, or the
  // MFM textual fallback). Authorization status is display metadata
  // only — never a render filter by itself (the device opt-in below is
  // the only gate, and it defaults to showing everything).
  const quoteTarget = useMemo(() => getQuoteTarget(effective), [effective])
  // Server-HTML posts carry no MFM for `getQuoteTarget`: their textual
  // marker (an `RE:` line or a bare quote-URL anchor) is read off the
  // AST. Never consulted when a structured relationship exists — it wins.
  const htmlQuoteMarkerUri = useMemo(() => {
    if (quoteTarget?.source === 'structured' || !effective.content.html) return null
    return findTextualQuoteMarker(contentFromHtml(effective.content.html))?.uri ?? null
  }, [quoteTarget, effective])
  // The URI needing a lookup: a structured URI-only target with no
  // packed note and no local id, or a textual marker. Never fetched
  // when the server flagged the target unavailable (never chase
  // protected URIs) or when no resolver is wired (presentational).
  const pendingQuoteUri = useMemo(() => {
    if (resolveQuoteUri === undefined) return null
    if (effective.quote !== null) return null
    const target = quoteTarget
    if (target && target.uri && !target.targetUnavailable) {
      if (target.source === 'structured' && target.noteId) return null
      return target.uri
    }
    if (!target && htmlQuoteMarkerUri) return htmlQuoteMarkerUri
    return null
  }, [resolveQuoteUri, effective.quote, quoteTarget, htmlQuoteMarkerUri])
  // The id needing a lookup: a Mastodon 4.5+ shallow nested quote
  // (`ext.quoteRef`) with no packed note and no URI — repair X4.4
  // finding 15. Keyed on the adapter's `quoteRef`, never on a bare
  // `renoteId`: an unpacked renote keeps its v1-parity "known locally,
  // no fetch" unavailable fallback. Never fetched when the server
  // flagged the target unavailable or when no by-id resolver is wired.
  const pendingQuoteId = useMemo(() => {
    if (resolveQuoteById === undefined) return null
    if (effective.quote !== null) return null
    const ref =
      typeof effective.ext.quoteRef === 'string' && effective.ext.quoteRef.length > 0
        ? effective.ext.quoteRef
        : null
    if (ref === null) return null
    const target = quoteTarget
    if (target && (target.targetUnavailable || target.uri)) return null
    return ref
  }, [resolveQuoteById, effective.quote, effective.ext.quoteRef, quoteTarget])
  // Lookup state: one resolution per URI. A finished miss never retries
  // implicitly (the backend owns its TTL); the fallback keeps the
  // original text or the honest unavailable state below.
  const [resolvedQuote, setResolvedQuote] = useState<Post | null>(null)
  const [quoteLookupFailed, setQuoteLookupFailed] = useState(false)
  const resolveRef = useRef(resolveQuoteUri)
  resolveRef.current = resolveQuoteUri
  useEffect(() => {
    setResolvedQuote(null)
    setQuoteLookupFailed(false)
    const uri = pendingQuoteUri
    const fetch = resolveRef.current
    if (uri === null || fetch === undefined) return
    let cancelled = false
    void fetch(uri).then(
      found => {
        if (cancelled) return
        setResolvedQuote(found)
        setQuoteLookupFailed(found === null)
      },
      () => {
        if (!cancelled) setQuoteLookupFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pendingQuoteUri])
  // By-id lookup state: one resolution per id, same once-per-target
  // discipline as the URI path (a finished miss shows the honest
  // unavailable fallback, never a retry loop).
  const [resolvedQuoteById, setResolvedQuoteById] = useState<Post | null>(null)
  const [quoteIdLookupFailed, setQuoteIdLookupFailed] = useState(false)
  const resolveIdRef = useRef(resolveQuoteById)
  resolveIdRef.current = resolveQuoteById
  useEffect(() => {
    setResolvedQuoteById(null)
    setQuoteIdLookupFailed(false)
    const id = pendingQuoteId
    const fetch = resolveIdRef.current
    if (id === null || fetch === undefined) return
    let cancelled = false
    void fetch(id).then(
      found => {
        if (cancelled) return
        setResolvedQuoteById(found)
        setQuoteIdLookupFailed(found === null)
      },
      () => {
        if (!cancelled) setQuoteIdLookupFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pendingQuoteId])
  // Seen re-seeding (R2.4/D3.6 restoration of the R1.2-removed
  // `registerSeenNote` effect, now session-scoped — the seeding effect
  // below runs after the conceal gate): rendered notes reseed the owning
  // backend's own quote cache, so a later textual fallback for the same
  // URI hits the seen set instead of firing `ap/show`. Seeding writes
  // only through the injected `seedSeenQuote` — one backend, one
  // session — so account B can never observe account A's seeded notes.
  // The card's target: the packed quote, or a URI/id that resolved to a
  // post. Anything else falls through to the resolving indicator or the
  // unavailable fallback below.
  const visibleQuote =
    effective.quote ??
    (pendingQuoteUri !== null ? resolvedQuote : null) ??
    (pendingQuoteId !== null ? resolvedQuoteById : null)
  const resolvingQuote =
    (pendingQuoteUri !== null && resolvedQuote === null && !quoteLookupFailed) ||
    (pendingQuoteId !== null && resolvedQuoteById === null && !quoteIdLookupFailed)
  // Stable fallback for a structured relationship with no viewable
  // target (v1 parity): a renote id with no packed note (the server
  // knows it locally — no fetch), or a URI/id lookup that finished with
  // no post. Textual fallbacks never reach here — a failed lookup
  // keeps the original `RE:` text.
  const structuredQuoteUnavailable =
    quoteTarget?.source === 'structured' &&
    effective.quote === null &&
    (pendingQuoteUri !== null
      ? resolvedQuote === null && quoteLookupFailed
      : pendingQuoteId !== null
        ? resolvedQuoteById === null && quoteIdLookupFailed
        : quoteTarget.noteId != null)
  // Quote-authorization display label for the wrapper's relationship
  // (pending/rejected/…); approved or missing never labels.
  const quoteStatus = useMemo(
    () =>
      quoteTarget?.authorizationStatus
        ? statusLabelFor(quoteTarget.authorizationStatus)
        : null,
    [quoteTarget],
  )
  // Device opt-in gate (default OFF — show everything): an
  // unauthorized card hides behind a tap-to-reveal row until the viewer
  // opts in. The body marker stays visible while concealed.
  const storeOnlyAuthorized = useOnlyAuthorizedQuotes()
  const onlyAuthorized = onlyAuthorizedQuotes ?? storeOnlyAuthorized
  const quoteUnauthorized = quoteStatus !== null
  const [quoteRevealed, setQuoteRevealed] = useState(false)
  useEffect(() => {
    setQuoteRevealed(false)
  }, [effective.id])
  const quoteConcealed =
    onlyAuthorized &&
    quoteUnauthorized &&
    (visibleQuote !== null || structuredQuoteUnavailable || effective.quoteUnavailable) &&
    !quoteRevealed
  // Body markers strip only when their card (or its honest unavailable
  // fallback) renders — otherwise the `RE:` text stays visible.
  const coveredQuoteUris = useMemo(() => {
    const out: string[] = []
    if (quoteConcealed) return out
    if (visibleQuote === null && !structuredQuoteUnavailable && !effective.quoteUnavailable) {
      return out
    }
    const push = (uri: string | null | undefined) => {
      if (uri && !out.includes(uri)) out.push(uri)
    }
    for (const uri of structuredUrisOf(effective)) push(uri)
    push(quoteTarget?.uri)
    if (visibleQuote !== null) {
      push(visibleQuote.uri)
      push(visibleQuote.url)
    }
    if (htmlQuoteMarkerUri !== null && visibleQuote !== null) push(htmlQuoteMarkerUri)
    return out
  }, [
    quoteConcealed,
    visibleQuote,
    structuredQuoteUnavailable,
    effective,
    quoteTarget,
    htmlQuoteMarkerUri,
  ])
  // Seen re-seeding effect (R2.4/D3.6): rendered notes reseed the owning
  // backend's own quote cache, so a later textual fallback for the same
  // URI hits the seen set instead of firing `ap/show`. Writes go only
  // through the injected `seedSeenQuote` — one backend, one session — so
  // account B can never observe account A's seeded notes. Visibility
  // stays same-or-stricter: the outer card always renders, so `effective`
  // seeds; the quote card seeds only when it renders — a concealed card
  // (device opt-in hiding an unauthorized quote) is not seen. A packed
  // quote's `renote`/`quote` are the same adapted object, so the identity
  // guard seeds it once via `visibleQuote`, never through the gate.
  const seedRef = useRef(seedSeenQuote)
  seedRef.current = seedSeenQuote
  useEffect(() => {
    const seed = seedRef.current
    if (seed === undefined) return
    seed(effective)
    if (effective.renote !== null && effective.renote !== effective.quote) {
      seed(effective.renote)
    }
    if (!quoteConcealed && visibleQuote !== null) seed(visibleQuote)
  }, [effective, visibleQuote, quoteConcealed])
  return {
    visibleQuote,
    resolvingQuote,
    structuredQuoteUnavailable,
    quoteStatus,
    quoteConcealed,
    setQuoteRevealed,
    coveredQuoteUris,
  }
}

// Shared props for the PostCard quote card (D3.6, optional same-slice).
// The three former `PostQuote` call sites (concealed / visible /
// unavailable) were mutually exclusive branches over the same state;
// this pure helper picks the winner with the same guards, verbatim
// priority, so which quote wins cannot change. Returns the full props
// for one `<PostQuote>`, or null when no card renders. The view still
// renders — no JSX here.
export function quoteCardProps(args: {
  postId: string
  sessionId: string
  emojiStyle: EmojiStyle
  visibleQuote: Post | null
  structuredQuoteUnavailable: boolean
  quoteUnavailable: boolean
  quoteConcealed: boolean
  quoteStatus: string | null
  onReveal: () => void
  onPress: (post: Post) => void
  onOpenMedia: (items: Media[], index: number) => void
  onMentionPress: (href: string | null, label: string) => void
  onHashtagPress: (tag: string) => void
  onLinkPress: (href: string) => void
}): ComponentProps<typeof PostQuote> | null {
  const {
    postId,
    sessionId,
    emojiStyle,
    visibleQuote,
    structuredQuoteUnavailable,
    quoteUnavailable,
    quoteConcealed,
    quoteStatus,
    onReveal,
    onPress,
    onOpenMedia,
    onMentionPress,
    onHashtagPress,
    onLinkPress,
  } = args
  const testID = `post-quote-${postId}`
  if (quoteConcealed && (visibleQuote !== null || structuredQuoteUnavailable || quoteUnavailable)) {
    return {
      quote: null,
      unavailable: false,
      status: quoteStatus,
      concealed: true,
      onReveal,
      emojiStyle,
      onMentionPress,
      onHashtagPress,
      onLinkPress,
      testID,
    }
  }
  if (!quoteConcealed && visibleQuote !== null) {
    return {
      quote: visibleQuote,
      unavailable: false,
      status: quoteStatus,
      sessionId,
      emojiStyle,
      onPress,
      onOpenMedia,
      onMentionPress,
      onHashtagPress,
      onLinkPress,
      testID,
    }
  }
  if (!quoteConcealed && visibleQuote === null && (quoteUnavailable || structuredQuoteUnavailable)) {
    return {
      quote: null,
      unavailable: true,
      status: quoteStatus,
      sessionId,
      emojiStyle,
      onMentionPress,
      onHashtagPress,
      onLinkPress,
      testID,
    }
  }
  return null
}
