// Saved posts (`/favorites`): the viewer's bookmarks through the
// canonical `usePostFeedQuery` bookmarks descriptor (both families —
// Misskey `i/favorites` rows are mapped to posts by `fetchFeedPage`)
// with the shared `CollectionHeader` (Clip screen parity: title,
// subtitle, back-to-Clips on Misskey). Mastodon keeps its Bookmarks
// title and behaviour. Data stays `bookmarks`-owned; nothing here calls
// `clips/*`.

import {View} from 'react-native';
import {useNavigation, type NavigationProp} from '@react-navigation/native';

import {msg} from '@lingui/macro';

import type {FeedDescriptor} from '@keystone/fedi';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Pagehead} from '#/components/Pagehead';
import {SignInButton} from '#/components/SignInButton';
import type {RootParamList} from '#/routes';
import {FeedView, useActiveBackend} from '#/screens/HomeFeed';
import {i18n} from '#/locale/i18n';
import {useQueryClient, type QueryClient} from '@tanstack/react-query';
import {PostCardHandlersContext, usePostCardHandlers, type PostCardHandlers} from '#/components/Post/handlers';
import {feedQueryKey} from '#/state/queries/keys';

import {CollectionHeader} from '#/components/Clips/CollectionHeader';

/** Removal row wiring (testable): `bookmarks.remove` + the bookmarks
 * feed key only (the favourites mosaic reads the same feed key). */
export function buildRemoveFromFavourites({
  backend,
  queryClient,
  sessionId,
  descriptor,
  mastodon,
}: {
  backend: import('@keystone/fedi').Backend | null;
  queryClient: QueryClient;
  sessionId: string;
  descriptor: FeedDescriptor;
  mastodon: boolean;
}): NonNullable<PostCardHandlers['removeFromCollection']> {
  return {
    label: mastodon ? i18n._(msg`Remove from Bookmarks`) : i18n._(msg`Remove from Favourites`),
    run: async (post: {id: string}) => {
      if (!backend?.bookmarks) return;
      await backend.bookmarks.remove(post.id);
      await queryClient.invalidateQueries({queryKey: feedQueryKey(sessionId, descriptor)});
    },
  };
}

export function FavoritesScreen() {
  const {session, backend} = useActiveBackend();
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const queryClient = useQueryClient();
  const baseHandlers = usePostCardHandlers();
  const mastodon = session?.family === 'mastodon';
  const title = mastodon
    ? i18n._(msg({message: 'Bookmarks', context: 'saved posts screen title'}))
    : session?.family === 'misskey'
      ? i18n._(msg({message: 'Favourites', context: 'saved posts screen title'}))
      : i18n._(msg({message: 'Favorites', context: 'saved posts screen title'}));
  const unavailable = mastodon
    ? i18n._(msg`Bookmarks are not available on this server.`)
    : session?.family === 'misskey'
      ? i18n._(msg`Favourites are not available on this server.`)
      : i18n._(msg`Favorites are not available on this server.`);

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title={i18n._(msg({message: 'Favorites', context: 'saved posts screen title'}))} />
        <Body>{i18n._(msg({id: 'favorites.signedOut', message: 'Sign in to see your favorites.'}))}</Body>
        <Caption color="faint">{i18n._(msg`Favorites never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    );
  }

  if (!backend.bookmarks || backend.capabilities.bookmarks === 'unsupported') {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="favorites-screen">
        <Pagehead title={title} />
        <Body>{unavailable}</Body>
      </View>
    );
  }

  const descriptor = 'bookmarks' as FeedDescriptor;
  const handlers = session
    ? {
        ...baseHandlers,
        removeFromCollection: buildRemoveFromFavourites({
          backend,
          queryClient,
          sessionId: session.id,
          descriptor,
          mastodon,
        }),
      }
    : baseHandlers;
  return (
    <View style={atoms.flex1} testID="favorites-screen">
      <CollectionHeader
        title={title}
        description={mastodon ? null : i18n._(msg`Saved posts`)}
        actions={
          !mastodon ? (
            <Button
              label={i18n._(msg`Clips`)}
              variant="secondary"
              compact
              onPress={() => {
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.navigate('Clips');
              }}
              testID="favorites-back-clips"
            />
          ) : undefined
        }
        testID="favorites-header"
      />
      <View style={atoms.flex1}>
        <PostCardHandlersContext.Provider value={handlers}>
          <FeedView sessionId={session.id} descriptor={descriptor} testID="favorites-feed" />
        </PostCardHandlersContext.Provider>
      </View>
    </View>
  );
}
