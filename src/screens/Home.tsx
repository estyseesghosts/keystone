import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useActiveBackend, FeedHeading, FeedView} from '#/screens/HomeFeed'

// Home (`/`): the signed-in account's home timeline. Read-only in Phase 3:
// no compose, no actions — those arrive in Phase 4 behind capability gates.
export function HomeScreen() {
  const {session} = useActiveBackend()
  return (
    <View style={atoms.flex1} testID="home-screen">
      <FeedHeading title="Home" subtitle={session ? undefined : 'Sign in to see your timeline.'} />
      <FeedView sessionId={session?.id ?? null} descriptor="timeline|home" testID="home-feed" />
    </View>
  )
}
