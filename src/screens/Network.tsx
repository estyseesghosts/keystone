import {useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {atoms} from '#/alf/atoms'
import {ComposeFab} from '#/components/ComposeFab'
import {Button} from '#/components/Button'
import type {RootParamList, NetworkTab} from '#/routes'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {defaultNetworkTab, descriptorForNetworkTab, visibleNetworkTabs} from '#/state/queries'

// Network (`/network/:tab?`): social / local / global timelines.
//
// Visibility rule (ported from old Keystone as data, not the component):
// Local is hidden while Social exists, and Federated/Global is never the
// default. The Mastodon family has no Social timeline, so Local stays.
export function NetworkScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Network'>>()
  const {session, backend} = useActiveBackend()
  const family = backend?.family ?? session?.family ?? null
  const visible = visibleNetworkTabs(family)
  const requested: NetworkTab | undefined = route.params?.tab
  const initial = requested && visible.includes(requested) ? requested : defaultNetworkTab(family)
  const [tab, setTab] = useState<NetworkTab>(initial)

  const active: NetworkTab = visible.includes(tab) ? tab : defaultNetworkTab(family)

  return (
    <View style={atoms.flex1} testID="network-screen">
      <Pagehead title="Network" />
      <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="network-tabs">
        {visible.map(t => (
          <Button
            key={t}
            label={t === 'social' ? 'Social' : t === 'local' ? 'Local' : 'Federated'}
            variant={t === active ? 'primary' : 'secondary'}
            onPress={() => setTab(t)}
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
