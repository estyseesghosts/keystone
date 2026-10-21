import {msg} from '@lingui/macro'

import {Tabs} from '#/components/Tabs'
import {i18n} from '#/locale/i18n'
import type {ExploreTab} from '#/routes'

// URL-backed tab bar for Explore: pressing a tab is the caller's
// navigation (the `:tab` route param), never local state — so browser
// back and deep links like `/explore/tags` restore the tab.
//
// Labels resolve at render time (module constants would freeze the boot
// locale — the locale switches at runtime).
export function exploreTabLabel(t: ExploreTab): string {
  switch (t) {
    case 'users':
      return i18n._(msg`Users`)
    case 'tags':
      return i18n._(msg`Tags`)
    case 'posts':
      return i18n._(msg`Posts`)
    case 'news':
      return i18n._(msg`News`)
  }
}

export function ExploreTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: ExploreTab[]
  active: ExploreTab
  onChange: (tab: ExploreTab) => void
}) {
  return (
    <Tabs
      tabs={tabs.map(t => ({key: t, label: exploreTabLabel(t)}))}
      active={active}
      onChange={onChange}
      testID="explore-tabs"
      testIDPrefix="explore-tab"
      accessibilityLabel="Explore"
    />
  )
}
