// One clip's notes (P6.6 slice 4): loaded via `clips.show` (not
// `list().find`), with the shared `CollectionHeader` (name,
// description, Public/Private, `{n} / {noteEachClipsLimit} notes`,
// Edit / Delete / Copy link). The posts page through the canonical
// `usePostFeedQuery` clip-feed descriptor inside the shared `FeedView`.

import {useState} from 'react';
import {View} from 'react-native';
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native';
import {msg} from '@lingui/macro';

import {isUnsupportedError, type Backend, type ClipSummary, type FeedDescriptor} from '@keystone/fedi';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {Menu} from '#/components/Menu';
import {Pagehead} from '#/components/Pagehead';
import {SignInButton} from '#/components/SignInButton';
import {SkeletonList} from '#/components/Skeleton';
import {canCopy, copyText} from '#/lib/clipboard';
import {errorText} from '#/lib/localeErrors';
import {showToast} from '#/lib/toast';
import {i18n} from '#/locale/i18n';
import type {RootParamList} from '#/routes';
import {FeedView, useActiveBackend} from '#/screens/HomeFeed';
import {useMe} from '#/state/queries/me';
import {useClip, useInvalidateClip, useInvalidateClipMosaic, useInvalidateClips} from '#/state/queries/clips';
import {clipMosaicQueryKey, feedQueryKey} from '#/state/queries/keys';
import {useQueryClient, type QueryClient} from '@tanstack/react-query';
import {PostCardHandlersContext, usePostCardHandlers, type PostCardHandlers} from '#/components/Post/handlers';

import {ClipDialog} from '#/components/Clips/ClipDialog';
import {CollectionHeader} from '#/components/Clips/CollectionHeader';

/** Removal row wiring (testable): `clips.removeNote` + clip feed and
 * mosaic keys only — never the lists or unrelated feeds. */
export function buildRemoveFromClip({
  backend,
  queryClient,
  sessionId,
  clipId,
  descriptor,
}: {
  backend: Backend | null;
  queryClient: QueryClient;
  sessionId: string;
  clipId: string;
  descriptor: FeedDescriptor;
}): NonNullable<PostCardHandlers['removeFromCollection']> {
  return {
    label: i18n._(msg`Remove from this clip`),
    run: async (post: {id: string}) => {
      if (!backend?.clips) return;
      await backend.clips.removeNote(clipId, post.id);
      await queryClient.invalidateQueries({queryKey: feedQueryKey(sessionId, descriptor)});
      await queryClient.invalidateQueries({queryKey: clipMosaicQueryKey(sessionId, clipId)});
    },
  };
}

export function ClipScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Clip'>>();
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const id = route.params.id;
  const {session, backend} = useActiveBackend();
  const sessionId = session?.id ?? null;
  const clip = useClip(sessionId, id, backend ? {backend} : {});
  const {me} = useMe(sessionId);
  const invalidateClips = useInvalidateClips();
  const invalidateClip = useInvalidateClip();
  const invalidateMosaic = useInvalidateClipMosaic();

  if (!sessionId || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title={i18n._(msg`Clip`)} />
        <Body>{i18n._(msg`Sign in to see this clip.`)}</Body>
        <Caption color="faint">{i18n._(msg`Clips never show sample data when signed out.`)}</Caption>
        <SignInButton />
      </View>
    );
  }

  if (!backend?.clips) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="clip-screen">
        <Pagehead title={i18n._(msg`Clip`)} />
        <Body>{i18n._(msg`Clips are not available on this server.`)}</Body>
      </View>
    );
  }

  if (clip.isPending) {
    return (
      <View style={atoms.flex1} testID="clip-screen">
        <Pagehead title={i18n._(msg`Clip`)} />
        <SkeletonList variant="post" testID="clip-loading" />
      </View>
    );
  }

  if (clip.isError || !clip.data) {
    const unsupported = clip.error != null && isUnsupportedError(clip.error);
    const missing = !clip.isError && !clip.data;
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]} testID="clip-screen">
        <Pagehead title={i18n._(msg`Clip`)} />
        <Body>
          {unsupported
            ? i18n._(msg`Clips are not available on this server.`)
            : missing
              ? i18n._(msg`This clip does not exist.`)
              : i18n._(msg`Could not load this clip.`)}
        </Body>
        {!unsupported && !missing ? (
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void clip.refetch()}
            testID="clip-retry"
          />
        ) : null}
      </View>
    );
  }

  return (
    <ClipLoaded
      clip={clip.data}
      sessionId={sessionId}
      noteLimit={me?.limits?.noteEachClipsLimit}
      isOwner={clip.data.isOwn === true || (me != null && clip.data.owner != null && me.id === clip.data.owner.id)}
      onChanged={() => {
        invalidateClips(sessionId);
        invalidateClip(sessionId, id);
      }}
      onDeleted={() => {
        if (sessionId) {
          invalidateClips(sessionId);
          invalidateMosaic(sessionId, id);
        }
        navigation.goBack();
      }}
      testID="clip-screen"
    />
  );
}

function ClipLoaded({
  clip,
  sessionId,
  noteLimit,
  isOwner,
  onChanged,
  onDeleted,
  testID,
}: {
  clip: ClipSummary;
  sessionId: string;
  noteLimit: number | undefined;
  isOwner: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  testID?: string;
}) {
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const {backend} = useActiveBackend();
  const queryClient = useQueryClient();
  const baseHandlers = usePostCardHandlers();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const descriptor = `clip|${clip.id}` as FeedDescriptor;
  const handlers = {
    ...baseHandlers,
    removeFromCollection: buildRemoveFromClip({backend, queryClient, sessionId, clipId: clip.id, descriptor}),
  };

  const copyLink = async () => {
    try {
      await copyText(`clip:${clip.id}`);
      showToast(i18n._(msg`Copied`));
    } catch (err) {
      showToast(errorText(i18n, err, i18n._(msg`Could not copy the link.`)));
    }
  };

  const doDelete = async () => {
    if (!backend?.clips) return;
    setBusy(true);
    try {
      await backend.clips.delete(clip.id);
      setDeleting(false);
      onDeleted();
    } catch (err) {
      showToast(errorText(i18n, err, i18n._(msg`Could not delete the clip.`)));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (values: {name: string; isPublic: boolean; description: string | null}) => {
    if (!backend?.clips) return;
    await backend.clips.update(clip.id, values);
    onChanged();
    setEditing(false);
  };

  return (
    <View style={atoms.flex1} testID={testID}>
      <CollectionHeader
        title={clip.name}
        description={clip.description}
        badges={
          <Caption color="faint" testID={testID ? `${testID}-visibility` : undefined}>
            {clip.isPublic ? i18n._(msg`Public`) : i18n._(msg`Private`)}
          </Caption>
        }
        countLine={
          noteLimit !== undefined && clip.notesCount != null
            ? i18n._(msg`${clip.notesCount} / ${noteLimit} notes`)
            : clip.notesCount != null
              ? i18n._(msg`${clip.notesCount} notes`)
              : null
        }
        actions={
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={i18n._(msg`Copy link`)}
              variant="secondary"
              compact
              disabled={!canCopy()}
              onPress={() => void copyLink()}
              testID={testID ? `${testID}-copy` : undefined}
            />
            {isOwner ? (
              <Menu
                label={i18n._(msg`Clip options`)}
                items={[
                  {key: 'edit', label: i18n._(msg`Edit`), onSelect: () => setEditing(true)},
                  {key: 'delete', label: i18n._(msg`Delete`), onSelect: () => setDeleting(true)},
                ]}
                testID={testID ? `${testID}-menu` : undefined}
              />
            ) : null}
          </View>
        }
        testID={testID ? `${testID}-header` : undefined}
      />
      <View style={atoms.flex1}>
        <PostCardHandlersContext.Provider value={handlers}>
          <FeedView sessionId={sessionId} descriptor={descriptor} testID="clip-feed" />
        </PostCardHandlersContext.Provider>
      </View>
      {editing ? (
        <ClipDialog clip={clip} onSave={saveEdit} onClose={() => setEditing(false)} testID="clip-dialog" />
      ) : null}
      {deleting ? (
        <Dialog
          open
          onClose={() => setDeleting(false)}
          title={i18n._(msg`Delete “${clip.name}”? This cannot be undone.`)}
          testID="clip-delete">
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Confirm delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void doDelete()}
            testID="clip-delete-confirm"
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleting(false)}
            testID="clip-delete-cancel"
          />
        </Dialog>
      ) : null}
    </View>
  );
}
