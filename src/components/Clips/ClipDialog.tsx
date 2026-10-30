// Clip dialog (P6.6 slice 3): create/edit a clip. Name 1–100,
// description ≤2048, Public switch. Save sends the full body (DC-6).

import {useState} from 'react';
import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {TextField} from '#/components/forms/TextField';
import {Pressable} from '#/components/Pressable';
import {errorText} from '#/lib/localeErrors';
import {i18n} from '#/locale/i18n';
import type {ClipSummary} from '@keystone/fedi';

export function ClipDialog({
  clip,
  onSave,
  onClose,
  testID,
}: {
  /** Null = create. */
  clip: ClipSummary | null;
  onSave: (values: {name: string; isPublic: boolean; description: string | null}) => Promise<void>;
  onClose: () => void;
  testID?: string;
}) {
  const [name, setName] = useState(clip?.name ?? '');
  const [description, setDescription] = useState(clip?.description ?? '');
  const [isPublic, setIsPublic] = useState(clip?.isPublic ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError =
    name.trim().length === 0
      ? i18n._(msg`Name is required.`)
      : name.trim().length > 100
        ? i18n._(msg`Name must be 100 characters or fewer.`)
        : null;
  const descriptionError =
    description.length > 2048 ? i18n._(msg`Description must be 2048 characters or fewer.`) : null;

  const submit = async () => {
    if (nameError || descriptionError || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({name: name.trim(), isPublic, description: description === '' ? null : description});
      onClose();
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not save the clip.`)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={clip ? i18n._(msg`Edit clip`) : i18n._(msg`New clip`)}
      testID={testID}>
      <TextField
        label={i18n._(msg`Name`)}
        value={name}
        onChangeText={setName}
        placeholder={i18n._(msg`Clip name`)}
        error={nameError ?? undefined}
        testID={testID ? `${testID}-name` : undefined}
      />
      <TextField
        label={i18n._(msg`Description`)}
        value={description}
        onChangeText={setDescription}
        placeholder={i18n._(msg`Optional description`)}
        error={descriptionError ?? undefined}
        testID={testID ? `${testID}-description` : undefined}
      />
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{checked: isPublic}}
        accessibilityLabel={`${i18n._(msg`Public`)}: ${isPublic ? i18n._(msg`on`) : i18n._(msg`off`)}`}
        onPress={() => setIsPublic(v => !v)}
        testID={testID ? `${testID}-public` : undefined}>
        <Body>
          {isPublic ? i18n._(msg`Public: on`) : i18n._(msg`Public: off`)}
        </Body>
      </Pressable>
      {error ? <Body testID={testID ? `${testID}-error` : undefined}>{error}</Body> : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
          variant="primary"
          disabled={busy || nameError != null || descriptionError != null}
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
