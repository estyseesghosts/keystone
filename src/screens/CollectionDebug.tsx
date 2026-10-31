// Collection kit debug screen (P6.6 slice 2, dev-only like SysDebug):
// sample folders + clips + favourites item through the shared grid and
// list, with selection, sort menu, filter, mosaic and icon thumbs.
// Screenshots: grid + list, web + Android.

import {useReducer} from 'react';
import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {i18n} from '#/locale/i18n';

import {CollectionScreen} from '#/components/Collection/CollectionScreen';
import {Toolbar} from '#/components/Collection/Toolbar';
import {SelectionBar} from '#/components/Collection/SelectionBar';
import {initSelection, isSelected, selectionReducer} from '#/components/Collection/useSelection';
import type {CollectionItem} from '#/components/Collection/types';

const ITEMS: CollectionItem[] = [
  {
    key: 'fav',
    title: 'Favourites',
    subtitle: 'Saved posts',
    thumb: {kind: 'icon', icon: 'star'},
    a11yHint: 'folder',
  },
  {
    key: 'photos',
    title: 'Photos',
    subtitle: '12 items',
    thumb: {kind: 'icon', icon: 'folder'},
    a11yHint: 'folder',
  },
  {
    key: 'clip1',
    title: 'Reading list',
    subtitle: '42 notes · Private',
    thumb: {
      kind: 'mosaic',
      images: [
        {url: 'https://example.test/a.png'},
        {url: 'https://example.test/b.png'},
        {url: 'https://example.test/c.png'},
        {url: 'https://example.test/d.png'},
      ],
    },
    a11yHint: 'clip, 42 of 200 notes',
  },
  {
    key: 'clip2',
    title: 'Empty clip',
    subtitle: '0 notes · Public',
    thumb: {kind: 'icon', icon: 'clip'},
    a11yHint: 'clip',
  },
  {
    key: 'img1',
    title: 'a-very-long-file-name-that-wraps-to-two-lines.png',
    subtitle: 'image · 1.2 MB',
    thumb: {kind: 'image', url: 'https://example.test/a.png'},
    a11yHint: 'image',
  },
  {
    key: 'img2',
    title: 'sensitive.png',
    subtitle: 'image · 800 KB',
    thumb: {kind: 'image', url: 'https://example.test/s.png', sensitive: true},
    badges: [{key: 'sensitive', label: 'Sensitive'}],
    a11yHint: 'image, sensitive',
  },
];

export function CollectionDebugScreen() {
  const [sel, dispatchSel] = useReducer(selectionReducer, undefined, () => initSelection(ITEMS.map(i => i.key)));
  return (
    <View style={atoms.flex1} testID="collection-debug">
      <CollectionScreen
        screen="clips"
        title={i18n._(msg`Collection debug`)}
        toolbar={
          <Toolbar
            screen="clips"
            sortOptions={[
              {key: 'name', label: i18n._(msg`Name`)},
              {key: 'date', label: i18n._(msg`Date`)},
            ]}
            onSortChange={() => {}}
            filter=""
            onFilterChange={() => {}}
            testID="collection-debug-toolbar"
          />
        }
        selectionBar={
          sel.selected.length > 0 ? (
            <SelectionBar count={sel.selected.length} onClear={() => dispatchSel({type: 'clear'})} testID="collection-debug-selection" />
          ) : undefined
        }
        items={ITEMS}
        render={{
          selected: key => isSelected(sel, key),
          selectionMode: sel.mode,
          onOpen: () => {},
          onToggle: key => dispatchSel({type: 'toggle', key}),
          testID: 'collection-debug-item',
        }}
        session={{}}
        testID="collection-debug-screen"
      />
    </View>
  );
}
