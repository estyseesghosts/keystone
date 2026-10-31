// Folder dialog (P6.6 slice 5): create + rename a folder (name ≤200).
// Server errors map inline (RECURSIVE_NESTING etc. via errorText).

import {useState} from 'react';
import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {TextField} from '#/components/forms/TextField';
import {errorText} from '#/lib/localeErrors';
import {i18n} from '#/locale/i18n';

export function FolderDialog({
  initialName,
  title,
  onSave,
  onClose,
  testID,
}: {
  initialName: string;
  title: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
  testID?: string;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid =
    name.trim().length === 0
      ? i18n._(msg`Name is required.`)
      : name.trim().length > 200
        ? i18n._(msg`Name must be 200 characters or fewer.`)
        : null;

  const submit = async () => {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not save the folder.`)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={title} testID={testID}>
      <TextField
        label={i18n._(msg`Folder name`)}
        value={name}
        onChangeText={setName}
        placeholder={i18n._(msg`Folder name`)}
        error={error ?? invalid ?? undefined}
        testID={testID ? `${testID}-name` : undefined}
      />
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
          variant="primary"
          disabled={busy || invalid != null}
          onPress={() => void submit()}
          testID={testID ? `${testID}-save` : undefined}
        />
        <Button
          label={i18n._(msg`Cancel`)}
          variant="secondary"
          disabled={busy}
          onPress={onClose}
          testID={testID ? `${testID}-cancel` : undefined}
        />
      </View>
    </Dialog>
  );
}
