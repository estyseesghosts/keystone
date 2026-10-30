// Clips tiles (P6.6 slice 3, DC-3/DC-4/DC-14): the Favourites folder
// and clip tiles share the same tile/row chrome. Tiles never take a
// `ClipSummary` for favourites — a thumbnail source + title instead.

import {View} from 'react-native';

import {Caption} from '#/alf/typography';
import {Tile as CollectionTile, Row as CollectionRow} from '#/components/Collection/Tile';
import type {CollectionItem} from '#/components/Collection/types';
import type {ClipSummary} from '@keystone/fedi';

import {useClipMosaic} from '#/state/queries/clips';
import {useFavouritesMosaic} from '#/state/queries/favourites';

export interface ClipTileItem {
  kind: 'favourites' | 'clip';
  clip?: ClipSummary;
}

export function clipTileItem(
  item: ClipTileItem,
  mosaic: {images: Array<{url: string; sensitive?: boolean}>} | null,
): CollectionItem {
  if (item.kind === 'favourites') {
    return {
      key: 'favourites',
      title: 'Favourites',
      subtitle: 'Saved posts',
      thumb:
        mosaic && mosaic.images.length > 0
          ? {kind: 'mosaic', images: mosaic.images}
          : {kind: 'icon', icon: 'star'},
      a11yHint: 'folder',
    };
  }
  const clip = item.clip!;
  const notes = clip.notesCount;
  return {
    key: clip.id,
    title: clip.name,
    subtitle: `${notes ?? '?'} notes · ${clip.isPublic ? 'Public' : 'Private'}`,
    thumb:
      mosaic && mosaic.images.length > 0
        ? {kind: 'mosaic', images: mosaic.images}
        : {kind: 'icon', icon: 'clip'},
    badges: clip.isPublic ? [] : [{key: 'private', label: 'Private'}],
    a11yHint: `clip, ${notes ?? '?'} of ${clip.notesCount ?? '?'} notes`,
  };
}

export function FavouritesTile({
  sessionId,
  onOpen,
  dataSaver,
  testID,
}: {
  sessionId: string | null;
  onOpen: () => void;
  dataSaver?: boolean;
  testID?: string;
}) {
  const mosaic = useFavouritesMosaic(sessionId);
  // The pinned folder is never selectable and has no overflow menu.
  return (
    <CollectionTile
      item={clipTileItem({kind: 'favourites'}, mosaic.isPending ? null : mosaic)}
      selected={false}
      selectionMode={false}
      onOpen={onOpen}
      onToggle={onOpen}
      dataSaver={dataSaver}
      testID={testID}
    />
  );
}

export function ClipTile({
  clip,
  sessionId,
  menu,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  dataSaver,
  testID,
  variant = 'tile',
}: {
  clip: ClipSummary;
  sessionId: string | null;
  menu?: React.ReactNode;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggle: () => void;
  dataSaver?: boolean;
  testID?: string;
  variant?: 'tile' | 'row';
}) {
  const mosaic = useClipMosaic(sessionId, clip.id);
  const item = clipTileItem({kind: 'clip', clip}, mosaic.data ?? null);
  if (variant === 'row') {
    return (
      <CollectionRow
        item={{
          ...item,
          detail: clip.description ? (
            <Caption color="faint" numberOfLines={1}>
              {clip.description}
            </Caption>
          ) : undefined,
        }}
        selected={selected}
        selectionMode={selectionMode}
        onOpen={onOpen}
        onToggle={onToggle}
        menu={menu}
        dataSaver={dataSaver}
        testID={testID}
      />
    );
  }
  return (
    <CollectionTile
      item={item}
      selected={selected}
      selectionMode={selectionMode}
      onOpen={onOpen}
      onToggle={onToggle}
      dataSaver={dataSaver}
      corner={menu}
      testID={testID}
    />
  );
}
