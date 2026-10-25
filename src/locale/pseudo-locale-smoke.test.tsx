// Pseudo-locale smoke (X9.8 step 4): with the `pseudo` locale active, the
// signed-out chrome of the smoke screens must render no plain-English text
// node. Localized strings render accented under pseudo, so anything still
// matching `/^[A-Za-z][A-Za-z ,.'-]+$/` is an untranslated literal. The
// screens render with no `I18nProvider` on purpose: shared chrome reads the
// app singleton (directly or through `useI18n()`'s bare-tree fallback), so
// this also pins that fallback. Static literal positions are covered by
// `keystone/no-literal-ui-string`; this test covers what the rule cannot
// see (`setError` / `errorText` fallbacks and data-layer reason strings).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render} from '@testing-library/react-native'
import type {ReactElement} from 'react'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {activatePseudoLocale, i18n} from './i18n'
import {ChatRoomScreen} from '../screens/ChatRoom'
import {ClipScreen} from '../screens/Clip'
import {ConversationScreen} from '../screens/Conversation'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
  useRoute: () => ({params: {id: 'c1', roomId: 'r1'}}),
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

/** Plain-English text node: starts with an ASCII letter, followed by
 * letters, spaces, and light punctuation. Accented pseudo-locale output
 * never matches (its first letter is accented); digits, glyphs, and
 * placeholder-led strings (counts, names) never match either. */
const PLAIN_ENGLISH = /^[A-Za-z][A-Za-z ,.'-]+$/

function collectText(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return
  }
  if (node !== null && typeof node === 'object') {
    collectText((node as {children?: unknown}).children, out)
  }
}

/** Render signed-out (no session, no backend, no `I18nProvider`) and
 * return every rendered text node. */
function signedOutText(node: ReactElement): string[] {
  const restore = appStorage()
  __setStorageForTests({storage: createMemoryStore()})
  mockBackendHolder.current = null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme="light">
        <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
          {node}
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  const out: string[] = []
  collectText(rendered.toJSON(), out)
  rendered.unmount()
  __setStorageForTests({storage: restore})
  mockBackendHolder.current = null
  client.clear()
  return out
}

describe('pseudo-locale smoke (no plain-English text nodes)', () => {
  let previousLocale: string

  beforeAll(async () => {
    previousLocale = i18n.locale
    const ok = await activatePseudoLocale()
    expect(ok).toBe(true)
  })

  afterAll(() => {
    i18n.activate(previousLocale)
  })

  it('Clip signed-out chrome renders no plain English', () => {
    const texts = signedOutText(<ClipScreen />)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.filter(t => PLAIN_ENGLISH.test(t))).toEqual([])
  })

  it('ChatRoom signed-out chrome renders no plain English', () => {
    const texts = signedOutText(<ChatRoomScreen />)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.filter(t => PLAIN_ENGLISH.test(t))).toEqual([])
  })

  it('Conversation signed-out chrome renders no plain English', () => {
    const texts = signedOutText(<ConversationScreen />)
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.filter(t => PLAIN_ENGLISH.test(t))).toEqual([])
  })
})
