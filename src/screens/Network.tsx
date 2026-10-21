import {View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {ComposeFab} from '#/components/ComposeFab'
import {Button} from '#/components/Button'
import {networkTabFromParam, type RootParamList, type NetworkTab} from '#/routes'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {i18n} from '#/locale/i18n'
import {defaultNetworkTab, descriptorForNetworkTab, visibleNetworkTabs} from '#/state/queries'
import {useFeedPrefs} from '#/state/feedPrefs'

// Network (`/network/:tab?`): social / local / federated timelines.
//
// Visibility rule (ported from old Keystone as data, not the component):
// Local is hidden while Social exists, and Federated is never the
// default. The Mastodon family has no Social timeline, so Local stays.
//
// Tabs are URL-backed (parity N2): the active tab lives in the route
// params (`:tab`), so reload and back/forward restore it. Pressing a tab
// writes the param (the URL becomes `/network/<tab>`); the canonical
// Federated URL is `/network/federated`, with pre-W1 `/network/global`
// accepted as an alias.
/** Tab labels, resolved at render time (module constants would freeze the
 * boot locale — the locale switches at runtime). */
function tabLabel(tab: NetworkTab): string {
  switch (tab) {
    case 'social':
      return i18n._(msg`Social`)
    case 'local':
      return i18n._(msg`Local`)
    case 'federated':
      return i18n._(msg`Federated`)
  }
}

export function NetworkScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Network'>>()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const {session, backend} = useActiveBackend()
  const family = backend?.family ?? session?.family ?? null
  // Reactive reader prefs: a mounted screen re-renders when
  // Settings → Feeds toggles change (the store notifies subscribers).
  const prefs = useFeedPrefs()
  const visible = visibleNetworkTabs(family, prefs)
  const requested = networkTabFromParam(route.params?.tab)
  const active: NetworkTab =
    requested && visible.includes(requested) ? requested : defaultNetworkTab(family)

  return (
    <View style={atoms.flex1} testID="network-screen">
      <Pagehead title="Network" />
      <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="network-tabs">
        {visible.map(t => (
          <Button
            key={t}
            label={tabLabel(t)}
            variant={t === active ? 'primary' : 'secondary'}
            onPress={() => navigation.setParams({tab: t} as never)}
            testID={`network-tab-${t}`}
          />
        ))}
      </View>
      <FeedView
        sessionId={session?.id ?? null}
        descriptor={descriptorForNetworkTab(active)}
        testID="network-feed"
      />
      <ComposeFab />
    </View>
  )
}
