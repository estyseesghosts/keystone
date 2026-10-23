// Saved posts (`/favorites`): the viewer's bookmarks through the
// canonical `usePostFeedQuery` bookmarks descriptor (both families —
// Misskey `i/favorites` rows are mapped to posts by `fetchFeedPage`)
// inside the shared `FeedView`. Gated on `backend.bookmarks`, with the
// same honest signed-out/unsupported states as every other feed. The
// title follows the platform (sidebar reshuffle): Mastodon `Bookmarks`,
// Misskey `Favourites`. On Misskey the Clips screen links here, so this
// screen links back to Clips.

import {View} from 'react-native'

import type {FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {navigationRef} from '#/navigationRef'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

export function FavoritesScreen() {
  const {session, backend} = useActiveBackend()
  const title = session?.family === 'mastodon' ? 'Bookmarks' : session?.family === 'misskey' ? 'Favourites' : 'Favorites'

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title="Favorites" />
        <Body>Sign in to see your favorites.</Body>
        <Caption color="faint">Favorites never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!backend.bookmarks || backend.capabilities.bookmarks === 'unsupported') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title={title} />
        <Body>{`${title} are not available on this server.`}</Body>
      </View>
    )
  }

  const descriptor = 'bookmarks' as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="favorites-screen">
      <Pagehead title={title} />
      {session.family === 'misskey' ? (
        <View style={[atoms.px_md, atoms.py_sm]}>
          <Button
            label="Clips"
            variant="secondary"
            onPress={() => {
              if (navigationRef.isReady()) navigationRef.navigate('Clips' as never)
            }}
            testID="favorites-clips-link"
          />
        </View>
      ) : null}
      <FeedView sessionId={session.id} descriptor={descriptor} testID="favorites-feed" />
    </View>
  )
}
