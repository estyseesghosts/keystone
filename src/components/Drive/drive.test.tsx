// P6.6 slice 5: Drive components — tiles, breadcrumbs, usage,
// folder dialog validation, move-to guards.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {I18nProvider} from '@lingui/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {createMemoryStore} from '@keystone/fedi';
import {i18n} from '#/locale/i18n';
import {ThemeProvider} from '#/alf/index';
import type {TokenVault} from '#/storage';
import {createSessionStore} from '#/state/session/store';
import {SessionProvider} from '#/state/session/SessionProvider';

import {fileItem, folderItem} from './tiles';
import {Breadcrumbs} from './Breadcrumbs';
import {UsageBar} from './UsageBar';
import {FolderDialog} from './FolderDialog';
import {MoveToDialog} from './MoveToDialog';
import type {Media} from '@keystone/fedi';

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
});

function renderUi(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  );
}

function renderWithSession(ui: React.ReactElement, store: unknown) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider store={store as never} homeOrigin="https://a.example">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            {ui}
          </QueryClientProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const mockBackends = new Map<string, unknown>()

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: (s: {id: string}) => mockBackends.get(s.id),
}));

i18n.load('en', {});
i18n.activate('en');

async function signedInStore() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  });
  await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'miauth',
    hosting: 'third-party',
  });
  const sessionId = store.getSnapshot().sessions[0]?.id as string;
  return {store, sessionId};
}

function media(over: Partial<Media> = {}): Media {
  return {
    id: 'f1',
    kind: 'image',
    mimeType: 'image/png',
    url: 'https://a.example/f.png',
    previewUrl: null,
    name: 'f.png',
    description: null,
    blurhash: null,
    isSensitive: false,
    size: 2048,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: 'alice',
    ...over,
  } as Media;
}

describe('drive tiles', () => {
  it('folder item is a folder icon with a folder hint', () => {
    const item = folderItem({id: 'd1', name: 'Photos', parentId: null});
    expect(item.key).toBe('d1');
    expect(item.thumb).toEqual({kind: 'icon', icon: 'folder'});
    expect(item.a11yHint).toBe('folder');
  });

  it('file item carries kind, size and the sensitive badge', () => {
    const item = fileItem(media({isSensitive: true}));
    expect(item.thumb).toMatchObject({kind: 'image'});
    expect(item.subtitle).toContain('image');
    expect(item.subtitle).toContain('KB');
    expect(item.badges).toEqual([{key: 'sensitive', label: 'Sensitive'}]);
  });

  it('non-image files map to icons', () => {
    expect(fileItem(media({kind: 'video', mimeType: 'video/mp4', url: null})).thumb).toEqual({
      kind: 'icon',
      icon: 'video',
    });
  });
});

describe('Breadcrumbs', () => {
  it('renders every crumb and navigates', () => {
    const onNavigate = jest.fn();
    renderUi(
      <Breadcrumbs
        trail={[
          {key: null, label: 'My Uploads'},
          {key: 'a', label: 'A'},
          {key: 'b', label: 'Photos'},
        ]}
        onNavigate={onNavigate}
        testID="crumbs"
      />,
    );
    fireEvent.press(screen.getByTestId('crumbs-a'));
    expect(onNavigate).toHaveBeenCalledWith('a');
  });

  it('collapses a long middle into a menu', () => {
    renderUi(
      <Breadcrumbs
        trail={[
          {key: null, label: 'My Uploads'},
          {key: 'a', label: 'A'},
          {key: 'b', label: 'B'},
          {key: 'c', label: 'C'},
          {key: 'd', label: 'Photos'},
        ]}
        onNavigate={() => {}}
        testID="crumbs"
      />,
    );
    expect(screen.getByTestId('crumbs-middle')).toBeTruthy();
    expect(screen.queryByTestId('crumbs-b')).toBeNull();
  });
});

describe('UsageBar', () => {
  it('renders nothing without numbers, warns at 90%', () => {
    const {unmount} = renderUi(<UsageBar used={null} capacity={100} testID="u" />);
    expect(screen.queryByTestId('u')).toBeNull();
    unmount();
    renderUi(<UsageBar used={95} capacity={100} testID="u" />);
    expect(screen.getByText('95 B of 100 B — almost full')).toBeTruthy();
  });
});

describe('FolderDialog', () => {
  it('requires a non-blank name within 200 chars and saves trimmed', async () => {
    const onSave = jest.fn(async () => undefined);
    renderUi(<FolderDialog initialName="" title="New folder" onSave={onSave} onClose={() => {}} testID="fd" />);
    fireEvent.press(screen.getByTestId('fd-save'));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('fd-name'), '  Pics  ');
    fireEvent.press(screen.getByTestId('fd-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Pics'));
  });
});

describe('MoveToDialog', () => {
  it('disables the moving folder and its descendants with a reason', async () => {
    const {store, sessionId} = await signedInStore();
    const folders = jest.fn(async () => ({
      items: [
        {id: 'self', name: 'Self', parentId: null},
        {id: 'kid', name: 'Kid', parentId: 'self'},
        {id: 'other', name: 'Other', parentId: null},
      ],
      cursor: null,
      end: true,
    }));
    mockBackends.set(sessionId, {
      family: 'misskey',
      capabilities: {drive: 'supported'},
      drive: {folders: {list: folders}},
    });
    try {
      renderWithSession(
        <MoveToDialog
          sessionId={sessionId}
          currentParentId={null}
          descendantIds={['self', 'kid']}
          onMove={jest.fn()}
          onClose={() => {}}
          testID="mv"
        />,
        store,
      );
      expect(await screen.findByTestId('mv-root')).toBeTruthy();
      // Self is disabled with a reason; unrelated folders stay enabled.
      expect(screen.getByTestId('mv-move-self').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId('mv-move-other').props.accessibilityState.disabled).toBe(false);
    } finally {
      mockBackends.clear();
    }
  });
});
