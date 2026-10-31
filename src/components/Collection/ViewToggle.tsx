// View toggle (P6.6 slice 2, DC-2): grid | list, persisted per screen.

import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Button} from '#/components/Button';
import {i18n} from '#/locale/i18n';

import {useCollectionView, collectionPrefsStore, type CollectionScreenId} from '#/state/collectionPrefs';

export function ViewToggle({
  screen,
  testID,
}: {
  screen: CollectionScreenId;
  testID?: string;
}) {
  const view = useCollectionView(screen, collectionPrefsStore);
  return (
    <View style={[atoms.row, atoms.gap_sm]}>
      <Button
        label={i18n._(msg`Grid`)}
        variant={view === 'grid' ? 'primary' : 'secondary'}
        compact
        onPress={() => collectionPrefsStore.set(screen, 'grid')}
        testID={testID ? `${testID}-grid` : undefined}
      />
      <Button
        label={i18n._(msg`List`)}
        variant={view === 'list' ? 'primary' : 'secondary'}
        compact
        onPress={() => collectionPrefsStore.set(screen, 'list')}
        testID={testID ? `${testID}-list` : undefined}
      />
    </View>
  );
}
