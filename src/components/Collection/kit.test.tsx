// P6.6 slice 2: Thumb (sensitive blur, dataSaver icon, kind icons),
// Mosaic layouts, ViewToggle + prefs persistence.

import {fireEvent, render, screen} from '@testing-library/react-native';
import {I18nProvider} from '@lingui/react';

import {createMemoryStore} from '@keystone/fedi';
import {i18n} from '#/locale/i18n';
import {ThemeProvider} from '#/alf/index';

import {Thumb} from './Thumb';
import {Mosaic} from './Mosaic';
import {ViewToggle} from './ViewToggle';
import {CollectionDebugScreen} from '#/screens/CollectionDebug';
import {collectionPrefsStore, readCollectionView} from '#/state/collectionPrefs';

i18n.load('en', {});
i18n.activate('en');

function renderUi(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  );
}

describe('Thumb', () => {
  it('renders the kind icon for folders', () => {
    renderUi(<Thumb thumb={{kind: 'icon', icon: 'folder'}} testID="t" />);
    expect(screen.getByTestId('t')).toBeTruthy();
  });

  it('sensitive image shows the badge and reveals on tap', () => {
    renderUi(
      <Thumb
        thumb={{kind: 'image', url: 'https://example.test/a.png', sensitive: true}}
        blurhash="abc"
        testID="t"
      />,
    );
    expect(screen.getByTestId('t-sensitive')).toBeTruthy();
    fireEvent.press(screen.getByTestId('t'));
    expect(screen.queryByTestId('t-sensitive')).toBeNull();
  });

  it('dataSaver shows the gated state until tapped', () => {
    renderUi(
      <Thumb thumb={{kind: 'image', url: 'https://example.test/a.png'}} dataSaver testID="t" />,
    );
    fireEvent.press(screen.getByTestId('t'));
    expect(screen.getByTestId('t')).toBeTruthy();
  });

  it('mosaic with a sensitive member gates as one tile', () => {
    renderUi(
      <Thumb
        thumb={{kind: 'mosaic', images: [{url: 'https://example.test/a.png', sensitive: true}]}}
        testID="t"
      />,
    );
    expect(screen.getByTestId('t-sensitive')).toBeTruthy();
  });
});

describe('Mosaic', () => {
  it('renders 1/2/3/4 layouts', () => {
    const urls = ['a', 'b', 'c', 'd'].map(u => ({url: `https://example.test/${u}.png`}));
    for (const n of [1, 2, 3, 4]) {
      const {unmount} = renderUi(<Mosaic images={urls.slice(0, n)} testID={`m${n}`} />);
      expect(screen.getByTestId(`m${n}`)).toBeTruthy();
      unmount();
    }
  });

  it('renders an empty box without images', () => {
    renderUi(<Mosaic images={[]} testID="m0" />);
    expect(screen.getByTestId('m0')).toBeTruthy();
  });
});

describe('collectionPrefs + ViewToggle', () => {  it('defaults grid, persists per screen (device scope)', () => {
    const store = createMemoryStore();
    expect(readCollectionView(store, 'clips')).toBe('grid');
    collectionPrefsStore.set('clips', 'list');
    expect(collectionPrefsStore.get('clips')).toBe('list');
    // Other screens are unaffected.
    expect(collectionPrefsStore.get('drive')).toBe('grid');
    collectionPrefsStore.set('clips', 'grid');
  });

  it('ViewToggle flips the persisted view', () => {
    collectionPrefsStore.set('drive', 'grid');
    renderUi(<ViewToggle screen="drive" testID="vt" />);
    fireEvent.press(screen.getByTestId('vt-list'));
    expect(collectionPrefsStore.get('drive')).toBe('list');
    fireEvent.press(screen.getByTestId('vt-grid'));
    expect(collectionPrefsStore.get('drive')).toBe('grid');
  });
});

describe('CollectionDebugScreen', () => {
  it('renders the shared grid with sample items', () => {
    collectionPrefsStore.set('clips', 'grid');
    renderUi(<CollectionDebugScreen />);
    expect(screen.getByTestId('collection-debug-screen')).toBeTruthy();
    expect(screen.getByTestId('collection-debug-screen-grid-fav')).toBeTruthy();
    collectionPrefsStore.set('clips', 'grid');
  });
});
