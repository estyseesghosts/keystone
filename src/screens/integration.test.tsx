import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {Text} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ComposeFab} from '#/components/ComposeFab'
import {PostCardHandlersContext} from '#/components/Post/handlers'
import {filterSoftMuted, softMuteStore} from '#/state/queries'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {PostHandlersProvider} from './PostHandlers'

import {makePost} from '#/components/__tests__/fixtures'
import {useContext} from 'react'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: mockNavigate}),
}))
// Butterfly shell: the FAB renders in the mobile layout. Bare jest has no
// viewport, so pin the mobile cut point here (wide shells use the sidebar
// Post button instead).
jest.mock('react-responsive', () => ({
  useMediaQuery: () => true,
}))

i18n.load('en', {})
i18n.activate('en')

const HOME = 'https://app.example'
const vault = {
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
}

async function setup(withSession: boolean, ui: React.ReactElement) {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault,
    homeOrigin: HOME,
  })
  if (withSession) {
    await store.add({
      origin: 'https://a.example',
      family: 'misskey',
      flavor: 'misskey',
      accountId: 'alice',
      token: 't',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin={HOME}>
            {ui}
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('compose FAB', () => {
  beforeEach(() => mockNavigate.mockClear())
  it('is hidden without a session', async () => {
    await setup(false, <ComposeFab />)
    expect(screen.queryByTestId('compose-fab')).toBeNull()
  })
  it('navigates to Compose with a session', async () => {
    await setup(true, <ComposeFab />)
    fireEvent.press(screen.getByTestId('compose-fab'))
    expect(mockNavigate).toHaveBeenCalledWith('Compose')
  })
})

describe('PostHandlersProvider', () => {
  beforeEach(() => mockNavigate.mockClear())
  function Probe({post}: {post: ReturnType<typeof makePost>}) {
    const h = useContext(PostCardHandlersContext)
    return (
      <>
        <Text testID="reply" onPress={() => h.onReply?.(post)}>
          r
        </Text>
        <Text testID="quote" onPress={() => h.onQuote?.(post)}>
          q
        </Text>
        <Text testID="edit">{h.onEdit ? 'has-edit' : 'no-edit'}</Text>
      </>
    )
  }
  it('reply and quote navigate to Compose; edit is left unset', async () => {
    const post = makePost({id: 'p9'})
    await setup(
      true,
      <PostHandlersProvider>
        <Probe post={post} />
      </PostHandlersProvider>,
    )
    fireEvent.press(screen.getByTestId('reply'))
    expect(mockNavigate).toHaveBeenCalledWith('Compose', {replyToId: 'p9'})
    fireEvent.press(screen.getByTestId('quote'))
    expect(mockNavigate).toHaveBeenCalledWith('Compose', {quoteId: 'p9'})
    expect(screen.getByTestId('edit').props.children).toBe('no-edit')
  })
})

describe('soft-mute filter', () => {
  const a = makePost({id: 'a'})
  const b = makePost({id: 'b', author: {...a.author, id: 'muted-user'}})
  it('passes everything through with no mutes', () => {
    expect(filterSoftMuted([a, b], [])).toEqual([a, b])
  })
  it('drops posts by muted accounts', () => {
    expect(filterSoftMuted([a, b], ['muted-user']).map(p => p.id)).toEqual([
      'a',
    ])
  })
  it('drops pure reposts of muted accounts', () => {
    const rn = makePost({
      id: 'rn',
      renote: b,
      renoteId: 'b',
      content: {plain: ''},
    })
    const out = filterSoftMuted([rn, a], ['muted-user'])
    expect(out.map(p => p.id)).toEqual(['a'])
  })
  it('store is per session', () => {
    softMuteStore.set('s1', 'x', true)
    expect(softMuteStore.has('s2', 'x')).toBe(false)
    softMuteStore.set('s1', 'x', false)
    act(() => undefined)
  })
})
