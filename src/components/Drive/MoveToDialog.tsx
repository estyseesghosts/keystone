// Move-to dialog (P6.6 slice 5): folder tree browser (lazy children),
// "Move here". Moving a folder into itself or a descendant is disabled
// with a reason; `RECURSIVE_NESTING` maps inline.

import {useState} from 'react';
import {View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {Pressable} from '#/components/Pressable';
import {errorText} from '#/lib/localeErrors';
import {i18n} from '#/locale/i18n';

import {useDriveFolders} from '#/state/queries/drive';

export function MoveToDialog({
  sessionId,
  currentParentId,
  descendantIds,
  onMove,
  onClose,
  testID,
}: {
  sessionId: string | null;
  /** Current parent of the moved item (null = root): moving here is a no-op. */
  currentParentId: string | null;
  /** Folder ids that would nest recursively (self + descendants). */
  descendantIds: string[];
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
  testID?: string;
}) {
  const [stack, setStack] = useState<Array<{id: string; name: string}>>([]);
  const scope = stack.length > 0 ? stack[stack.length - 1]!.id : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folders = useDriveFolders(sessionId, scope);
  const items = (folders.data?.pages ?? []).flatMap(p => p.items);

  const invalid = (id: string | null): string | null => {
    if (id !== null && descendantIds.includes(id)) {
      return i18n._(msg`A folder cannot go inside itself or its subfolders.`);
    }
    if (id === currentParentId) {
      return i18n._(msg`Already here.`);
    }
    return null;
  };

  const move = async (id: string | null) => {
    if (busy || invalid(id)) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(id);
      onClose();
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not move.`)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={i18n._(msg`Move to…`)} testID={testID}>
      {stack.length > 0 ? (
        <Button
          label={i18n._(msg`Up`)}
          variant="secondary"
          compact
          onPress={() => setStack(prev => prev.slice(0, -1))}
          testID={testID ? `${testID}-up` : undefined}
        />
      ) : null}
      <Button
        label={i18n._(msg`My Uploads (root)`)}
        variant="secondary"
        disabled={busy || invalid(null) != null}
        onPress={() => void move(null)}
        testID={testID ? `${testID}-root` : undefined}
      />
      {items.map(f => {
        const reason = invalid(f.id);
        return (
          <View key={f.id} style={[atoms.row, atoms.gap_sm]}>
            <View style={atoms.flex1}>
              <Pressable
                onPress={() => setStack(prev => [...prev, {id: f.id, name: f.name}])}
                accessibilityRole="button"
                accessibilityLabel={f.name}
                testID={testID ? `${testID}-open-${f.id}` : undefined}>
                <Body numberOfLines={1}>{f.name}</Body>
              </Pressable>
            </View>
            <Button
              label={i18n._(msg`Move here`)}
              variant="secondary"
              compact
              disabled={busy || reason != null}
              onPress={() => void move(f.id)}
              testID={testID ? `${testID}-move-${f.id}` : undefined}
            />
          </View>
        );
      })}
      {folders.isPending ? <Caption color="faint">{i18n._(msg`Loading folders…`)}</Caption> : null}
      {error ? <Caption color="faint">{error}</Caption> : null}
    </Dialog>
  );
}
