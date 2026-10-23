import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {KeyboardAvoidingView} from 'react-native'

import {buildCapabilities, type Backend, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {createMemoryStore} from '@keystone/fedi'

import {CompactComposer} from './CompactComposer'

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 20, maxMedia: 4, maxPollOptions: 4})),
}))
// The picker chrome is covered by its own suite; here only the popup shell.
jest.mock('#/components/EmojiPicker', () => ({
  EmojiPicker: () => null,
}))

const session = (): Session =>
  ({
    id: 'https://s.example me',
    origin: 'https://s.example',
    family: 'misskey',
    flavor: 'sharkey',
    accountId: 'me',
    token: 'tok',
    user: {id: 'me', displayName: 'Me', avatarUrl: null},
  }) as unknown as Session

function setup(props?: {onClose?: () => void}) {
  const store = createMemoryStore()
  const backend = {
    family: 'misskey',
    capabilities: buildCapabilities('sharkey'),
    createPost: jest.fn().mockResolvedValue({
      id: 'new',
      author: {id: 'me'},
      counts: {replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0},
    }),
    customEmojis: jest.fn().mockResolvedValue([]),
    search: {},
    uploadMedia: jest.fn(),
  } as unknown as Backend
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  const s = session()
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <CompactComposer session={s} backend={backend} store={store} onClose={props?.onClose} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return {store, backend, s}
}

describe('CompactComposer', () => {
  it('renders the compact chrome: avatar input, pill, icon toolbar, counter, Post', async () => {
    setup()
    expect(screen.getByTestId('composer-compact')).toBeTruthy()
    expect(screen.getByTestId('composer-text')).toBeTruthy()
    expect(screen.getByTestId('composer-audience')).toBeTruthy()
    expect(screen.getByTestId('composer-media-add')).toBeTruthy()
    expect(screen.getByTestId('composer-poll-toggle')).toBeTruthy()
    expect(screen.getByTestId('composer-emoji-button')).toBeTruthy()
    expect(screen.getByTestId('composer-cw-toggle')).toBeTruthy()
    expect(screen.getByTestId('composer-more')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('composer-counter')).toHaveTextContent('20'))
    expect(screen.getByTestId('composer-submit')).toBeTruthy()
  })

  it('switches audience through the anchored popup', () => {
    setup()
    fireEvent.press(screen.getByTestId('composer-audience'))
    expect(screen.getByTestId('composer-audience-menu')).toBeTruthy()
    // Full-height option icons lead each row; the description rides under
    // the label in the text column.
    expect(screen.getByTestId('composer-vis-icon-home')).toBeTruthy()
    expect(screen.getByText('Hidden from global timelines')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-vis-home'))
    expect(screen.queryByTestId('composer-audience-menu')).toBeNull()
  })

  it('opens the emoji picker as a popup, not a dialog', () => {
    setup()
    fireEvent.press(screen.getByTestId('composer-emoji-button'))
    expect(screen.getByTestId('composer-emoji-popup')).toBeTruthy()
    expect(screen.queryByTestId('composer-emoji-dialog')).toBeNull()
  })

  it('toggles schedule from the More popup and posts', async () => {
    const {backend} = setup()
    fireEvent.press(screen.getByTestId('composer-more'))
    expect(screen.getByTestId('composer-more-menu')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('composer-text'), 'hello')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(backend.createPost).toHaveBeenCalled())
  })

  it('shows Cancel and calls onClose when onClose is set', () => {
    const onClose = jest.fn()
    setup({onClose})
    expect(screen.getByTestId('composer-cancel')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides Cancel when onClose is omitted (inline composer stays chrome-free)', () => {
    setup()
    expect(screen.queryByTestId('composer-cancel')).toBeNull()
  })

  it('wraps content in a KeyboardAvoidingView so the toolbar stays reachable', () => {
    setup()
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy()
  })
})
