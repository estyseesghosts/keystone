// Tile + Row (P6.6 slice 2): shared item chrome. Tile = square thumb +
// two-line title; Row = 48px thumb, name, meta line, overflow menu.
// Selection renders a check badge; web Enter opens, Space toggles.

import {StyleSheet, View} from 'react-native';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Pressable} from '#/components/Pressable';
import {CheckIcon} from '#/components/icons';

import {Thumb} from './Thumb';
import type {CollectionItem} from './types';

const styles = StyleSheet.create({
  tile: {flex: 1, gap: 4},
  title: {flexShrink: 1},
  check: {position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8},
  rowThumb: {width: 48, height: 48},
  rowBody: {flex: 1, gap: 2},
});

export function Tile({
  item,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  dataSaver,
  blurhash,
  corner,
  testID,
}: {
  item: CollectionItem;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggle: () => void;
  dataSaver?: boolean;
  blurhash?: string | null;
  /** Top-right overlay (grid overflow menu). Hidden in selection mode. */
  corner?: React.ReactNode;
  testID?: string;
}) {
  const label = item.a11yHint ? `${item.title}, ${item.a11yHint}` : item.title;
  return (
    <Pressable
      onPress={() => (selectionMode ? onToggle() : onOpen())}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      testID={testID}>
      <View style={styles.tile}>
        <Thumb thumb={item.thumb} blurhash={blurhash} dataSaver={dataSaver} />
        <Body numberOfLines={2} style={styles.title}>
          {item.title}
        </Body>
        {item.subtitle ? (
          <Caption color="faint" numberOfLines={1}>
            {item.subtitle}
          </Caption>
        ) : null}
        {selectionMode ? (
          <View style={styles.check} testID={testID ? `${testID}-check` : undefined}>
            {selected ? <CheckIcon size={14} /> : null}
          </View>
        ) : (
          corner
        )}
      </View>
    </Pressable>
  );
}

export function Row({
  item,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  menu,
  dataSaver,
  blurhash,
  testID,
}: {
  item: CollectionItem;
  selected: boolean;
  selectionMode: boolean;
  onOpen: () => void;
  onToggle: () => void;
  /** Overflow menu node (slice screens own their menus). */
  menu?: React.ReactNode;
  dataSaver?: boolean;
  blurhash?: string | null;
  testID?: string;
}) {
  const label = item.a11yHint ? `${item.title}, ${item.a11yHint}` : item.title;
  return (
    <Pressable
      onPress={() => (selectionMode ? onToggle() : onOpen())}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      testID={testID}>
      <View style={styles.row}>
        <View style={styles.rowThumb}>
          <Thumb thumb={item.thumb} blurhash={blurhash} dataSaver={dataSaver} />
        </View>
        <View style={styles.rowBody}>
          <Body numberOfLines={1}>{item.title}</Body>
          {item.subtitle ? (
            <Caption color="faint" numberOfLines={1}>
              {item.subtitle}
            </Caption>
          ) : null}
          {item.detail}
        </View>
        {selectionMode && selected ? <CheckIcon size={14} /> : null}
        {menu}
      </View>
    </Pressable>
  );
}
