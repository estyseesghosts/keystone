// Tile + Row (P6.6 slice 2): shared item chrome. Tile = square thumb +
// two-line title; Row = 48px thumb, name, meta line, overflow menu.
// Selection renders a check badge; web Enter opens, Space toggles.

import {useState} from 'react';
import {Platform, StyleSheet, View} from 'react-native';

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

/**
 * Web-only DnD source props (P6.6 slice 8, DC-11): `draggable` tiles set
 * the key payload on dragstart; a multi-drag gets a count badge via
 * `setDragImage`. Native trees never receive these props (gated on
 * `Platform.OS`, same DOM-forwarding seam as `onContextMenu`). Pure.
 */
/** Keys of the in-flight collection drag (web-only, set on dragstart,
 * cleared on dragend). Lets drop targets validate during dragover, when
 * the dataTransfer payload itself is unreadable. */
let activeDragKeys: string[] | null = null;

export function getActiveDragKeys(): string[] | null {
  return activeDragKeys;
}

export function dragSourceDomProps(keys: string[]): Record<string, unknown> {
  return {
    draggable: true,
    onDragStart: (e: {
      dataTransfer?: {
        setData?: (type: string, value: string) => void;
        setDragImage?: (node: unknown, x: number, y: number) => void;
        effectAllowed?: string;
      } | null;
    }) => {
      e.dataTransfer?.setData?.('application/x-keystone-keys', JSON.stringify(keys));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      activeDragKeys = keys;
      if (keys.length > 1 && typeof document !== 'undefined' && e.dataTransfer?.setDragImage) {
        const badge = document.createElement('div');
        badge.textContent = `${keys.length} items`;
        badge.setAttribute(
          'style',
          'position:fixed;top:-100px;background:#333;color:#fff;padding:4px 8px;border-radius:8px;font-size:12px;',
        );
        document.body.appendChild(badge);
        e.dataTransfer.setDragImage(badge, 0, 0);
        setTimeout(() => badge.remove(), 0);
      }
    },
    onDragEnd: () => {
      activeDragKeys = null;
    },
  };
}

export function Tile({
  item,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  dragKeys,
  dropProps,
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
  /** Web DnD source keys (slice 8): the tile drags these keys. */
  dragKeys?: string[];
  /** Web DnD target props for this tile (slice 8): folders get drop handlers. */
  dropProps?: Record<string, unknown>;
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
      testID={testID}
      {...(Platform.OS === 'web' && dragKeys && dragKeys.length > 0 ? dragSourceDomProps(dragKeys) : {})}
      {...(Platform.OS === 'web' && dropProps ? dropProps : {})}>
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
  dragKeys,
  dropProps,
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
  /** Web DnD source keys (slice 8): the row drags these keys. */
  dragKeys?: string[];
  /** Web DnD target props for this row (slice 8): folders get drop handlers. */
  dropProps?: Record<string, unknown>;
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
      testID={testID}
      {...(Platform.OS === 'web' && dragKeys && dragKeys.length > 0 ? dragSourceDomProps(dragKeys) : {})}
      {...(Platform.OS === 'web' && dropProps ? dropProps : {})}>
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
