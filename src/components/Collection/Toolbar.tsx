// Collection toolbar (P6.6 slice 2): view toggle, sort menu, filter
// box, primary actions. Slots stay generic — screens pass their own
// sort options and action buttons.

import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {TextField} from '#/components/forms/TextField';
import {Menu} from '#/components/Menu';
import {i18n} from '#/locale/i18n';

import {ViewToggle} from './ViewToggle';
import type {CollectionScreenId} from '#/state/collectionPrefs';

export function Toolbar({
  screen,
  sortOptions,
  onSortChange,
  filter,
  onFilterChange,
  actions,
  testID,
}: {
  screen: CollectionScreenId;
  sortOptions?: Array<{key: string; label: string}>;
  onSortChange?: (key: string) => void;
  filter?: string;
  onFilterChange?: (text: string) => void;
  actions?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <ViewToggle screen={screen} testID={testID ? `${testID}-view` : undefined} />
      {sortOptions && sortOptions.length > 0 ? (
        <Menu
          label={i18n._(msg`Sort`)}
          items={sortOptions.map(o => ({
            key: o.key,
            label: o.label,
            onSelect: () => onSortChange?.(o.key),
          }))}
          testID={testID ? `${testID}-sort` : undefined}
        />
      ) : null}
      {onFilterChange ? (
        <View style={atoms.flex1}>
          <TextField
            label={i18n._(msg`Filter`)}
            value={filter ?? ''}
            onChangeText={onFilterChange}
            placeholder={i18n._(msg`Filter by name`)}
            testID={testID ? `${testID}-filter` : undefined}
          />
        </View>
      ) : null}
      {actions}
    </View>
  );
}
