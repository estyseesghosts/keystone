import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {ComposeFab} from '#/components/ComposeFab'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {appStorage} from '#/storage'

// Home (`/`): the signed-in account's home timeline with the inline
// composer on top (reference-client parity); the FAB/sidebar Post open the
// modal for replies, quotes, and drafts.
export function HomeScreen() {
  const {session, backend} = useActiveBackend()
  return (
    <View style={atoms.flex1} testID="home-screen">
      <Pagehead title="Home" />
      {session && backend ? (
        <CompactComposer
          key={session.id}
          session={session}
          backend={backend}
          store={appStorage()}
        />
      ) : null}
      <FeedView sessionId={session?.id ?? null} descriptor="timeline|home" testID="home-feed" />
      <ComposeFab />
    </View>
  )
}
