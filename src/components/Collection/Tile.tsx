// Tile + Row (P6.6 slice 2): shared item chrome. Tile = square thumb +
// two-line title; Row = 48px thumb, name, meta line, overflow menu.
// Selection renders a check badge; web Enter opens, Space toggles.

import {useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Pressable} from '#/components/Pressable';
import {CheckIcon} from '#/components/icons';

import {Thumb} from './Thumb';
import type {CollectionItem} from './types';

const styles = StyleSheet.create({
  pressable: {flex: 1, minWidth: 0},
  tile: {flex: 1, gap: 4, minWidth: 0},
  title: {flexShrink: 1},
  thumbWrap: {position: 'relative'},
  check: {position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  corner: {position: 'absolute', top: 4, right: 4},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8},
  rowThumb: {width: 48, height: 48},
  rowBody: {flex: 1, gap: 2, minWidth: 0},
  badges: {flexDirection: 'row', gap: 4, flexWrap: 'wrap'},
  badge: {paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
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
  /** Native long-press enters selection mode (slice 6). */
  onLongPress?: () => void;
  dataSaver?: boolean;
  blurhash?: string | null;
  /** Top-right overlay (grid overflow menu). Hidden in selection mode. */
  corner?: React.ReactNode;
  testID?: string;
}) {
  // Web hover checkbox (slice 6): affordance without entering mode.
  const [hovered, setHovered] = useState(false);
  const showCheck = selectionMode || selected || hovered;
  const label = item.a11yHint ? `${item.title}, ${item.a11yHint}` : item.title;
  return (
    <Pressable
      onPress={() => (selectionMode ? onToggle() : onOpen())}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      style={styles.pressable}
      testID={testID}>
      <View style={styles.tile}>
        <View style={styles.thumbWrap}>
          <Thumb thumb={item.thumb} blurhash={blurhash} dataSaver={dataSaver} />
          {showCheck ? (
            <View style={styles.check} testID={testID ? `${testID}-check` : undefined}>
              {selected ? <CheckIcon size={14} /> : null}
            </View>
          ) : corner ? (
            <View style={styles.corner}>{corner}</View>
          ) : null}
        </View>
        <Body numberOfLines={2} ellipsizeMode="middle" style={styles.title}>
          {item.title}
        </Body>
        {item.subtitle ? (
          <Caption color="faint" numberOfLines={1} ellipsizeMode="middle">
            {item.subtitle}
          </Caption>
        ) : null}
        {item.badges && item.badges.length > 0 ? (
          <View style={styles.badges} testID={testID ? `${testID}-badges` : undefined}>
            {item.badges.map(b => (
              <View key={b.key} style={styles.badge}>
                <Caption color="faint">{b.label}</Caption>
              </View>
            ))}
          </View>
        ) : null}
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
  onLongPress,
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
  /** Native long-press enters selection mode (slice 6). */
  onLongPress?: () => void;
  /** Overflow menu node (slice screens own their menus). */
  menu?: React.ReactNode;
  dataSaver?: boolean;
  blurhash?: string | null;
  testID?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const showCheck = selectionMode || selected || hovered;
  const label = item.a11yHint ? `${item.title}, ${item.a11yHint}` : item.title;
  return (
    <Pressable
      onPress={() => (selectionMode ? onToggle() : onOpen())}
      onLongPress={onLongPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      style={styles.pressable}
      testID={testID}>
      <View style={styles.row}>
        <View style={styles.rowThumb}>
          <Thumb thumb={item.thumb} blurhash={blurhash} dataSaver={dataSaver} />
        </View>
        <View style={styles.rowBody}>
          <Body numberOfLines={1} ellipsizeMode="middle">
            {item.title}
          </Body>
          {item.subtitle ? (
            <Caption color="faint" numberOfLines={1} ellipsizeMode="middle">
              {item.subtitle}
            </Caption>
          ) : null}
          {item.badges && item.badges.length > 0 ? (
            <View style={styles.badges} testID={testID ? `${testID}-badges` : undefined}>
              {item.badges.map(b => (
                <View key={b.key} style={styles.badge}>
                  <Caption color="faint">{b.label}</Caption>
                </View>
              ))}
            </View>
          ) : null}
          {item.detail}
        </View>
        {showCheck ? (
          <View style={[styles.check, {position: 'relative', top: 0}]} testID={testID ? `${testID}-check` : undefined}>
            {selected ? <CheckIcon size={14} /> : null}
          </View>
        ) : null}
        {menu}
      </View>
    </Pressable>
  );
}
