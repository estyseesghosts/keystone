// PF-E1: PostQuote threads the owning session into its emoji paths.
//
// Quotes used to rely on the DisplayName active-session fallback alone,
// and their RichText had no session at all (packed-only): remote
// `:name@host:` codes in quote bodies rendered literally. These pin the
// explicit threading (E1 sanctioned exception to the WS-A ownership).

import {render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {createMemoryStore, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostQuote} from '#/components/Post/PostQuote'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import type {TokenVault} from '#/storage'
import {createSessionStore, type SessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {resetCustomEmojiStoresForTests} from '#/state/customEmojiStores'

const HOME = 'https://home.example'
const REMOTE = 'remote.example'
const REMOTE_URL = `https://${REMOTE}/wave.png`

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

function installFetch(): {restore: () => void} {
  const realFetch = globalThis.fetch
  ;(globalThis as {fetch: unknown}).fetch = async (input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as {url?: unknown})?.url ?? input)
    if (url.startsWith(`https://${REMOTE}/api/emojis`)) {
      return jsonRes({emojis: [{name: 'wave', url: REMOTE_URL}]})
    }
    if (url.startsWith(`${HOME}/api/emojis`)) {
      return jsonRes({emojis: []})
    }
    throw new Error(`unexpected fetch in quote test: ${url}`)
  }
  return {
    restore: () => {
      globalThis.fetch = realFetch
    },
  }
}

async function makeSession(store: SessionStore): Promise<Session> {
  return store.add({
    origin: HOME,
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'u1',
    token: 'tok',
    grant: 'password',
    hosting: 'third-party',
  })
}

function renderTree(ui: React.ReactElement, store: SessionStore) {
  return render(
    <I18nProvider i18n={i18n}>
      <SessionProvider store={store} homeOrigin="https://app.example">
        <ThemeProvider theme="light">{ui}</ThemeProvider>
      </SessionProvider>
    </I18nProvider>,
  )
}

i18n.load('en', {})
i18n.activate('en')

beforeEach(() => {
  resetCustomEmojiStoresForTests()
})

describe('PF-E1 PostQuote session threading', () => {
  it('renders a remote-emoji quote body image through the explicit session', async () => {
    const {restore} = installFetch()
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const quote = makePost({
        content: {mfm: `quoted :wave@${REMOTE}: ok`, plain: `quoted :wave@${REMOTE}: ok`},
        emojis: {},
      })
      renderTree(<PostQuote quote={quote} unavailable={false} sessionId={session.id} testID="q" />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('renders a remote-emoji quote display name through the explicit session', async () => {
    const {restore} = installFetch()
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const quote = makePost({
        author: makeAccount({displayName: `Ann :wave@${REMOTE}:`, emojis: {}}),
        content: {mfm: 'quoted', plain: 'quoted'},
        emojis: {},
      })
      renderTree(<PostQuote quote={quote} unavailable={false} sessionId={session.id} testID="q" />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })
})
