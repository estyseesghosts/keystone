// Grid + List (P6.6 slice 2): virtualised FlatList shells over the
// shared item model. Grid: responsive columns (min tile 160 web, 3 per
// row on phones). List: full-width rows. Screens own data + menus.

import {FlatList, View, type ListRenderItemInfo} from 'react-native';
import {useMemo, useState} from 'react';
import {Platform, useWindowDimensions} from 'react-native';

import {atoms} from '#/alf/atoms';

import {Row, Tile} from './Tile';
import type {CollectionItem} from './types';

export interface CollectionBodyProps {
  items: CollectionItem[];
  selected: (key: string) => boolean;
  selectionMode: boolean;
  onOpen: (key: string) => void;
  onToggle: (key: string) => void;
  menu?: (item: CollectionItem) => React.ReactNode;
  dataSaver?: boolean;
  testID?: string;
  /** Full override for one row/tile (mosaic tiles resolve their own data). */
  renderItem?: (item: CollectionItem, helpers: {
    selected: boolean;
    selectionMode: boolean;
    onOpen: () => void;
    onToggle: () => void;
    testID?: string;
  }) => React.ReactNode;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListEmptyComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
}

/** Column count: web fits min-160px tiles; phones pin 3 per row. Pure. */
export function gridColumns(width: number): number {
  if (Platform.OS === 'web') return Math.max(2, Math.floor(width / 176));
  return 3;
}

export function CollectionGrid({
  items,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  menu,
  dataSaver,
  renderItem: renderItemOverride,
  testID,
  onEndReached,
  refreshing,
  onRefresh,
  ListEmptyComponent,
  ListFooterComponent,
}: CollectionBodyProps) {
  // Columns from the *container* width, not the window: the grid lives in
  // the narrow center column on wide layouts (sidebar + widgets eat the
  // rest). Falls back to the window width before the first layout.
  const windowWidth = useWindowDimensions().width;
  const [listWidth, setListWidth] = useState<number | null>(null);
  const columns = useMemo(() => gridColumns(listWidth ?? windowWidth), [listWidth, windowWidth]);
  const renderItem = ({item}: ListRenderItemInfo<CollectionItem>) => {
    if (renderItemOverride) {
      return (
        <>
          {renderItemOverride(item, {
            selected: selected(item.key),
            selectionMode,
            onOpen: () => onOpen(item.key),
            onToggle: () => onToggle(item.key),
            testID: testID ? `${testID}-${item.key}` : undefined,
          })}
        </>
      );
    }
    return (
      <Tile
        item={item}
        selected={selected(item.key)}
        selectionMode={selectionMode}
        onOpen={() => onOpen(item.key)}
        onToggle={() => onToggle(item.key)}
        dataSaver={dataSaver}
        corner={menu?.(item)}
        testID={testID ? `${testID}-${item.key}` : undefined}
      />
    );
  };
  return (
    <View
      style={atoms.flex1}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) setListWidth(prev => (prev === w ? prev : w));
      }}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={item => item.key}
        numColumns={columns}
        key={`grid-${columns}`}
        columnWrapperStyle={columns > 1 ? atoms.gap_sm : undefined}
        contentContainerStyle={atoms.gap_sm}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListEmptyComponent={ListEmptyComponent}
        ListFooterComponent={ListFooterComponent}
        testID={testID}
      />
    </View>
  );
}

export function CollectionList({
  items,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  menu,
  dataSaver,
  renderItem: renderItemOverride,
  testID,
  onEndReached,
  refreshing,
  onRefresh,
  ListEmptyComponent,
  ListFooterComponent,
}: CollectionBodyProps) {
  const renderItem = ({item}: ListRenderItemInfo<CollectionItem>) => {
    if (renderItemOverride) {
      return (
        <>
          {renderItemOverride(item, {
            selected: selected(item.key),
            selectionMode,
            onOpen: () => onOpen(item.key),
            onToggle: () => onToggle(item.key),
            testID: testID ? `${testID}-${item.key}` : undefined,
          })}
        </>
      );
    }
    return (
      <Row
        item={item}
        selected={selected(item.key)}
        selectionMode={selectionMode}
        onOpen={() => onOpen(item.key)}
        onToggle={() => onToggle(item.key)}
        menu={menu?.(item)}
        dataSaver={dataSaver}
        testID={testID ? `${testID}-${item.key}` : undefined}
      />
    );
  };
  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={item => item.key}
      contentContainerStyle={atoms.gap_sm}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent}
      testID={testID}
    />
  );
}
