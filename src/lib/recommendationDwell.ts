import {useCallback, useEffect, useRef} from 'react'

import {appearNoteOf, type Backend, type Post} from '@keystone/fedi'

// Dwell / impression tracking for the recommendations feed (fork
// `notes/recommendations/dwell`). Port of Sharkey's
// `use-recommendation-dwell` as a FlatList viewability hook: visible time
// per note becomes the "good click" training signal for the learned ranker.
//
// Self-contained: the feed passes `onViewableItemsChanged` + the
// `viewabilityConfig` into its FlatList; no note-component changes needed.
// No-op when signed out or the backend has no recommendations module.
// Best-effort: flush failures are swallowed, never surfaced.

const MIN_DWELL_MS = 600
const FLUSH_INTERVAL_MS = 15_000
const MAX_DWELL_MS = 3_600_000

/** FlatList viewability: half the row on screen for 600ms counts as seen. */
export const RECOMMENDATION_VIEWABILITY_CONFIG = {
  viewAreaCoveragePercentThreshold: 50,
  minimumViewTime: MIN_DWELL_MS,
} as const

export type ViewablePost = {item?: Post | null}

export function useRecommendationDwell(
  sessionId: string | null,
  backend: Backend | null,
): {
  onViewableItemsChanged: (info: {viewableItems: ViewablePost[]; changed: ViewablePost[]}) => void
  flush: () => void
} {
  const visibleSince = useRef(new Map<string, number>())
  const accumulated = useRef(new Map<string, number>())
  const backendRef = useRef(backend)
  backendRef.current = backend
  const active = sessionId != null && backend?.recommendations != null

  const flush = useCallback(() => {
    const b = backendRef.current
    if (!b?.recommendations) {
      visibleSince.current.clear()
      accumulated.current.clear()
      return
    }
    const now = Date.now()
    for (const [id, since] of visibleSince.current) {
      accumulated.current.set(id, (accumulated.current.get(id) ?? 0) + (now - since))
      visibleSince.current.set(id, now)
    }
    const items: Array<{noteId: string; dwellMs: number}> = []
    for (const [id, ms] of accumulated.current) {
      if (ms >= MIN_DWELL_MS) items.push({noteId: id, dwellMs: Math.min(MAX_DWELL_MS, Math.round(ms))})
    }
    accumulated.current.clear()
    if (items.length === 0) return
    void b.recommendations.dwell(items).catch(() => {
      // Best-effort impression log: offline/500 never surfaces.
    })
  }, [])

  const onViewableItemsChanged = useCallback(
    (info: {viewableItems: ViewablePost[]; changed: ViewablePost[]}) => {
      if (!active) return
      const now = Date.now()
      const seen = new Set<string>()
      for (const token of info.viewableItems) {
        const post = token.item
        if (!post) continue
        seen.add(appearNoteOf(post).id)
      }
      // Newly visible: stamp the start (absent = already tracked).
      for (const id of seen) {
        if (!visibleSince.current.has(id)) visibleSince.current.set(id, now)
      }
      // Left the viewport: bank the elapsed time.
      for (const [id, since] of [...visibleSince.current]) {
        if (!seen.has(id)) {
          accumulated.current.set(id, (accumulated.current.get(id) ?? 0) + (now - since))
          visibleSince.current.delete(id)
        }
      }
    },
    [active],
  )

  useEffect(() => {
    if (!active) return
    const timer = setInterval(flush, FLUSH_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      flush()
    }
  }, [active, flush])

  return {onViewableItemsChanged, flush}
}
