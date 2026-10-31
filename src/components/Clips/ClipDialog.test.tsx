// P6.6 slice 3: ClipDialog — validation, full-body save, cancel.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {I18nProvider} from '@lingui/react';

import {i18n} from '#/locale/i18n';
import {ThemeProvider} from '#/alf/index';

import {ClipDialog} from './ClipDialog';

i18n.load('en', {});
i18n.activate('en');

function renderDialog(clip: {id: string; name: string; isPublic: boolean; description: string | null} | null, onSave: jest.Mock) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <ClipDialog clip={clip as never} onSave={onSave} onClose={() => {}} testID="dlg" />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('ClipDialog', () => {
  it('requires a name and bounds lengths', async () => {
    renderDialog(null, jest.fn());
    fireEvent.changeText(screen.getByTestId('dlg-name'), '');
    fireEvent.press(screen.getByTestId('dlg-save'));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
  });

  it('creates with the full body including null description', async () => {
    const onSave = jest.fn(async () => undefined);
    renderDialog(null, onSave);
    fireEvent.changeText(screen.getByTestId('dlg-name'), 'New');
    fireEvent.press(screen.getByTestId('dlg-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({name: 'New', isPublic: false, description: null}));
  });

  it('edits send unchanged fields through (DC-6)', async () => {
    const onSave = jest.fn(async () => undefined);
    renderDialog({id: 'c1', name: 'Old', isPublic: true, description: 'keep'}, onSave);
    fireEvent.changeText(screen.getByTestId('dlg-name'), 'New');
    fireEvent.press(screen.getByTestId('dlg-save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({name: 'New', isPublic: true, description: 'keep'}),
    );
  });

  it('server failure surfaces inline and keeps the dialog open', async () => {
    const onSave = jest.fn(async () => {
      throw new Error('down');
    });
    renderDialog(null, onSave);
    fireEvent.changeText(screen.getByTestId('dlg-name'), 'New');
    fireEvent.press(screen.getByTestId('dlg-save'));
    expect(await screen.findByText('Could not save the clip.')).toBeTruthy();
  });
});
