// Saved posts (`/favorites`): the viewer's bookmarks through the
// canonical `usePostFeedQuery` bookmarks descriptor (both families —
// Misskey `i/favorites` rows are mapped to posts by `fetchFeedPage`)
// inside the shared `FeedView`. Gated on `backend.bookmarks`, with the
// same honest signed-out/unsupported states as every other feed. The
// title follows the platform (sidebar reshuffle): Mastodon `Bookmarks`,
// Misskey `Favourites`. On Misskey the Clips screen links here, so this
// screen links back to Clips.

import {View} from 'react-native'

import {msg} from '@lingui/macro'

import type {FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {navigationRef} from '#/navigationRef'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'
import {i18n} from '#/locale/i18n'

export function FavoritesScreen() {
  const {session, backend} = useActiveBackend()
  const title =
    session?.family === 'mastodon'
      ? i18n._(msg({message: 'Bookmarks', context: 'saved posts screen title'}))
      : session?.family === 'misskey'
        ? i18n._(msg({message: 'Favourites', context: 'saved posts screen title'}))
        : i18n._(msg({message: 'Favorites', context: 'saved posts screen title'}))
  const unavailable =
    session?.family === 'mastodon'
      ? i18n._(msg`Bookmarks are not available on this server.`)
      : session?.family === 'misskey'
        ? i18n._(msg`Favourites are not available on this server.`)
        : i18n._(msg`Favorites are not available on this server.`)

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title={i18n._(msg({message: 'Favorites', context: 'saved posts screen title'}))} />
        <Body>{i18n._(msg({id: 'favorites.signedOut', message: 'Sign in to see your favorites.'}))}</Body>
        <Caption color="faint">{i18n._(msg`Favorites never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!backend.bookmarks || backend.capabilities.bookmarks === 'unsupported') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title={title} />
        <Body>{unavailable}</Body>
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
            label={i18n._(msg({message: 'Clips', context: 'navigation button'}))}
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
