// PF-E1: reaction chips resolve custom art through the glyph chain.
//
// Chips used to render `entry.url` only: a `:name@host:` key with no
// packed URL fell through to literal text forever (never the session
// listing or remote-host tables), and Mastodon-family bare shortcodes
// (`hehe` + URL) never retried. These pin the fixed path: entry URL →
// tolerant packed lookup (colon-wrapped or bare server key shapes) →
// session listing → remote/author host tables → literal `:code:`.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {createMemoryStore, type ReactionSummary, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ReactionChips} from '#/components/Post/ReactionChips'
import type {TokenVault} from '#/storage'
import {createSessionStore, type SessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {resetCustomEmojiStoresForTests} from '#/state/customEmojiStores'

const HOME = 'https://home.example'
const REMOTE = 'remote.example'
const REMOTE_URL = `https://${REMOTE}/wave.png`
const HOME_BLOB = `${HOME}/blob.png`

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

function installFetch(mode: {home: 'ok' | 'fail'}): {restore: () => void} {
  const realFetch = globalThis.fetch
  ;(globalThis as {fetch: unknown}).fetch = async (input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as {url?: unknown})?.url ?? input)
    if (url.startsWith(`https://${REMOTE}/api/emojis`)) {
      return jsonRes({emojis: [{name: 'wave', url: REMOTE_URL}]})
    }
    if (url.startsWith(`${HOME}/api/emojis`)) {
      if (mode.home === 'fail') throw new Error('home is down')
      return jsonRes({emojis: [{name: 'blob', url: HOME_BLOB, category: 'local'}]})
    }
    throw new Error(`unexpected fetch in chip test: ${url}`)
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

function summary(entries: ReactionSummary['entries'], urls: Record<string, string> = {}): ReactionSummary {
  return {total: entries.reduce((n, e) => n + e.count, 0), entries, mine: null, myReactions: [], urls}
}

i18n.load('en', {})
i18n.activate('en')

beforeEach(() => {
  resetCustomEmojiStoresForTests()
})

describe('PF-E1 reaction chip art', () => {
  it('resolves a :name@host: chip with no packed URL through the host table', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(
        <ReactionChips
          reactions={summary([{key: `:wave@${REMOTE}:`, count: 2, mine: false, url: null}])}
          sessionId={session.id}
          testID="chips"
        />,
        store,
      )
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('tolerates bare-inner packed key shapes (server sends name@host, key has colons)', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      // No fetch needed: the packed map answers, whatever its key shape.
      renderTree(
        <ReactionChips
          reactions={summary([{key: `:wave@${REMOTE}:`, count: 1, mine: false, url: null}], {
            [`wave@${REMOTE}`]: 'https://packed.example/wave.png',
          })}
          sessionId={session.id}
          testID="chips"
        />,
        store,
      )
      await waitFor(() =>
        expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe('https://packed.example/wave.png'),
      )
    } finally {
      restore()
    }
  })

  it('renders Mastodon-family bare shortcodes with packed URLs as images', () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
    renderTree(
      <ReactionChips
        reactions={summary([{key: 'hehe', count: 1, mine: false, url: 'https://akk.example/hehe.png'}])}
        testID="chips"
      />,
      store,
    )
    expect(screen.getByLabelText(':hehe:').props.source?.uri).toBe('https://akk.example/hehe.png')
  })

  it('keeps unicode chips rendering (no url, no colons)', () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
    renderTree(<ReactionChips reactions={summary([{key: '👍', count: 3, mine: false, url: null}])} testID="chips" />, store)
    expect(screen.getByLabelText('👍')).toBeTruthy()
    expect(screen.queryByText(':fresh:')).toBeNull()
  })

  it('falls back to the literal :code: when nothing resolves (error listing)', async () => {
    const {restore} = installFetch({home: 'fail'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(
        <ReactionChips
          reactions={summary([{key: ':blob:', count: 1, mine: false, url: null}])}
          sessionId={session.id}
          testID="chips"
        />,
        store,
      )
      await waitFor(() => expect(screen.getByText(':blob:')).toBeTruthy())
    } finally {
      restore()
    }
  })

  it('pending optimistic keys keep the fixed box, never literal text', () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
    renderTree(
      <ReactionChips
        reactions={summary([{key: ':fresh:', count: 1, mine: false, url: null}])}
        pendingKeys={new Set([':fresh:'])}
        testID="chips"
      />,
      store,
    )
    expect(screen.getByTestId('pending-emoji', {includeHiddenElements: true})).toBeTruthy()
    expect(screen.queryByText(':fresh:')).toBeNull()
  })

  it('tapping a chip toggles through onToggle', () => {
    const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
    const onToggle = jest.fn()
    renderTree(
      <ReactionChips
        reactions={summary([{key: '👍', count: 3, mine: false, url: null}])}
        onToggle={onToggle}
        testID="chips"
      />,
      store,
    )
    fireEvent.press(screen.getByTestId('reaction-👍'))
    expect(onToggle).toHaveBeenCalledWith('👍')
  })
})
