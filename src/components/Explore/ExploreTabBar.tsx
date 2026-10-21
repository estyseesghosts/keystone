import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {Button} from '#/components/Button'
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
    <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="explore-tabs">
      {tabs.map(t => (
        <Button
          key={t}
          label={exploreTabLabel(t)}
          variant={t === active ? 'primary' : 'secondary'}
          onPress={() => onChange(t)}
          testID={`explore-tab-${t}`}
        />
      ))}
    </View>
  )
}
