// Shared collection kit (P6.6 slice 2, DC-1): one item model for grid
// and list, both screens. Tiles/rows render a thumbnail source + title,
// never a domain object (DC-14).

import type {ReactNode} from 'react';

export type CollectionIconKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'clip'
  | 'star';

export type CollectionThumb =
  | {kind: 'image'; url: string; blurhash?: string | null; sensitive?: boolean}
  | {kind: 'mosaic'; images: Array<{url: string; sensitive?: boolean}>}
  | {kind: 'icon'; icon: CollectionIconKind};

export interface CollectionBadge {
  key: string;
  label: string;
}

export interface CollectionItem {
  key: string;
  title: string;
  subtitle?: string;
  thumb: CollectionThumb;
  badges?: CollectionBadge[];
  /** Accessibility suffix (`"Photos, folder"`, `"Reading list, 3 of 200 notes"`). */
  a11yHint?: string;
  selectable?: boolean;
  /** Extra row in list mode (description line, counts). */
  detail?: ReactNode;
}

export type CollectionView = 'grid' | 'list';
