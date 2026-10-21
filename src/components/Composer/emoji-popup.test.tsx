// PF-E5: emoji popup opens/works from the composer.
//
// Owner report: the popup is broken on Android. Helium web-visual proves
// the open/search/insert path on web; these pin the native-relevant
// fixes: the keyboard is dismissed when the popup/dialog opens (an open
// keyboard covers Modal content on Android and swallows the first tap),
// and the picker list is nested-scroll enabled inside the popup card's
// ScrollView.

import {fireEvent, render, screen} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'
import {FlatList, Keyboard} from 'react-native'

import {buildCapabilities, createMemoryStore, type Backend, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {EmojiPicker} from '#/components/EmojiPicker'
import {createEmojiRecentsStore} from '#/components/EmojiPicker/recents'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {Composer} from '#/components/Composer/Composer'

jest.mock('#/components/Composer/pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('#/screens/HomeFeed', () => ({useBackendForSessionId: () => null}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 500, maxMedia: 4, maxPollOptions: 4})),
}))

i18n.load('en', {})
i18n.activate('en')

const session = (): Session =>
  ({
    id: 's1',
    origin: 'https://s.example',
    family: 'misskey',
    flavor: 'sharkey',
    accountId: 'me',
    token: 'tok',
    user: {id: 'me', displayName: 'Me', avatarUrl: null},
  }) as unknown as Session

const backend = (): Backend =>
  ({
    family: 'misskey',
    capabilities: buildCapabilities('sharkey'),
    createPost: jest.fn().mockResolvedValue({id: 'new'}),
    customEmojis: jest.fn().mockResolvedValue([]),
    search: {},
    uploadMedia: jest.fn(),
  }) as unknown as Backend

function renderCompact() {
  const s = session()
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider theme="light">
        <CompactComposer session={s} backend={backend()} store={createMemoryStore()} onClose={jest.fn()} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('PF-E5 emoji popup', () => {
  it('dismisses the keyboard when the compact popup opens', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
    try {
      renderCompact()
      fireEvent.press(screen.getByTestId('composer-emoji-button'))
      expect(dismiss).toHaveBeenCalled()
      expect(screen.getByTestId('composer-emoji-popup')).toBeTruthy()
    } finally {
      dismiss.mockRestore()
    }
  })

  it('dismisses the keyboard when the full-composer dialog opens', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
    try {
      const s = session()
      const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
      render(
        <I18nProvider i18n={i18n}>
          <ThemeProvider theme="light">
            <QueryClientProvider client={qc}>
              <Composer session={s} backend={backend()} store={createMemoryStore()} onClose={jest.fn()} />
            </QueryClientProvider>
          </ThemeProvider>
        </I18nProvider>,
      )
      fireEvent.press(screen.getByTestId('composer-emoji-button'))
      expect(dismiss).toHaveBeenCalled()
      expect(screen.getByTestId('composer-emoji-dialog')).toBeTruthy()
    } finally {
      dismiss.mockRestore()
    }
  })

  it('the picker list is nested-scroll enabled inside the popup card scroll view', () => {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <QueryClientProvider client={qc}>
        <EmojiPicker sessionId="s1" onPick={jest.fn()} recentsStore={createEmojiRecentsStore(() => createMemoryStore())} />
      </QueryClientProvider>,
    )
    const list = screen.UNSAFE_getByType(FlatList)
    expect(list.props.nestedScrollEnabled).toBe(true)
    expect(list.props.keyboardShouldPersistTaps).toBe('handled')
  })
})
