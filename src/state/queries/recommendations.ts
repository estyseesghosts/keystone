import {useMemo, useSyncExternalStore} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'

import {
  backendForSession,
  findSession,
  isUnsupportedError,
  recLangForLocale,
  recommendationsEnabled,
  recommendationSettingsOf,
  defaultRecommendationSettings,
  type Backend,
  type RecommendationSettings,
} from '@keystone/fedi'

import {appStorage} from '#/storage'
import {useLocale} from '#/locale/i18n'
import {useSessionStore} from '#/state/session/SessionProvider'

import {meQueryKey, recommendationInterestsQueryKey, recommendationsProbeQueryKey} from './keys'
import {STALE} from './stale'
import {useMe} from './me'

/** Backend for an arbitrary session id (mirrors HomeFeed's helper without
 * importing the screen layer — queries never import from screens). */
function useSessionBackend(sessionId: string | null): Backend | null {
  const store = useSessionStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => {
    if (!sessionId) return null
    const session = snapshot.sessions.find(s => s.id === sessionId) ?? null
    return session ? backendForSession(session) : null
  }, [snapshot, sessionId])
}

// Recommendations availability + settings (fork `notes/recommendations`,
// dvd-sharkey). Detection is a live probe, never a flavor label: a flavor
// cannot prove a backport absent. The tab shows optimistically when the
// family module exists and the viewer did not disable it; a real 404
// hides it afterwards. `enabled !== false` defaults true (old accounts).

/** Feed params for this session: UI locale → lang, NSFW setting → sensitive, boosts always shown. */
export function recommendationFeedParams(
  locale: string,
  settings: RecommendationSettings | null,
): {lang: string; withSensitive: boolean; withRenotes: boolean} {
  return {
    lang: recLangForLocale(locale),
    withSensitive: settings?.recommendNsfw ?? false,
    withRenotes: true,
  }
}

/** Viewer recommendation settings (merged over defaults) + master switch. */
export function useRecommendationSettings(sessionId: string | null): {
  settings: RecommendationSettings | null
  enabled: boolean
  isPending: boolean
  me: ReturnType<typeof useMe>['me']
} {
  const locale = useLocale()
  const {me, isPending} = useMe(sessionId)
  const settings = useMemo<RecommendationSettings | null>(() => {
    if (!sessionId || !me) return null
    return recommendationSettingsOf(me) ?? defaultRecommendationSettings(locale)
  }, [sessionId, me, locale])
  const enabled = me ? recommendationsEnabled(me) : true
  return {settings, enabled, isPending, me}
}

/**
 * Is the recommendations tab available here? False when signed out, when
 * the backend has no recommendations module (Mastodon family), when the
 * viewer disabled it, or when the probe proved the fork endpoints absent.
 * True optimistically while the probe is in flight (a 404 hides the tab
 * afterwards — detection, not a label).
 */
export function useRecommendationsAvailable(
  sessionId: string | null,
  opts: {backend?: Backend | null} = {},
): {available: boolean; checking: boolean} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = opts.backend !== undefined ? opts.backend : storeBackend
  const {enabled} = useRecommendationSettings(sessionId)
  const hasModule = backend?.recommendations != null
  const probe = useQuery({
    queryKey: sessionId ? recommendationsProbeQueryKey(sessionId) : ['recommendations', 'probe', 'signed-out'],
    enabled: sessionId != null && backend != null && hasModule && enabled,
    staleTime: STALE.FEED,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<boolean> => {
      if (!backend?.recommendations) return false
      try {
        await backend.recommendations.feed({limit: 1, offset: 0})
        return true
      } catch (e) {
        if (isUnsupportedError(e)) return false
        const code = (e as {code?: unknown}).code
        if (code === 'UNKNOWN_API_ENDPOINT') return false
        throw e
      }
    },
  })
  if (!sessionId || !backend || !hasModule || !enabled) {
    return {available: false, checking: false}
  }
  if (probe.data === false) return {available: false, checking: false}
  return {available: true, checking: probe.isPending}
}

/** The recommender's interest overlay for the settings form (activity-derived + saved picks). */
export function useRecommendationInterests(
  sessionId: string | null,
  opts: {backend?: Backend | null} = {},
): {interested: string[]; disinterested: string[]; isPending: boolean} {
  const storeBackend = useSessionBackend(sessionId)
  const backend = opts.backend !== undefined ? opts.backend : storeBackend
  const query = useQuery({
    queryKey: sessionId ? recommendationInterestsQueryKey(sessionId) : ['recommendations', 'interests', 'signed-out'],
    enabled: sessionId != null && backend?.recommendations != null,
    staleTime: STALE.FEED,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!backend?.recommendations) return {interested: [], disinterested: []}
      try {
        return await backend.recommendations.interests()
      } catch {
        return {interested: [], disinterested: []}
      }
    },
  })
  const data = query.data ?? {interested: [], disinterested: []}
  return {interested: data.interested, disinterested: data.disinterested, isPending: query.isPending}
}

/** Save recommendation settings (`i/update`), then refresh `me` + probe + feed caches. */
export async function saveRecommendationSettings(
  sessionId: string,
  patch: {
    enabled: boolean
    recommendNsfw: boolean
    factors: Record<string, number>
    engagement: Record<string, number>
    interestTopics: string[]
    disinterestTopics: string[]
    languages: string[]
    followedRatio: number
  },
): Promise<void> {
  const session = findSession(appStorage(), sessionId)
  if (!session) throw new Error('No session for recommendations settings.')
  const backend = backendForSession(session)
  if (!backend.recommendations) throw new Error('This server has no recommendations.')
  await backend.recommendations.updateSettings(patch)
}

export function useInvalidateRecommendations(sessionId: string | null) {
  const qc = useQueryClient()
  return () => {
    if (!sessionId) return
    void qc.invalidateQueries({queryKey: meQueryKey(sessionId)})
    void qc.invalidateQueries({queryKey: recommendationsProbeQueryKey(sessionId)})
    void qc.invalidateQueries({queryKey: recommendationInterestsQueryKey(sessionId)})
  }
}
