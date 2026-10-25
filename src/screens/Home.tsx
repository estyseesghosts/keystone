import {useEffect, useRef, useState, type ReactNode} from 'react'
import {View} from 'react-native'
import {useQueryClient} from '@tanstack/react-query'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Button} from '#/components/Button'
import {ComposeFab} from '#/components/ComposeFab'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {Pagehead} from '#/components/Pagehead'
import {Tabs} from '#/components/Tabs'
import {
  RecommendationsFeed,
  type RecommendationsFeedHandle,
} from '#/components/Recommendations/RecommendationsFeed'
import {RecommendationsSettingsOverlay} from '#/components/Recommendations/RecommendationsSettingsOverlay'
import {feedQueryKey} from '#/state/queries/keys'
import {useRecommendationsAvailable} from '#/state/queries/recommendations'
import {feedScrollKey, saveFeedScroll} from '#/state/feedMemory'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {appStorage} from '#/storage'

// Home (`/`): the signed-in account's home timeline with the inline
// composer as the feed's header content (it scrolls away with the feed —
// never fixed chrome); the FAB/sidebar Post open the modal for replies,
// quotes, and drafts. A separator bounds the composer from the first post.
//
// The fork recommendations feed (dvd-sharkey) lives here as a second tab,
// above the composer: `Home | Recommendations`. The tab shows only when
// the server provides the endpoints (live probe, default on) and the
// viewer did not disable it. Settings open in an overlay popup — never a
// route — with save-or-discard on dismiss with edits.

export type HomeTab = 'home' | 'recommendations'

/** MMKV key for the per-account home tab restore (sign-out purge, X1.2,
 * deletes it). The tab is per session, so one account's tab never
 * surfaces for another. */
export function homeTabKeyFor(sessionId: string): string {
  if (!sessionId) throw new Error('homeTabKeyFor requires a sessionId')
  return `keystone.homeTab:${sessionId}`
}

function readHomeTab(sessionId: string | null): HomeTab {
  if (!sessionId) return 'home'
  try {
    return appStorage().getItem(homeTabKeyFor(sessionId)) === 'recommendations'
      ? 'recommendations'
      : 'home'
  } catch {
    return 'home'
  }
}

export function HomeScreen() {
  const {session, backend} = useActiveBackend()
  const theme = useTheme()
  const qc = useQueryClient()
  const sessionId = session?.id ?? null
  const [tab, setTab] = useState<HomeTab>('home')
  // Per-account tab restore (the stored tab wins once the session is known).
  useEffect(() => {
    setTab(readHomeTab(sessionId))
  }, [sessionId])
  const [homeNonce, setHomeNonce] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const recRef = useRef<RecommendationsFeedHandle>(null)

  const {available: recAvailable} = useRecommendationsAvailable(sessionId, {backend})
  const showRec = recAvailable && sessionId != null && backend != null
  const active: HomeTab = tab === 'recommendations' && showRec ? 'recommendations' : 'home'

  // The inline composer sits below the tab bar on BOTH tabs and scrolls
  // away with the feed — never fixed chrome.
  const composerHeader: ReactNode =
    session && backend ? (
      <View
        style={{borderBottomWidth: 1, borderBottomColor: theme.palette.border}}
        testID="home-composer-separator">
        <CompactComposer
          key={session.id}
          session={session}
          backend={backend}
          store={appStorage()}
        />
      </View>
    ) : undefined

  const select = (next: HomeTab) => {
    if (next === active) {
      // Re-pressing the active tab re-ranks from the top.
      if (next === 'recommendations') {
        recRef.current?.scrollToTop()
        recRef.current?.reload()
      } else if (sessionId) {
        saveFeedScroll(feedScrollKey(sessionId, 'timeline|home'), 0)
        setHomeNonce(n => n + 1)
        void qc.refetchQueries({queryKey: feedQueryKey(sessionId, 'timeline|home')})
      }
      return
    }
    setTab(next)
    if (sessionId) {
      try {
        appStorage().setItem(homeTabKeyFor(sessionId), next)
      } catch {
        // Storage unavailable: the tab lasts for this mount only.
      }
    }
  }

  return (
    <View style={atoms.flex1} testID="home-screen">
      <Pagehead title="Home" />
      {showRec ? (
        <Tabs<HomeTab>
          tabs={[
            {key: 'home', label: 'Home'},
            {key: 'recommendations', label: 'Recommendations'},
          ]}
          active={active}
          onChange={select}
          testID="home-tabs"
          testIDPrefix="home-tab"
          accessibilityLabel="Home timelines"
        />
      ) : null}
      {active === 'recommendations' ? (
        <View style={{borderBottomWidth: 1, borderBottomColor: theme.palette.border}}>
          <View style={[atoms.px_md, atoms.py_sm, atoms.row, {justifyContent: 'flex-end'}]}>
            <Button
              label="Configure recommendations"
              variant="secondary"
              compact
              onPress={() => setSettingsOpen(true)}
              testID="home-configure-recommendations"
            />
          </View>
        </View>
      ) : null}
      {active === 'recommendations' && sessionId ? (
        <RecommendationsFeed
          key={`rec:${sessionId}`}
          ref={recRef}
          sessionId={sessionId}
          backend={backend}
          testID="home-feed"
          scrollHeader={composerHeader}
        />
      ) : (
        <FeedView
          key={`home:${sessionId ?? 'signed-out'}:${homeNonce}`}
          sessionId={sessionId}
          descriptor="timeline|home"
          testID="home-feed"
          scrollHeader={composerHeader}
        />
      )}
      <RecommendationsSettingsOverlay
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sessionId={sessionId}
      />
      <ComposeFab />
    </View>
  )
}
