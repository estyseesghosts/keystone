// Selection bar (P6.6 slice 2): count + bulk actions + clear. Screens
// pass their own action buttons.

import {View} from 'react-native';
import {msg, plural} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body} from '#/alf/typography';
import {Button} from '#/components/Button';
import {i18n} from '#/locale/i18n';

export function SelectionBar({
  count,
  onClear,
  actions,
  testID,
}: {
  count: number;
  onClear: () => void;
  actions?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <Body testID={testID ? `${testID}-count` : undefined}>
        {i18n._(
          plural(count, {
            one: '# selected',
            other: '# selected',
          }),
        )}
      </Body>
      <View style={atoms.flex1} />
      {actions}
      <Button
        label={i18n._(msg`Clear`)}
        variant="secondary"
        compact
        onPress={onClear}
        testID={testID ? `${testID}-clear` : undefined}
      />
    </View>
  );
}
