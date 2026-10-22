import {View} from 'react-native'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {ComposeFab} from '#/components/ComposeFab'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {useActiveBackend, FeedView} from '#/screens/HomeFeed'
import {Pagehead} from '#/components/Pagehead'
import {appStorage} from '#/storage'

// Home (`/`): the signed-in account's home timeline with the inline
// composer as the feed's header content (it scrolls away with the feed —
// never fixed chrome); the FAB/sidebar Post open the modal for replies,
// quotes, and drafts. A separator bounds the composer from the first post.
export function HomeScreen() {
  const {session, backend} = useActiveBackend()
  const theme = useTheme()
  return (
    <View style={atoms.flex1} testID="home-screen">
      <Pagehead title="Home" />
      <FeedView
        sessionId={session?.id ?? null}
        descriptor="timeline|home"
        testID="home-feed"
        scrollHeader={
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
        }
      />
      <ComposeFab />
    </View>
  )
}
