import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Button} from '#/components/Button'
import type {ExploreTab} from '#/routes'

// URL-backed tab bar for Explore: pressing a tab is the caller's
// navigation (the `:tab` route param), never local state — so browser
// back and deep links like `/explore/tags` restore the tab.
export const EXPLORE_TAB_LABELS: Record<ExploreTab, string> = {
  users: 'Users',
  tags: 'Tags',
  posts: 'Posts',
  news: 'News',
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
          label={EXPLORE_TAB_LABELS[t]}
          variant={t === active ? 'primary' : 'secondary'}
          onPress={() => onChange(t)}
          testID={`explore-tab-${t}`}
        />
      ))}
    </View>
  )
}
