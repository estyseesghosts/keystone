// Clips index on the collection kit (P6.6 slice 3): the pinned
// Favourites folder (same tile/row/mosaic as a clip, own data source —
// DC-3) + the viewer's clips with lazy mosaics (DC-4/DC-5).
//
// Create/edit/delete go through `ClipDialog` (full-body update, DC-6).
// Picker mode (`route.params.addNoteId`) files the note into the tapped
// tile — Favourites tile calls `bookmarks.add`, clips call
// `clips.addNote` — then closes.

import {useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native';
import {msg} from '@lingui/macro';

import type {ClipSummary} from '@keystone/fedi';

import {atoms} from '#/alf/atoms';
import {Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Loader} from '#/components/Loader';
import {Menu} from '#/components/Menu';
import {CollectionScreen} from '#/components/Collection/CollectionScreen';
import {Toolbar} from '#/components/Collection/Toolbar';
import {MoreIcon} from '#/components/icons';
import {useCollectionView} from '#/state/collectionPrefs';
import type {CollectionItem} from '#/components/Collection/types';
import {ClipDialog} from '#/components/Clips/ClipDialog';
import {ClipTile, FavouritesTile} from '#/components/Clips/ClipTile';
import {Dialog} from '#/components/Dialog';
import {useDataSaver} from '#/state/appearance';
import {errorText} from '#/lib/localeErrors';
import {showToast} from '#/lib/toast';
import {i18n} from '#/locale/i18n';
import type {RootParamList} from '#/routes';
import {useActiveBackend} from '#/screens/HomeFeed';
import {useMe} from '#/state/queries/me';
import {useClips, useInvalidateClip, useInvalidateClipMosaic, useInvalidateClips} from '#/state/queries/clips';

export function ClipsScreen() {
  const {session, backend} = useActiveBackend();
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const route = useRoute<RouteProp<RootParamList, 'Clips'>>();
  const addNoteId = route.params?.addNoteId ?? null;
  const sessionId = session?.id ?? null;
  const clips = useClips(sessionId, backend ? {backend} : {});
  const view = useCollectionView('clips');
  const invalidateClips = useInvalidateClips();
  const invalidateMosaic = useInvalidateClipMosaic();
  const invalidateClip = useInvalidateClip();
  const {me} = useMe(sessionId);
  const dataSaver = useDataSaver();
  // Dedupe by id: a server that ignores paging params returns the
  // same page twice before the repeat-cursor guard settles (and any
  // overlapping pages would double-render). First occurrence wins.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (clips.data?.pages ?? [])
      .flatMap(p => p.items)
      .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [clips.data]);
  const [dialog, setDialog] = useState<{clip: ClipSummary | null} | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClipSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const clipLimit = me?.limits?.clipLimit;
  const atLimit = clipLimit !== undefined && items.length >= clipLimit;
  const canUseClips = backend?.clips != null;
  const showFavourites = backend?.bookmarks != null;

  const addNoteTo = async (clip: ClipSummary | null) => {
    if (!addNoteId || !sessionId) return;
    setActionError(null);
    try {
      if (clip === null) {
        if (!backend?.bookmarks) throw new Error('no bookmarks backend');
        await backend.bookmarks.add(addNoteId);
      } else {
        if (!backend?.clips) return;
        await backend.clips.addNote(clip.id, addNoteId);
        invalidateMosaic(sessionId, clip.id);
      }
      invalidateClips(sessionId);
      showToast(
        clip === null ? i18n._(msg`Added to Favourites`) : i18n._(msg`Added to ${clip.name}`),
      );
      navigation.goBack();
    } catch (err) {
      setActionError(
        errorText(i18n, err, i18n._(msg`Could not add to ${clip === null ? 'Favourites' : 'the clip'}.`)),
      );
    }
  };

  const saveDialog = async (values: {name: string; isPublic: boolean; description: string | null}) => {
    if (!backend?.clips || !sessionId) return;
    if (dialog?.clip) {
      const updated = await backend.clips.update(dialog.clip.id, values);
      invalidateClips(sessionId);
      invalidateClip(sessionId, updated.id);
    } else {
      const created = await backend.clips.create(values.name, {
        isPublic: values.isPublic,
        description: values.description,
      });
      invalidateClips(sessionId);
      if (addNoteId) {
        setDialog(null);
        await addNoteTo(created);
        return;
      }
    }
    setDialog(null);
  };

  const doDelete = async () => {
    if (!backend?.clips || !deleteTarget || !sessionId) return;
    setBusy(true);
    try {
      await backend.clips.delete(deleteTarget.id);
      invalidateClips(sessionId);
      invalidateClip(sessionId, deleteTarget.id);
      invalidateMosaic(sessionId, deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(errorText(i18n, err, i18n._(msg`Could not delete the clip.`)));
    } finally {
      setBusy(false);
    }
  };

  const openClip = (clip: ClipSummary) => {
    if (addNoteId) {
      void addNoteTo(clip);
      return;
    }
    navigation.navigate('Clip', {id: clip.id});
  };

  const openFavourites = () => {
    if (addNoteId) {
      void addNoteTo(null);
      return;
    }
    navigation.navigate('Favorites');
  };

  const collectionItems: CollectionItem[] = [
    ...(showFavourites
      ? [
          {
            key: 'favourites',
            title: 'Favourites',
            subtitle: 'Saved posts',
            thumb: {kind: 'icon', icon: 'star'} as const,
            a11yHint: 'folder',
          },
        ]
      : []),
    ...items.map(
      (clip): CollectionItem => ({
        key: clip.id,
        title: clip.name,
        subtitle: `${clip.notesCount ?? '?'} notes · ${clip.isPublic ? 'Public' : 'Private'}`,
        thumb: {kind: 'icon', icon: 'clip'} as const,
        a11yHint: 'clip',
      }),
    ),
  ];
  const byId = new Map(items.map(c => [c.id, c]));

  if (!sessionId || !backend) {
    return (
      <View style={atoms.flex1} testID="clips-screen">
        <CollectionScreen
          screen="clips"
          title={i18n._(msg`Clips`)}
          items={[]}
          render={{
            selected: () => false,
            selectionMode: false,
            onOpen: () => {},
            onToggle: () => {},
          }}
          session={undefined}
          signedOut
          signedOutMessage={i18n._(msg`Sign in to see your clips.`)}
          testID="clips-collection"
        />
      </View>
    );
  }

  if (!canUseClips) {
    return (
      <View style={atoms.flex1} testID="clips-screen">
        <CollectionScreen
          screen="clips"
          title={i18n._(msg`Clips`)}
          items={[]}
          render={{
            selected: () => false,
            selectionMode: false,
            onOpen: () => {},
            onToggle: () => {},
          }}
          session={session}
          unsupportedMessage={i18n._(msg`Clips are not available on this server.`)}
          testID="clips-collection"
        />
      </View>
    );
  }

  return (
    <View style={atoms.flex1} testID="clips-screen">
      <CollectionScreen
        screen="clips"
        title={i18n._(msg`Clips`)}
        toolbar={
          <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
            {addNoteId ? <Caption color="faint">{i18n._(msg`Choose a clip for this post.`)}</Caption> : null}
            <Toolbar
              screen="clips"
              actions={
                <>
                  {clipLimit !== undefined && !clips.hasNextPage ? (
                    <Caption color="faint" testID="clips-count">
                      {i18n._(msg`${items.length} / ${clipLimit}`)}
                    </Caption>
                  ) : null}
                  <Button
                    label={i18n._(msg`New clip`)}
                    variant="primary"
                    compact
                    disabled={atLimit || busy}
                    disabledReason={atLimit ? i18n._(msg`Clip limit reached (${clipLimit}).`) : undefined}
                    onPress={() => setDialog({clip: null})}
                    testID="clips-new"
                  />
                </>
              }
              testID="clips-toolbar"
            />
          </View>
        }
        items={collectionItems}
        render={{
          selected: () => false,
          selectionMode: false,
          onOpen: key => {
            if (key === 'favourites') {
              openFavourites();
              return;
            }
            const clip = byId.get(key);
            if (clip) openClip(clip);
          },
          onToggle: () => {},
          dataSaver,
          testID: 'clips-item',
          renderItem: item => {
            const tileId = item.key === 'favourites' ? 'clips-fav' : `clips-clip-${item.key}`;
            if (item.key === 'favourites') {
              return (
                <FavouritesTile
                  sessionId={sessionId}
                  onOpen={openFavourites}
                  dataSaver={dataSaver}
                  testID={tileId}
                />
              );
            }
            const clip = byId.get(item.key);
            if (!clip) return null;
            return (
              <ClipTile
                clip={clip}
                sessionId={sessionId}
                selected={false}
                selectionMode={false}
                onOpen={() => openClip(clip)}
                onToggle={() => {}}
                menu={
                  <Menu
                    label={i18n._(msg`Clip options`)}
                    items={[
                      {key: 'edit', label: i18n._(msg`Edit`), onSelect: () => setDialog({clip})},
                      {key: 'delete', label: i18n._(msg`Delete`), onSelect: () => setDeleteTarget(clip)},
                    ]}
                    trigger={<MoreIcon size={16} />}
                    testID={`clips-menu-${clip.id}`}
                  />
                }
                dataSaver={dataSaver}
                testID={tileId}
                variant={view === 'list' ? 'row' : 'tile'}
              />
            );
          },
        }}
        session={session}
        loading={clips.isPending}
        error={clips.isError ? clips.error : undefined}
        errorMessage={i18n._(msg`Could not load clips.`)}
        onRetry={() => void clips.refetch()}
        emptyMessage={showFavourites ? undefined : i18n._(msg`You have no clips yet.`)}
        onEndReached={() => {
          if (clips.hasNextPage && !clips.isFetchingNextPage) void clips.fetchNextPage();
        }}
        refreshing={clips.isRefetching}
        onRefresh={() => void clips.refetch()}
        footer={clips.isFetchingNextPage ? <Loader testID="clips-more" /> : null}
        testID="clips-collection"
      />
      {actionError ? (
        <Caption color="faint" testID="clips-action-error">
          {actionError}
        </Caption>
      ) : null}
      {dialog ? (
        <ClipDialog clip={dialog.clip} onSave={saveDialog} onClose={() => setDialog(null)} testID="clips-dialog" />
      ) : null}
      {deleteTarget ? (
        <Dialog
          open
          onClose={() => setDeleteTarget(null)}
          title={i18n._(msg`Delete “${deleteTarget.name}”? This cannot be undone.`)}
          testID="clips-delete">
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Confirm delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void doDelete()}
            testID="clips-delete-confirm"
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleteTarget(null)}
            testID="clips-delete-cancel"
          />
        </Dialog>
      ) : null}
    </View>
  );
}
