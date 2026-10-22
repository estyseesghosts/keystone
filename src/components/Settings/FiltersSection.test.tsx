// WS-F filters UI: Settings → Filters is full CRUD on
// `Backend.filters` (v2 group shape + v1 fallback live in the backend —
// the screen only speaks the core `Filter` rows), and the Misskey family
// (no `filters` member) keeps the honest no-endpoint placeholder.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {SettingsScreen} from '#/screens/Settings'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({navigate: jest.fn()}),
  // The filters rows live on the `filters` settings section route.
  useRoute: () => ({params: {section: 'filters'}}),
}))

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

const HOME_ORIGIN = 'https://app.example'
const ORIGIN = 'https://m.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

const filterRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  phrase: 'spoiler',
  context: ['home', 'public'],
  expiresAt: null,
  irreversible: true,
  wholeWord: true,
  keywords: [{id: 'k1', keyword: 'spoiler', wholeWord: true}],
  ...overrides,
})

// Stateful fake: the list moves with create/update/delete, and update
// follows the backend contract — the primary keyword takes the new
// phrase, siblings keep their text/flag (never dropped, never reordered).
const filtersBackend = (seed: any[] = [filterRow()]) => {
  let items = [...seed]
  return {
    family: 'mastodon',
    capabilities: {},
    filters: {
      list: jest.fn(async () => [...items]),
      create: jest.fn(async (phrase: string, context: string[]) => {
        const row = filterRow({
          id: `f${items.length + 1}`,
          phrase,
          context,
          keywords: [{id: `k${items.length + 1}`, keyword: phrase, wholeWord: true}],
        })
        items = [...items, row]
        return row
      }),
      update: jest.fn(
        async (id: string, phrase: string, context: string[], opts: Record<string, unknown>) => {
          const prior = items.find(x => x.id === id)
          const priorKeywords: any[] = prior?.keywords?.length
            ? prior.keywords
            : [{id, keyword: prior?.phrase ?? '', wholeWord: opts?.wholeWord === true}]
          const keywords = priorKeywords.map((k, i) =>
            i === 0 ? {...k, keyword: phrase, wholeWord: opts?.wholeWord === true} : k,
          )
          const row = filterRow({id, phrase, context, ...opts, keywords})
          items = items.map(x => (x.id === id ? row : x))
          return row
        },
      ),
      delete: jest.fn(async (id: string) => {
        items = items.filter(x => x.id !== id)
      }),
    },
  }
}

async function setup({backend}: {backend?: any} = {}) {
  const storage = createMemoryStore()
  const restore = appStorage()
  __setStorageForTests({storage})
  mockBackendHolder.current = backend ?? null
  const sessionStore = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: HOME_ORIGIN,
    revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
  })
  if (backend) {
    await sessionStore.add({
      origin: ORIGIN,
      family: backend.family ?? 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
  }
  render(
    <ThemeProvider theme="light">
      <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
        <SettingsScreen />
      </SessionProvider>
    </ThemeProvider>,
  )
  return {
    done: () => {
      __setStorageForTests({storage: restore})
      mockBackendHolder.current = null
    },
  }
}

describe('Filters section CRUD (WS-F)', () => {
  it('keeps the honest placeholder when the backend has no filters member', async () => {
    const {done} = await setup({backend: {family: 'misskey', capabilities: {}}})
    try {
      expect(await screen.findByTestId('placeholder-filters')).toBeTruthy()
      expect(screen.queryByTestId('filter-list')).toBeNull()
    } finally {
      done()
    }
  })

  it('lists rows, creates a phrase, edits it in place, and removes it', async () => {
    const backend = filtersBackend()
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('filter-list')).toBeTruthy()
      expect(screen.getByText('spoiler')).toBeTruthy()

      // Create.
      fireEvent.changeText(screen.getByTestId('filter-phrase-input'), 'leak')
      fireEvent.press(screen.getByTestId('filter-add'))
      await waitFor(() => expect(backend.filters.create).toHaveBeenCalledWith('leak', [
        'home',
        'notifications',
        'public',
        'thread',
      ]))
      expect(await screen.findByText('leak')).toBeTruthy()

      // Edit the seeded row's phrase (context/flags round-trip untouched).
      fireEvent.press(screen.getByTestId('filter-edit-f1'))
      fireEvent.changeText(screen.getByTestId('filter-edit-input-f1'), 'spoilers!')
      fireEvent.press(screen.getByTestId('filter-save-f1'))
      await waitFor(() =>
        expect(backend.filters.update).toHaveBeenCalledWith('f1', 'spoilers!', ['home', 'public'], {
          expiresAt: null,
          irreversible: true,
          wholeWord: true,
        }),
      )
      expect(await screen.findByText('spoilers!')).toBeTruthy()

      // Remove.
      fireEvent.press(screen.getByTestId('filter-remove-f1'))
      await waitFor(() => expect(backend.filters.delete).toHaveBeenCalledWith('f1'))
      await waitFor(() => expect(screen.queryByText('spoilers!')).toBeNull())
    } finally {
      done()
    }
  })

  it('shows every keyword of a v2 group and edits only the primary in place', async () => {
    const backend = filtersBackend([
      filterRow({
        id: 'g1',
        phrase: 'alpha',
        wholeWord: false,
        keywords: [
          {id: 'k1', keyword: 'alpha', wholeWord: false},
          {id: 'k2', keyword: 'beta', wholeWord: true},
        ],
      }),
    ])
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('filter-list')).toBeTruthy()
      // The row is the whole group, not just its first keyword.
      expect(screen.getByTestId('filter-text-g1')).toHaveTextContent('alpha, beta')

      fireEvent.press(screen.getByTestId('filter-edit-g1'))
      // The field edits the primary keyword; the sibling is shown, not
      // silently folded into the text field.
      expect(screen.getByTestId('filter-edit-input-g1').props.value).toBe('alpha')
      expect(screen.getByTestId('filter-edit-others-g1')).toHaveTextContent(/beta/)

      fireEvent.changeText(screen.getByTestId('filter-edit-input-g1'), 'alpha edited')
      fireEvent.press(screen.getByTestId('filter-save-g1'))
      await waitFor(() =>
        expect(backend.filters.update).toHaveBeenCalledWith('g1', 'alpha edited', ['home', 'public'], {
          expiresAt: null,
          irreversible: true,
          wholeWord: false,
        }),
      )
      // The update path kept the sibling: the row still shows both.
      expect(await screen.findByText('alpha edited, beta')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('surfaces backend failures without losing the list', async () => {
    const backend = filtersBackend()
    backend.filters.delete = jest.fn(async (_id: string) => {
      throw new Error('nope')
    })
    const {done} = await setup({backend})
    try {
      expect(await screen.findByTestId('filter-list')).toBeTruthy()
      fireEvent.press(screen.getByTestId('filter-remove-f1'))
      await waitFor(() => expect(backend.filters.delete).toHaveBeenCalled())
      // The row stays (the delete failed) and the error surfaces.
      expect(screen.getByText('spoiler')).toBeTruthy()
      expect(screen.getByText('nope')).toBeTruthy()
    } finally {
      done()
    }
  })
})
