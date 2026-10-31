// Collection view prefs (P6.6 DC-2): `grid`/`list` per screen, per
// device (MMKV device scope, default `grid`). Raw device keys (like the
// draft key scheme) — not the fixed device-prefs schema, which is for
// cross-account singletons.

import {useSyncExternalStore} from 'react';

import type {KeyValueStore} from '@keystone/fedi';

import {appStorage} from '#/storage';

import type {CollectionView} from '#/components/Collection/types';

export type CollectionScreenId = 'drive' | 'clips';

export function collectionViewKeyFor(screen: CollectionScreenId): string {
  return `keystone.collectionview.${screen}`;
}

export function parseCollectionView(raw: unknown): CollectionView {
  return raw === 'list' ? 'list' : 'grid';
}

export function readCollectionView(store: KeyValueStore, screen: CollectionScreenId): CollectionView {
  try {
    return parseCollectionView(store.getItem(collectionViewKeyFor(screen)));
  } catch {
    return 'grid';
  }
}

export function writeCollectionView(store: KeyValueStore, screen: CollectionScreenId, view: CollectionView): void {
  try {
    store.setItem(collectionViewKeyFor(screen), view);
  } catch {
    // Best-effort: a failed write keeps the in-memory view.
  }
}

interface CollectionPrefsStore {
  get(screen: CollectionScreenId): CollectionView;
  set(screen: CollectionScreenId, view: CollectionView): void;
  subscribe(fn: () => void): () => void;
}

export function createCollectionPrefsStore(
  storage: () => KeyValueStore = appStorage,
): CollectionPrefsStore {
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    get(screen) {
      return readCollectionView(storage(), screen);
    },
    set(screen, view) {
      const store = storage();
      if (readCollectionView(store, screen) === view) return;
      writeCollectionView(store, screen, view);
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const collectionPrefsStore: CollectionPrefsStore = createCollectionPrefsStore();

export function useCollectionView(
  screen: CollectionScreenId,
  store: CollectionPrefsStore = collectionPrefsStore,
): CollectionView {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(screen),
    () => store.get(screen),
  );
}
