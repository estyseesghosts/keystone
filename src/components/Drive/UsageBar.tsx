// Drive usage bar (P6.6 slice 5): "{used} of {capacity}" + bar, red
// at ≥90%.

import {StyleSheet, View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Caption} from '#/alf/typography';
import {useTheme} from '#/alf/index';
import {i18n} from '#/locale/i18n';
import {formatBytes as formatAppBytes} from '#/locale/format';

export function formatBytes(size: number | null, locale?: string | null): string {
  return formatAppBytes(size, locale ?? i18n.locale) ?? i18n._(msg`Unknown`);
}

export function UsageBar({
  used,
  capacity,
  testID,
}: {
  used: number | null;
  capacity: number | null;
  testID?: string;
}) {
  const theme = useTheme();
  if (used == null || capacity == null || capacity <= 0) return null;
  const ratio = Math.min(1, used / capacity);
  const hot = ratio >= 0.9;
  return (
    <View style={[atoms.gap_sm]} testID={testID}>
      <Caption color="muted">
        {hot
          ? i18n._(msg`${formatBytes(used)} of ${formatBytes(capacity)} — almost full`)
          : i18n._(msg`${formatBytes(used)} of ${formatBytes(capacity)}`)}
      </Caption>
      <View
        style={[
          styles.bar,
          {backgroundColor: theme.palette.raise, borderWidth: 1, borderColor: theme.palette.edge},
        ]}
        testID={testID ? `${testID}-bar` : undefined}>
        <View
          style={[
            styles.fill,
            {width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.palette.text},
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {height: 8, borderRadius: 4, overflow: 'hidden'},
  fill: {height: '100%'},
});
