// Upload queue panel (P6.6 slice 7): collapsible card bottom-right
// (web) / bottom overlay (native). Overall progress, per-file progress
// (indeterminate where the transport reports no byte events), errors,
// per-file cancel/retry/remove, clear-finished.

import {useState} from 'react';
import {Platform, ScrollView, StyleSheet, View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Loader} from '#/components/Loader';
import {Pressable} from '#/components/Pressable';
import {useTheme} from '#/alf/index';
import {i18n} from '#/locale/i18n';

import type {UploadItem} from '#/state/uploadQueue';

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    bottom: 16,
    maxHeight: 320,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bar: {height: 6, borderRadius: 3, overflow: 'hidden'},
  fill: {height: '100%'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
});

function FileRow({
  item,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const ratio = item.total != null && item.total > 0 ? Math.min(1, item.sent / item.total) : null;
  return (
    <View style={[atoms.gap_sm]} testID={`upload-item-${item.id}`}>
      <View style={styles.row}>
        <View style={atoms.flex1}>
          <Body numberOfLines={1}>{item.source.name}</Body>
          <Caption color="faint">
            {item.state === 'uploading'
              ? i18n._(msg`Uploading…`)
              : item.state === 'done'
                ? i18n._(msg`Done`)
                : item.state === 'failed'
                  ? (item.error ?? i18n._(msg`Failed`))
                  : item.state === 'cancelled'
                    ? i18n._(msg`Cancelled`)
                    : i18n._(msg`Queued`)}
          </Caption>
        </View>
        {item.state === 'uploading' || item.state === 'queued' ? (
          <Button label={i18n._(msg`Cancel`)} variant="secondary" compact onPress={onCancel} testID={`upload-cancel-${item.id}`} />
        ) : null}
        {item.state === 'failed' ? (
          <Button label={i18n._(msg`Retry`)} variant="secondary" compact onPress={onRetry} testID={`upload-retry-${item.id}`} />
        ) : null}
        {item.state === 'done' || item.state === 'failed' || item.state === 'cancelled' ? (
          <Button label={i18n._(msg`Remove`)} variant="secondary" compact onPress={onRemove} testID={`upload-remove-${item.id}`} />
        ) : null}
      </View>
      {item.state === 'uploading' ? (
        ratio != null ? (
          <View style={[styles.bar, {backgroundColor: theme.palette.edge}]} testID={`upload-bar-${item.id}`}>
            <View style={[styles.fill, {width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.palette.text}]} />
          </View>
        ) : (
          <Loader testID={`upload-indeterminate-${item.id}`} />
        )
      ) : null}
    </View>
  );
}

export function UploadQueuePanel({
  items,
  onCancel,
  onRetry,
  onRemove,
  onClearFinished,
  testID,
}: {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClearFinished: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const active = items.filter(i => i.state === 'queued' || i.state === 'uploading');
  const done = items.filter(i => i.state === 'done').length;
  const failed = items.filter(i => i.state === 'failed').length;
  const withTotal = items.filter(i => i.total != null && i.total > 0);
  const overall =
    withTotal.length > 0 ? withTotal.reduce((n, i) => n + Math.min(1, i.sent / (i.total as number)), 0) / withTotal.length : null;
  return (
    <View
      style={[
        styles.dock,
        Platform.OS === 'web' ? {right: 16, width: 360} : {left: 16, right: 16},
        {backgroundColor: theme.palette.bg, borderColor: theme.palette.edge},
      ]}
      testID={testID}>
      <Pressable
        onPress={() => setOpen(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        accessibilityLabel={open ? i18n._(msg`Collapse uploads`) : i18n._(msg`Expand uploads`)}
        testID={testID ? `${testID}-toggle` : undefined}>
        <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]}>
          <Body>
            {active.length > 0
              ? i18n._(msg`Uploading ${active.length}…`)
              : failed > 0
                ? i18n._(msg`${failed} failed`)
                : i18n._(msg`${done} uploaded`)}
          </Body>
          <View style={atoms.flex1} />
          {overall != null && active.length > 0 ? (
            <Caption color="faint">{`${Math.round(overall * 100)}%`}</Caption>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <ScrollView style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
          {items.map(item => (
            <FileRow
              key={item.id}
              item={item}
              onCancel={() => onCancel(item.id)}
              onRetry={() => onRetry(item.id)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
          <Button
            label={i18n._(msg`Clear finished`)}
            variant="secondary"
            compact
            onPress={onClearFinished}
            testID={testID ? `${testID}-clear` : undefined}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}
