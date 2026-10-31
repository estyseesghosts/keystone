// Drive breadcrumbs (P6.6 slice 5, DC-13): `My Uploads › a › b`.
// Each crumb navigates; long paths collapse the middle into a menu.

import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Menu} from '#/components/Menu';
import {Pressable} from '#/components/Pressable';
import {i18n} from '#/locale/i18n';

export interface Breadcrumb {
  key: string | null;
  label: string;
}

export function Breadcrumbs({
  trail,
  onNavigate,
  testID,
}: {
  /** Root first. `key: null` = the drive root. */
  trail: Breadcrumb[];
  onNavigate: (key: string | null) => void;
  testID?: string;
}) {
  if (trail.length <= 3) {
    return (
      <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
        {trail.map((crumb, i) => (
          <View key={crumb.key ?? 'root'} style={[atoms.row, atoms.gap_sm]}>
            {i > 0 ? <Caption color="faint">{i18n._(msg`›`)}</Caption> : null}
            <Pressable
              onPress={() => onNavigate(crumb.key)}
              accessibilityRole="link"
              accessibilityLabel={crumb.label}
              testID={testID ? `${testID}-${crumb.key ?? 'root'}` : undefined}>
              <Body numberOfLines={1}>{crumb.label}</Body>
            </Pressable>
          </View>
        ))}
      </View>
    );
  }
  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  const middle = trail.slice(1, -1);
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <Pressable
        onPress={() => onNavigate(first.key)}
        accessibilityRole="link"
        accessibilityLabel={first.label}
        testID={testID ? `${testID}-${first.key ?? 'root'}` : undefined}>
        <Body numberOfLines={1}>{first.label}</Body>
      </Pressable>
      <Caption color="faint">{i18n._(msg`›`)}</Caption>
      <Menu
        label={i18n._(msg`Middle folders`)}
        items={middle.map(m => ({key: m.key ?? 'root', label: m.label, onSelect: () => onNavigate(m.key)}))}
        testID={testID ? `${testID}-middle` : undefined}
      />
      <Caption color="faint">{i18n._(msg`›`)}</Caption>
      <Pressable
        onPress={() => onNavigate(last.key)}
        accessibilityRole="link"
        accessibilityLabel={last.label}
        testID={testID ? `${testID}-${last.key ?? 'root'}` : undefined}>
        <Body numberOfLines={1}>{last.label}</Body>
      </Pressable>
    </View>
  );
}
