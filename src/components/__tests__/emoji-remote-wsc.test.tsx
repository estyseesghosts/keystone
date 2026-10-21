// WS-C (emoji remote fallback + picker store): session-scoped remote
// `:name@host:` resolution in the render path (glyph, RichText post
// bodies, display names, ProfileHeader, notification rows) and in the
// picker (remote-host results, per-session recents cap, unavailable vs
// error + retry). Unknown codes render literally, never blank.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {contentFromMfm, createMemoryStore} from '@keystone/fedi'
import type {Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {CustomEmojiGlyph} from '#/components/EmojiImage'
import {DisplayName} from '#/components/DisplayName'
import {RichText} from '#/components/RichText'
import {EmojiPicker} from '#/components/EmojiPicker/EmojiPicker'
import {createEmojiRecentsStore} from '#/components/EmojiPicker/recents'
import {ProfileHeader} from '#/components/Profile/ProfileHeader'
import {NotificationRow} from '#/components/Notification/NotificationRow'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import {PostCard} from '#/components/Post/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import type {SessionStore} from '#/state/session/store'
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

function installFetch(mode: {home: 'ok' | 'fail'}): {seen: string[]; restore: () => void} {
  const realFetch = globalThis.fetch
  const seen: string[] = []
  ;(globalThis as {fetch: unknown}).fetch = async (input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as {url?: unknown})?.url ?? input)
    seen.push(url)
    if (url.startsWith(`https://${REMOTE}/api/emojis`)) {
      return jsonRes({emojis: [{name: 'wave', url: REMOTE_URL}]})
    }
    if (url.startsWith(`${HOME}/api/emojis`)) {
      if (mode.home === 'fail') throw new Error('home is down')
      return jsonRes({emojis: [{name: 'blob', url: HOME_BLOB, category: 'local'}]})
    }
    throw new Error(`unexpected fetch in WS-C test: ${url}`)
  }
  return {
    seen,
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
  const qc = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}})
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider i18n={i18n}>
        <SessionProvider store={store} homeOrigin="https://app.example">
          <ThemeProvider theme="light">{ui}</ThemeProvider>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

i18n.load('en', {})
i18n.activate('en')

beforeEach(() => {
  resetCustomEmojiStoresForTests()
})

describe('WS-C remote glyph fallback', () => {
  it('resolves :name@host: through the host listing (session-scoped)', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(<CustomEmojiGlyph name="wave" host={REMOTE} src={null} packed={{}} sessionId={session.id} testID="g" />, store)
      // Literal first — never blank, never a fabricated URL.
      expect(screen.getByTestId('g').props.children).toBe(`:wave@${REMOTE}:`)
      await waitFor(() => expect(screen.getByTestId('g').props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('unknown remote codes stay literal, never blank', async () => {
    const {seen, restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(<CustomEmojiGlyph name="nope" host={REMOTE} src={null} packed={{}} sessionId={session.id} testID="g" />, store)
      await waitFor(() => expect(seen.some(u => u.includes(REMOTE))).toBe(true))
      // Let the dead host settle, then the literal must still be there.
      await waitFor(() => expect(screen.getByTestId('g').props.children).toBe(`:nope@${REMOTE}:`))
      expect(screen.getByTestId('g').props.children.length).toBeGreaterThan(0)
      expect(screen.getByTestId('g').props.source).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('falls back to the session listing for local codes (packed miss)', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(<CustomEmojiGlyph name="blob" host={null} src={null} packed={{}} sessionId={session.id} testID="g" />, store)
      await waitFor(() => expect(screen.getByTestId('g').props.source?.uri).toBe(HOME_BLOB))
    } finally {
      restore()
    }
  })

  it('consults the author host for host-less codes in remote-authored content', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(
        <CustomEmojiGlyph name="wave" host={null} src={null} packed={{}} sessionId={session.id} authorHost={REMOTE} testID="g" />,
        store,
      )
      await waitFor(() => expect(screen.getByTestId('g').props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('packed sources still win over the store', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      renderTree(
        <CustomEmojiGlyph
          name="wave"
          host={REMOTE}
          src={null}
          packed={{[`wave@${REMOTE}`]: 'https://packed.example/x.png'}}
          sessionId={session.id}
          testID="g"
        />,
        store,
      )
      await waitFor(() => expect(screen.getByTestId('g').props.source?.uri).toBe('https://packed.example/x.png'))
    } finally {
      restore()
    }
  })
})

describe('WS-C post body + display names', () => {
  it('renders a :name@host: post body image', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const nodes = contentFromMfm(`hello :wave@${REMOTE}: done`)
      renderTree(<RichText nodes={nodes} emojis={{}} sessionId={session.id} testID="body" />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
      expect(screen.getByTestId('body')).toBeTruthy()
    } finally {
      restore()
    }
  })

  it('renders a remote display-name emoji image, unknown stays literal', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const account = makeAccount({displayName: `Ann :wave@${REMOTE}: and :nope@${REMOTE}:`, emojis: {}, host: null})
      renderTree(<DisplayName account={account} sessionId={session.id} testID="dn" />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
      expect(screen.getByText(`:nope@${REMOTE}:`, {exact: false})).toBeTruthy()
    } finally {
      restore()
    }
  })

  it('ProfileHeader renders remote display-name emoji (was literal before WS-C)', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const account = makeAccount({displayName: `Ann :wave@${REMOTE}:`, emojis: {}})
      renderTree(<ProfileHeader account={account} isSelf={false} relationship={null} sessionId={session.id} />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('NotificationRow renders remote display-name emoji (was literal before WS-C)', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const actor = makeAccount({id: 'u9', displayName: `Ann :wave@${REMOTE}:`, emojis: {}})
      renderTree(
        <NotificationRow
          sessionId={session.id}
          notification={{
            id: 'n1',
            kind: 'reaction',
            rawType: 'reaction',
            createdAt: new Date().toISOString(),
            read: false,
            actors: [{id: 'u9', account: actor, reaction: null}],
            post: null,
            reaction: null,
            ext: {},
          } as never}
        />,
        store,
      )
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })

  it('PostCard renders a remote-emoji post body image through its session', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const post = makePost({content: {mfm: `hi :wave@${REMOTE}:`, plain: `hi :wave@${REMOTE}:`}, emojis: {}})
      renderTree(<PostCard post={post} sessionId={session.id} />, store)
      await waitFor(() => expect(screen.getByLabelText(`:wave@${REMOTE}:`).props.source?.uri).toBe(REMOTE_URL))
    } finally {
      restore()
    }
  })
})

describe('WS-C picker store', () => {
  it('shows remote-host emoji from the session store on search', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      // A remote recent seeds the host table (picker ensures on mount),
      // then search surfaces the Remote section.
      const recents = createEmojiRecentsStore(() => createMemoryStore())
      recents.touch(session.id, {kind: 'custom', key: `:wave@${REMOTE}:`, url: REMOTE_URL})
      const onPick = jest.fn()
      renderTree(<EmojiPicker sessionId={session.id} onPick={onPick} recentsStore={recents} />, store)
      fireEvent.changeText(screen.getByTestId('emoji-search'), 'wave')
      await waitFor(() => expect(screen.getByTestId(`emoji-cell-:wave@${REMOTE}:`)).toBeTruthy())
      fireEvent.press(screen.getByTestId(`emoji-cell-:wave@${REMOTE}:`))
      expect(onPick).toHaveBeenCalledWith({kind: 'custom', key: `:wave@${REMOTE}:`, url: REMOTE_URL})
    } finally {
      restore()
    }
  })

  it('keeps per-session recents capped at 24', async () => {
    const {restore} = installFetch({home: 'ok'})
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const recents = createEmojiRecentsStore(() => createMemoryStore())
      for (let i = 0; i < 30; i += 1) recents.touch(session.id, {kind: 'unicode', key: `e${i}`})
      expect(recents.list(session.id)).toHaveLength(24)
      expect(recents.list(session.id)[0].key).toBe('e29')
    } finally {
      restore()
    }
  })

  it('surfaces error + retry (store error state), and recovers', async () => {
    const mode = {home: 'fail' as 'ok' | 'fail'}
    const {restore} = installFetch(mode)
    try {
      const store = createSessionStore({storage: createMemoryStore(), vault: memVault(), homeOrigin: 'https://app.example'})
      const session = await makeSession(store)
      const recents = createEmojiRecentsStore(() => createMemoryStore())
      renderTree(<EmojiPicker sessionId={session.id} onPick={jest.fn()} recentsStore={recents} />, store)
      await waitFor(() => expect(screen.getByTestId('emoji-retry')).toBeTruthy())
      expect(screen.getByText('Could not load custom emoji.')).toBeTruthy()
      // Recovery: the home listing answers, retry re-arms both sources.
      mode.home = 'ok'
      fireEvent.press(screen.getByTestId('emoji-retry'))
      await waitFor(() => expect(screen.getByTestId('emoji-cell-:blob:')).toBeTruthy())
      expect(screen.queryByTestId('emoji-retry')).toBeNull()
    } finally {
      restore()
    }
  })
})
