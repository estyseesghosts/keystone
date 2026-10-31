// Drive tiles (P6.6 slice 5): folder + file items for the kit.
// Thumbnails resolve through the shared `Thumb` (DC-12); menus ride
// the tile corner / row menu slots (slice 6 adds bulk selection).

import {Caption} from '#/alf/typography';
import type {DriveFolder, Media} from '@keystone/fedi';

import {formatBytes} from './UsageBar';
import {formatDate} from '#/locale/format';
import type {CollectionItem, CollectionThumb} from '#/components/Collection/types';

function fileKindLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function fileThumb(file: Media): CollectionThumb {
  if (file.kind === 'image' && file.url) {
    return {kind: 'image', url: file.url, sensitive: file.isSensitive};
  }
  const mime = typeof file.mimeType === 'string' ? file.mimeType : '';
  if (mime.startsWith('image/')) return {kind: 'icon', icon: 'image'};
  if (mime.startsWith('video/')) return {kind: 'icon', icon: 'video'};
  if (mime.startsWith('audio/')) return {kind: 'icon', icon: 'audio'};
  return {kind: 'icon', icon: 'file'};
}

export function folderItem(folder: DriveFolder): CollectionItem {
  return {
    key: folder.id,
    title: folder.name,
    thumb: {kind: 'icon', icon: 'folder'},
    a11yHint: 'folder',
  };
}

export function fileItem(file: Media, date?: string | null): CollectionItem {
  return {
    key: file.id,
    title: file.name,
    subtitle: `${fileKindLabel(file.mimeType)} · ${formatBytes(file.size)}`,
    thumb: fileThumb(file),
    badges: file.isSensitive ? [{key: 'sensitive', label: 'Sensitive'}] : [],
    a11yHint: file.isSensitive ? 'sensitive file' : 'file',
    detail: date ? <Caption color="faint" numberOfLines={1}>{formatDate(date)}</Caption> : undefined,
  };
}
