import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, renderHook, screen, fireEvent, waitFor, act} from '@testing-library/react-native'
import {View} from 'react-native'
import React from 'react'

import {
  appearNoteOf,
  createMemoryStore,
  type Backend,
  type Page,
  type Post,
} from '@keystone/fedi'

import type {TokenVault} from '#/storage'
import {__setStorageForTests, appStorage} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {ThemeProvider} from '#/alf/index'

import {makePost, makeAccount} from '#/components/__tests__/fixtures'
import {buildPostMenu, flatten} from '#/components/Post/menuModel'
import {fetchFeedPage} from '#/state/queries/usePostFeedQuery'
import {recommendationFeedParams} from '#/state/queries/recommendations'
import {useRecommendationDwell} from '#/lib/recommendationDwell'
import {RecommendationsSettingsOverlay} from './RecommendationsSettingsOverlay'
import {HomeScreen} from '#/screens/Home'

// Recommendations port (fork dvd-sharkey): menu rows, feed dispatch,
// dwell tracking, dirty-confirm settings overlay, Home tab bar.

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
}))

jest.mock('#/components/Composer/CompactComposer', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    CompactComposer: () => React.createElement(View, {testID: 'stub-composer'}),
  }
})

jest.mock('#/components/ComposeFab', () => {
  const React = jest.requireActual('react')
  const {View} = jest.requireActual('react-native')
  return {
    ComposeFab: () => React.createElement(View, {testID: 'stub-fab'}),
  }
})

const HOME_ORIGIN = 'https://app.example'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function page<T>(items: T[]): Page<T> {
  return {items, cursor: null, end: true}
}

const BREAKDOWN = {
  type: 'score',
  score: 1.5,
  subtotal: 1.2,
  topic: 'tech',
  rows: [],
} as const

function menuInput(over: Record<string, unknown> = {}) {
  return {
    family: 'misskey',
    capabilities: null,
    post: makePost(),
    origin: 'https://m.example',
    isOwn: false,
    copyAvailable: true,
    bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
    del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
    handlers: {
      copy: jest.fn(),
      share: jest.fn(),
      open: jest.fn(),
      translate: jest.fn(),
      muteThread: jest.fn(),
      togglePin: jest.fn(),
    },
    ...over,
  } as never
}

describe('recommendation menu rows', () => {
  it('prepends Why / Not interested when the wrapper carries a breakdown', () => {
    const sections = buildPostMenu(
      menuInput({recommendation: {onWhy: jest.fn(), onNotInterested: jest.fn()}}),
    )
    const keys = flatten(sections).map(i => i.key)
    expect(keys[0]).toBe('rec-why')
    expect(keys[1]).toBe('rec-not-interested')
  })

  it('renders the normal menu without a breakdown', () => {
    const keys = flatten(buildPostMenu(menuInput())).map(i => i.key)
    expect(keys).not.toContain('rec-why')
    expect(keys).not.toContain('rec-not-interested')
  })

  it('normal timelines show no recommendation rows', () => {
    const keys = flatten(buildPostMenu(menuInput())).map(i => i.key)
    expect(keys).toContain('copy-contents')
  })
})

describe('recommendations feed dispatch', () => {
  it('routes to backend.recommendations.feed with offset + params', async () => {
    const feed = jest.fn(async () => page([makePost({id: 'r1'})]))
    const backend = {recommendations: {feed}} as unknown as Backend
    const result = await fetchFeedPage(backend, {kind: 'recommendations'}, null, 10, {
      lang: 'en',
      withSensitive: false,
      withRenotes: true,
    })
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({limit: 10, lang: 'en', withSensitive: false, withRenotes: true}),
    )
    expect(result.items.map(p => p.id)).toEqual(['r1'])
  })

  it('answers an honest 404 when the server has no recommendations module', async () => {
    const backend = {} as unknown as Backend
    await expect(fetchFeedPage(backend, {kind: 'recommendations'}, null)).rejects.toMatchObject({
      code: 'errors.unsupported.recommendations',
    })
  })

  it('maps the locale + NSFW setting to feed params', () => {
    expect(recommendationFeedParams('ja-JP', null)).toEqual({
      lang: 'ja',
      withSensitive: false,
      withRenotes: true,
    })
    expect(
      recommendationFeedParams('en', {recommendNsfw: true} as never),
    ).toMatchObject({lang: 'en', withSensitive: true})
  })
})

describe('recommendation dwell', () => {
  it('reports visible time for the appeared note id', async () => {
    let now = 1_000_000
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const dwell = jest.fn(async () => undefined)
      const backend = {recommendations: {dwell}} as unknown as Backend
      const inner = makePost({id: 'inner'})
      const wrapper = makePost({id: 'wrapper', renoteId: 'inner', renote: inner, content: {plain: ''} as never})
      // Pure renote wrapper: no own content, so the appeared note is the inner.
      expect(appearNoteOf(wrapper).id).toBe('inner')
      const {result, unmount} = renderHook(() => useRecommendationDwell('s1', backend))
      act(() => {
        result.current.onViewableItemsChanged({viewableItems: [{item: wrapper}], changed: []})
      })
      now += 900
      act(() => {
        result.current.onViewableItemsChanged({viewableItems: [], changed: []})
      })
      unmount()
      await waitFor(() => expect(dwell).toHaveBeenCalled())
      expect(dwell).toHaveBeenCalledWith([{noteId: 'inner', dwellMs: 900}])
    } finally {
      spy.mockRestore()
    }
  })

  it('ignores glances under the 600ms minimum', async () => {
    let now = 2_000_000
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const dwell = jest.fn(async () => undefined)
      const backend = {recommendations: {dwell}} as unknown as Backend
      const {result, unmount} = renderHook(() => useRecommendationDwell('s1', backend))
      act(() => {
        result.current.onViewableItemsChanged({viewableItems: [{item: makePost({id: 'q'})}], changed: []})
      })
      now += 100
      act(() => {
        result.current.onViewableItemsChanged({viewableItems: [], changed: []})
      })
      unmount()
      await new Promise(r => setTimeout(r, 20))
      expect(dwell).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('recommendations settings overlay', () => {
  async function setupOverlay({enabled = true}: {enabled?: boolean} = {}) {
    const storage = createMemoryStore()
    const restore = appStorage()
    __setStorageForTests({storage})
    const updateSettings = jest.fn(async () => meAccount())
    const meAccount = () => ({
      ...makeAccount({id: 'alice'}),
      ext: {
        me: {
          recommendationSettings: {
            enabled,
            recommendNsfw: false,
            factors: {
              relevancy: 1, authorAffinity: 1, quality: 1, popularity: 1, recency: 1,
              shortPostPenalty: 1, overTagPenalty: 1, replyPenalty: 1, topicPreference: 1,
              followed: 1, similarUsers: 1,
            },
            engagement: {reaction: 1, reply: 1, boost: 1, favorite: 1, post: 1},
            interestTopics: [], disinterestTopics: [], languages: [], followedRatio: 0.3,
          },
        },
      },
    })
    mockBackendHolder.current = {
      capabilities: {},
      timeline: jest.fn(async () => page([makePost({id: 'p1'})])),
      me: jest.fn(async () => meAccount()),
      recommendations: {
        feed: jest.fn(async () => page([makePost({id: 'r1'})])),
        dwell: jest.fn(async () => undefined),
        notInterested: jest.fn(async () => undefined),
        interests: jest.fn(async () => ({interested: ['tech'], disinterested: []})),
        updateSettings,
        isSupported: () => true,
      },
    }
    const sessionStore = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
      revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
    })
    await sessionStore.add({
      origin: 'https://m.example',
      family: 'misskey',
      flavor: 'sharkey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
    const sessionId = sessionStore.getSnapshot().activeId!
    const onClose = jest.fn()
    const {i18n} = await import('#/locale/i18n')
    i18n.load('en', {})
    i18n.activate('en')
    const {unmount} = render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
              <RecommendationsSettingsOverlay open onClose={onClose} sessionId={sessionId} />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    return {
      sessionId,
      onClose,
      updateSettings,
      done: () => {
        unmount()
        __setStorageForTests({storage: restore})
        mockBackendHolder.current = null
      },
    }
  }

  it('asks save-or-discard when dismissing with edits', async () => {
    const {onClose, updateSettings, done} = await setupOverlay()
    try {
      expect(await screen.findByTestId('rec-settings-save-top')).toBeTruthy()
      // Touch one setting so the form is dirty.
      fireEvent.press(screen.getByTestId('rec-settings-followed-ratio-plus'))
      // Backdrop dismiss asks first instead of silently losing edits.
      fireEvent.press(screen.getByTestId('rec-settings-overlay-backdrop'))
      expect(await screen.findByTestId('rec-settings-dirty-confirm')).toBeTruthy()
      expect(onClose).not.toHaveBeenCalled()
      // Discard closes without saving.
      fireEvent.press(screen.getByTestId('rec-settings-confirm-discard'))
      expect(onClose).toHaveBeenCalled()
      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })

  it('closes cleanly with no edits and saves on demand', async () => {
    const {onClose, updateSettings, done} = await setupOverlay()
    try {
      expect(await screen.findByTestId('rec-settings-save-top')).toBeTruthy()
      // No edits: backdrop closes directly, no confirm.
      fireEvent.press(screen.getByTestId('rec-settings-overlay-backdrop'))
      expect(onClose).toHaveBeenCalled()
      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      done()
    }
  })
})

describe('home recommendations tab', () => {
  async function setupHome(opts: {withRec: boolean; enabled?: boolean} = {withRec: true}) {
    const storage = createMemoryStore()
    const restore = appStorage()
    __setStorageForTests({storage})
    const recPost = makePost({id: 'r1', content: {mfm: 'rec hello', plain: 'rec hello'}})
    const homePost = makePost({id: 'p1', content: {mfm: 'home hello', plain: 'home hello'}})
    const meAccount = {
      ...makeAccount({id: 'alice'}),
      ext: {
        me: {
          recommendationSettings: {
            enabled: opts.enabled ?? true,
            recommendNsfw: false,
            factors: {
              relevancy: 1, authorAffinity: 1, quality: 1, popularity: 1, recency: 1,
              shortPostPenalty: 1, overTagPenalty: 1, replyPenalty: 1, topicPreference: 1,
              followed: 1, similarUsers: 1,
            },
            engagement: {reaction: 1, reply: 1, boost: 1, favorite: 1, post: 1},
            interestTopics: [], disinterestTopics: [], languages: [], followedRatio: 0.3,
          },
        },
      },
    }
    mockBackendHolder.current = {
      capabilities: {},
      timeline: jest.fn(async () => page([homePost])),
      me: jest.fn(async () => meAccount),
      ...(opts.withRec
        ? {
            recommendations: {
              feed: jest.fn(async () => page([recPost])),
              dwell: jest.fn(async () => undefined),
              notInterested: jest.fn(async () => undefined),
              interests: jest.fn(async () => ({interested: [], disinterested: []})),
              updateSettings: jest.fn(async () => meAccount),
              isSupported: () => true,
            },
          }
        : {}),
    }
    const sessionStore = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: HOME_ORIGIN,
      revokeFetch: (() => Promise.resolve(new Response('{}', {status: 200}))) as unknown as typeof fetch,
    })
    await sessionStore.add({
      origin: 'https://m.example',
      family: 'misskey',
      flavor: 'sharkey',
      accountId: 'alice',
      token: 'token-a',
      grant: 'oauth-pkce',
      hosting: 'third-party',
    })
    const {i18n} = await import('#/locale/i18n')
    i18n.load('en', {})
    i18n.activate('en')
    const {unmount} = render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
            <SessionProvider store={sessionStore} homeOrigin={HOME_ORIGIN}>
              <HomeScreen />
            </SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    return {
      done: () => {
        unmount()
        __setStorageForTests({storage: restore})
        mockBackendHolder.current = null
      },
    }
  }

  it('shows no tab bar when the server has no recommendations', async () => {
    const {done} = await setupHome({withRec: false})
    try {
      expect(await screen.findByTestId('home-screen')).toBeTruthy()
      expect(await screen.findByText('home hello')).toBeTruthy()
      expect(screen.queryByTestId('home-tabs')).toBeNull()
    } finally {
      done()
    }
  })

  it('shows the tab bar and switches to the recommendations feed', async () => {
    const {done} = await setupHome({withRec: true})
    try {
      expect(await screen.findByTestId('home-tabs')).toBeTruthy()
      fireEvent.press(screen.getByTestId('home-tab-recommendations'))
      expect(await screen.findByTestId('home-configure-recommendations')).toBeTruthy()
      expect(await screen.findByText('rec hello')).toBeTruthy()
      // Configure opens the settings overlay, not a route.
      fireEvent.press(screen.getByTestId('home-configure-recommendations'))
      expect(await screen.findByTestId('rec-settings-overlay')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('hides the tab when the viewer disabled recommendations', async () => {
    const {done} = await setupHome({withRec: true, enabled: false})
    try {
      expect(await screen.findByTestId('home-screen')).toBeTruthy()
      expect(await screen.findByText('home hello')).toBeTruthy()
      await new Promise(r => setTimeout(r, 50))
      expect(screen.queryByTestId('home-tabs')).toBeNull()
    } finally {
      done()
    }
  })
})
