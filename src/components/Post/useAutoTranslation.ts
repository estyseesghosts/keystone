// Auto-translation for PostCardView (D3.6 decomposition).
// Verbatim move of the auto-translate block out of `PostCard.tsx`
// (no behavior change): fetch-once-per-post, same-language and
// tag/link-only skips, the 403 circuit breaker, the v1 display policy,
// and the translated-nodes derivation. Dependencies arrive as
// arguments (`fullNodes` is computed by the view from the quote hook's
// `coveredQuoteUris`; `liveTranslation` is the manual menu row, which
// wins). This hook returns data — the view still renders. No JSX here.

import {useEffect, useMemo, useRef, useState} from 'react'

import {
  contentFromTranslatedText,
  hasTranslatableNodes,
  httpStatusOf,
  originalTagsOf,
  type ContentNode,
  type Post,
  type Translation,
} from '@keystone/fedi'

import {decideTranslation, isSameLanguagePost} from './translationPolicy'
import {isTranslateBlocked, recordTranslateOutcome} from './translationBreaker'

/** Structural mirror of `TranslationSource` (which stays exported from
 * `PostCard.tsx` so existing test imports keep working). */
export type AutoTranslationSource = {
  supported: boolean
  targetLang: string
  fetch: (id: string, targetLang: string) => Promise<Translation>
  sourceLang?: string | null
}

export type AutoTranslationState = {
  shownTranslation: {sourceLang: string | null; text: string} | null
  showingTranslation: boolean
  translatedNodes: ContentNode[] | null
  showOriginal: boolean
  setShowOriginal: React.Dispatch<React.SetStateAction<boolean>>
}

export function useAutoTranslation(args: {
  effective: Post
  fullNodes: ContentNode[]
  translationSource: AutoTranslationSource | null | undefined
  sessionId: string
  bodyHidden: boolean
  liveTranslation: Translation | null
}): AutoTranslationState {
  const {effective, fullNodes, translationSource, sessionId, bodyHidden, liveTranslation} = args
  // Auto-translate (v1): on mount, when the capability is supported and
  // the post has text, fetch once and render the translation INSTEAD of
  // the body with a `Translated from XX` header above it. Unsupported
  // capability, empty text, a known same-language source, a
  // tag/link-only body, or fetch failure = original body, no header,
  // silently. Skips matter because the endpoint is server-side and
  // UNSCOPED (the credential rides the request — tokens can't be excluded
  // request-side), so a skipped fetch is the only saving. The manual menu
  // row writes `live.translation`, which wins over this; both results
  // share the render discard below.
  const [autoTranslation, setAutoTranslation] = useState<Translation | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  // Post ids already requested: one request per post, no refetch loops
  // (CW toggles and rerenders never re-fire). Reset when the post turns
  // over. Unmount cancels the in-flight update, never the request.
  const requestedFor = useRef<string | null>(null)
  useEffect(() => {
    setAutoTranslation(null)
    setShowOriginal(false)
    requestedFor.current = null
  }, [effective.id])
  const srcSupported = translationSource?.supported ?? false
  const srcLang = translationSource?.targetLang ?? 'en'
  const srcFetch = translationSource?.fetch
  // The injector's known post source language, when it has one (the
  // `Post` model itself carries no language metadata — Mastodon's wire
  // `language` never crosses the adapter — so live cards leave this
  // unknown and rely on the render discard instead).
  const srcKnownLang = translationSource?.sourceLang ?? null
  // Parsed-body translatability for the tag/link-only skip below.
  const bodyTranslatable = useMemo(() => hasTranslatableNodes(fullNodes), [fullNodes])
  useEffect(() => {
    if (!srcSupported || srcFetch === undefined) return
    // 403 circuit breaker: a session whose endpoint refuses translation
    // stops auto-fetching — original body, silently, exactly like any
    // other auto failure. Manual translate never consults this.
    if (isTranslateBlocked(sessionId)) return
    if (bodyHidden) return
    // Repair X2.5: private posts (direct/followers — `specified` maps to
    // `direct` at the model layer) never auto-translate: the endpoint is
    // server-side and unscoped, so a skipped fetch is the only saving.
    // Manual translate (the menu row) stays available on demand.
    if (effective.visibility.kind === 'direct' || effective.visibility.kind === 'followers') return
    if (effective.content.plain.trim() === '') return
    // Same-language skip: the post is already in the viewer's language,
    // so the server would echo it back — over an unscoped request (see
    // above), so don't send it. Unknown source language always fetches.
    if (srcKnownLang != null && isSameLanguagePost(srcKnownLang, srcLang)) return
    // Tag/link-only skip: no prose to translate into (same unscoped-cost
    // note). Manual translate stays available on demand.
    if (!bodyTranslatable) return
    if (requestedFor.current === effective.id) return
    requestedFor.current = effective.id
    let cancelled = false
    void srcFetch(effective.id, srcLang).then(
      tr => {
        // Success carries no HTTP status: record null (any non-403
        // completion resets the 403 streak).
        recordTranslateOutcome(sessionId, null)
        if (!cancelled) setAutoTranslation(tr)
      },
      e => {
        // Failure is silent by design: the original body stays, no
        // header, no toast. Keep the mark so a failure never retries
        // itself into a loop. The outcome still feeds the breaker —
        // `httpStatusOf` reads the real error shape (`ApiError.status`,
        // mirrored in `params.status`): 403 counts toward the block,
        // anything else (429/5xx/timeout/unknown) resets the streak.
        recordTranslateOutcome(sessionId, httpStatusOf(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [
    effective.id,
    effective.content.plain,
    effective.visibility.kind,
    sessionId,
    srcSupported,
    srcLang,
    srcFetch,
    srcKnownLang,
    bodyTranslatable,
    bodyHidden,
  ])
  const rawTranslation = liveTranslation ?? autoTranslation
  // v1 display policy: a same-text "translation" (the server echoes the
  // original for same-language posts) never renders — no header, no swap.
  // Same-language discard on top: a fetched result whose detected source
  // IS the viewer's language never renders either (the original shows
  // instead — never the redundant translation). The null-label escape is
  // decideTranslation's foreign-script misfire path (the text genuinely
  // changed, so it is NOT redundant) and still shows. Both checks run on
  // the merged value so manual + auto share one rule.
  const decided = rawTranslation
    ? decideTranslation(effective.content.plain, rawTranslation, srcLang)
    : null
  const sameLanguageResult =
    rawTranslation !== null && isSameLanguagePost(rawTranslation.sourceLang, srcLang)
  const shownTranslation =
    rawTranslation && decided?.show === true && !(sameLanguageResult && decided.label !== null)
      ? {sourceLang: decided.label, text: rawTranslation.text}
      : null
  // The translated body replaces the original; the header above it
  // toggles back and forth. Hidden with the CW gate so a closed warning
  // never leaks the translated text early.
  const showingTranslation = !bodyHidden && shownTranslation !== null && !showOriginal
  // Translated bodies parse back into nodes (mentions/links stay live,
  // newlines survive) — the ONLY difference from the original is the
  // text content, never the chrome around it. Translated hashtags route
  // to the ORIGINAL tags via `originalTagsOf(fullNodes)` (unfolded nodes:
  // folding is a view transform, never the tag source).
  const originalTags = useMemo(() => originalTagsOf(fullNodes), [fullNodes])
  const translatedNodes = useMemo(
    () =>
      shownTranslation
        ? contentFromTranslatedText(shownTranslation.text, originalTags)
        : null,
    [shownTranslation?.text, originalTags],
  )
  return {
    shownTranslation,
    showingTranslation,
    translatedNodes,
    showOriginal,
    setShowOriginal,
  }
}
