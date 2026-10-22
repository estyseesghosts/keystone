// PostHandlers provider (WS-D): the app-wide user actions behind the post
// menu — mute/unmute + block/unblock through the graph controller,
// boost-visibility flips straight to the backend with a `relationships`
// re-read, and reports through the chooser (clickstone §1.5). Every
// failure toasts, never throws out of the menu.

import {useEffect, useState} from 'react'
import {NavigationContainer} from '@react-navigation/native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render} from '@testing-library/react-native'

import {createMemoryStore, type Post} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {usePostCardHandlers, type PostCardHandlers} from '#/components/Post/handlers'
import {clearToasts, toastStore} from '#/lib/toast'
import {PostHandlersProvider} from '#/screens/PostHandlers'
import {relationshipQueryKey} from '#/state/queries'
import {SessionProvider} from '#/state/session/SessionProvider'
import {createSessionStore} from '#/state/session/store'
import type {TokenVault} from '#/storage'

import {makeAccount, makePost} from '../components/__tests__/fixtures'

const mockBackend: {
  current: Record<string, jest.Mock> & {capabilities: Record<string, string>; family: string} | null
} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackend.current,
}))

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

const ORIGIN = 'https://wsd.example'

function backend(family: 'misskey' | 'mastodon' = 'misskey') {
  const b = {
    family,
    capabilities: {},
    mute: jest.fn(async () => undefined),
    unmute: jest.fn(async () => undefined),
    muteRenotes: jest.fn(async () => undefined),
    unmuteRenotes: jest.fn(async () => undefined),
    block: jest.fn(async () => undefined),
    unblock: jest.fn(async () => undefined),
    relationships: jest.fn(async (ids: string[]) => ids.map(id => ({id}))),
    reportAccount: jest.fn(async () => undefined),
  }
  mockBackend.current = b as never
  return b
}

// The post is someone else's (the provider returns no actions for own posts).
const post = (): Post => makePost({author: makeAccount({id: 'other', acct: 'other'})})
const SESSION_ID = `${ORIGIN} me`

function Probe({onHandlers}: {onHandlers: (h: PostCardHandlers) => void}) {
  const h = usePostCardHandlers()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) {
      setDone(true)
      onHandlers(h)
    }
  }, [done, h, onHandlers])
  return null
}

async function setup(family: 'misskey' | 'mastodon' = 'misskey') {
  const b = backend(family)
  const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: ORIGIN})
  await store.add({
    origin: ORIGIN,
    family,
    flavor: family,
    accountId: 'me',
    token: 'token-me',
    grant: 'password',
    hosting: 'third-party',
  })
  const qc = new QueryClient()
  let user: NonNullable<PostCardHandlers['user']> | undefined
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={store} homeOrigin={ORIGIN}>
        <QueryClientProvider client={qc}>
          <NavigationContainer>
            <PostHandlersProvider>
              <Probe onHandlers={h => { user = h.userFor?.(post(), SESSION_ID) }} />
            </PostHandlersProvider>
          </NavigationContainer>
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>,
  )
  if (!user) throw new Error('provider supplied no user actions')
  return {b, qc, user}
}

beforeEach(() => {
  clearToasts()
  mockBackend.current = null
})

describe('PostHandlers user actions (WS-D)', () => {
  it('mute flips through the controller and toasts', async () => {
    const {b, user} = await setup()
    await user.onMute!()
    expect(b.mute).toHaveBeenCalledWith('other')
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Muted')
  })

  it('boost flip re-reads relationships into the cache', async () => {
    const {b, qc, user} = await setup()
    await user.onMuteBoosts!()
    expect(b.muteRenotes).toHaveBeenCalledWith('other')
    expect(b.relationships).toHaveBeenCalledWith(['other'])
    expect(qc.getQueryData(relationshipQueryKey(SESSION_ID, 'other'))).toEqual({id: 'other'})
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Reposts muted')
  })

  it('block flips through the controller and toasts', async () => {
    const {b, user} = await setup()
    await user.onBlock!()
    expect(b.block).toHaveBeenCalledWith('other')
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Blocked')
  })

  it('Misskey report sends the comment alone (its only report field)', async () => {
    const {b, user} = await setup()
    await user.onReport!({comment: 'spam', category: 'spam', ruleIds: [], forward: false})
    expect(b.reportAccount).toHaveBeenCalledWith('other', {comment: 'spam'})
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Report sent')
  })

  it('Misskey report refuses an empty reason without a wire call', async () => {
    const {b, user} = await setup()
    await user.onReport!({comment: '   ', category: 'other', ruleIds: [], forward: false})
    expect(b.reportAccount).not.toHaveBeenCalled()
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Add a reason for the report.')
  })

  it('Mastodon report carries the reported post, category, rules and forward', async () => {
    const {b, user} = await setup('mastodon')
    await user.onReport!({
      comment: ' impersonation ',
      category: 'violation',
      ruleIds: ['7'],
      forward: true,
    })
    expect(b.reportAccount).toHaveBeenCalledWith('other', {
      comment: 'impersonation',
      statusIds: ['p1'],
      category: 'violation',
      ruleIds: ['7'],
      forward: true,
    })
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('Report sent')
  })

  it('Mastodon report needs no comment (post + category are the report)', async () => {
    const {b, user} = await setup('mastodon')
    await user.onReport!({comment: '', category: 'spam', ruleIds: [], forward: false})
    expect(b.reportAccount).toHaveBeenCalledWith('other', {
      comment: '',
      statusIds: ['p1'],
      category: 'spam',
      ruleIds: [],
      forward: false,
    })
  })

  it('backend failures toast instead of throwing', async () => {
    const {b, user} = await setup()
    b.mute.mockRejectedValueOnce(new Error('server said no'))
    await user.onMute!()
    expect(toastStore.getSnapshot().map(t => t.message)).toContain('server said no')
  })
})
