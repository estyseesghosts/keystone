// PostCard translation gates: same-language skip (fetch + render),
// tag/link-only fetch skip, original-tag wiring, and the manual path.
// The frozen-contract helpers (`isSameLanguagePost`,
// `hasTranslatableNodes`, `originalTagsOf`) are provided here through the
// `@keystone/fedi` mock (repo pattern: `mockBackendHolder` in
// Conversations.test.tsx) — PostCard reads them off the module, so the
// call sites are exercised exactly as they will run once the helpers land.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'
import {ApiError} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'
import type {TranslationSource} from '#/components/Post/PostCard'
import {
  isTranslateBlocked,
  recordTranslateOutcome,
  resetTranslationBreakerForTest,
} from '#/components/Post/translationBreaker'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import type {TokenVault} from '#/storage'

import {makePost} from './fixtures'

// expo-video has no Jest native module: stub the player/hook boundary
// (same stub as post.test.tsx).
jest.mock('expo-video', () => {
  const React = require('react')
  const {View} = require('react-native')
  return {
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({remove: jest.fn()}),
    }),
    VideoView: ({testID}: {testID?: string}) => <View testID={testID} />,
  }
})

const mockBackendHolder: {current: any} = {current: null}

jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  backendForSession: () => mockBackendHolder.current,
  // Frozen-contract helpers: provided by the mock until the shared
  // rendering slice lands them for real.
  hasTranslatableNodes: jest.fn(() => true),
  originalTagsOf: jest.fn(() => []),
  contentFromTranslatedText: jest.fn((...args: unknown[]) =>
    (
      jest.requireActual('@keystone/fedi').contentFromTranslatedText as (
        ...a: unknown[]
      ) => unknown
    )(...args),
  ),
}))

const fediMock = jest.requireMock('@keystone/fedi') as {
  hasTranslatableNodes: jest.Mock
  originalTagsOf: jest.Mock
  contentFromTranslatedText: jest.Mock
}

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-tr'

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function source(
  fetch: TranslationSource['fetch'],
  extra?: Partial<TranslationSource>,
): TranslationSource {
  return {supported: true, targetLang: 'en', fetch, ...extra}
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBackendHolder.current = null
  resetTranslationBreakerForTest()
  fediMock.hasTranslatableNodes.mockReturnValue(true)
  fediMock.originalTagsOf.mockReturnValue([])
})

describe('translation same-language gates', () => {
  it('auto-fetch skips a post whose known source language matches the viewer', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'en',
      text: 'Hello world wave',
    }))
    renderCard(
      <PostCard
        post={makePost({id: 'sl1'})}
        sessionId={SESSION}
        translationSource={source(fetch, {sourceLang: 'en'})}
      />,
    )
    // Let any would-be request land.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
    expect(screen.getByTestId('post-body-sl1')).toBeTruthy()
    expect(screen.queryByTestId('post-translation-sl1')).toBeNull()
    expect(screen.queryByTestId('translation-toggle-sl1')).toBeNull()
  })

  it('auto-fetch still fires when the known source language differs', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard
        post={makePost({id: 'sl2'})}
        sessionId={SESSION}
        translationSource={source(fetch, {sourceLang: 'es'})}
      />,
    )
    expect(await screen.findByTestId('post-translation-sl2')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('sl2', 'en')
  })

  it('a fetched translation whose source matches the viewer discards to the original', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'en',
      text: 'A thoroughly rewritten English body that shares no words',
    }))
    renderCard(
      <PostCard
        post={makePost({id: 'sl3'})}
        sessionId={SESSION}
        translationSource={source(fetch)}
      />,
    )
    // The fetch itself is honest (the source was unknown up front)…
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    // …but the redundant result never renders: original stays, no header.
    await waitFor(() =>
      expect(screen.getByTestId('post-body-sl3')).toBeTruthy(),
    )
    expect(screen.queryByTestId('post-translation-sl3')).toBeNull()
    expect(screen.queryByTestId('translation-toggle-sl3')).toBeNull()
  })
})

describe('translation tag/link-only gate', () => {
  const tagOnly = () =>
    makePost({
      id: 'tag1',
      content: {mfm: '#photo #art', plain: '#photo #art'},
      tags: ['photo', 'art'],
    })

  it('auto-fetch skips tag-only bodies (helper consulted on the parsed nodes)', async () => {
    fediMock.hasTranslatableNodes.mockReturnValue(false)
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard
        post={tagOnly()}
        sessionId={SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
    expect(fediMock.hasTranslatableNodes).toHaveBeenCalled()
    // The gate runs on the parsed body nodes, not the raw string.
    expect(
      Array.isArray(fediMock.hasTranslatableNodes.mock.calls[0]?.[0]),
    ).toBe(true)
    expect(screen.getByTestId('post-body-tag1')).toBeTruthy()
    expect(screen.queryByTestId('translation-toggle-tag1')).toBeNull()
  })

  it('auto-fetch fires for the same body when the helper reports prose', async () => {
    fediMock.hasTranslatableNodes.mockReturnValue(true)
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard
        post={tagOnly()}
        sessionId={SESSION}
        translationSource={source(fetch)}
      />,
    )
    expect(await screen.findByTestId('post-translation-tag1')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('real helper end to end: tag-only MFM bodies report no translatable nodes', async () => {
    // Defer to the REAL `hasTranslatableNodes`: a body of bare hashtags
    // must skip the fetch with no mock standing in.
    const actual = jest.requireActual('@keystone/fedi') as {
      hasTranslatableNodes: (nodes: unknown[]) => boolean
    }
    fediMock.hasTranslatableNodes.mockImplementation(
      actual.hasTranslatableNodes,
    )
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard
        post={tagOnly()}
        sessionId={SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
    expect(screen.getByTestId('post-body-tag1')).toBeTruthy()
  })
})

describe('translation original-tag wiring', () => {
  it('passes originalTagsOf(fullNodes) into the translated render', async () => {
    // Defer to the REAL helper: the original's `#photo` must surface as
    // the routing tag for the translated hashtag construct.
    const actual = jest.requireActual('@keystone/fedi') as {
      originalTagsOf: (nodes: unknown[]) => string[]
    }
    fediMock.originalTagsOf.mockImplementation(actual.originalTagsOf)
    const onHashtagPress = jest.fn()
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      // Bare hashtag URL: the translated `#foto` construct pairs
      // positionally with the original `#photo`.
      text: 'Mira https://mastodon.example/tags/foto del viaje',
    }))
    renderCard(
      <PostCard
        post={makePost({
          id: 'tags1',
          content: {
            mfm: 'See this #photo from the trip',
            plain: 'See this #photo from the trip',
          },
          tags: ['photo'],
        })}
        sessionId={SESSION}
        translationSource={source(fetch)}
        onHashtagPress={onHashtagPress}
      />,
    )
    expect(await screen.findByTestId('post-translation-tags1')).toBeTruthy()
    expect(fediMock.originalTagsOf).toHaveBeenCalled()
    expect(Array.isArray(fediMock.originalTagsOf.mock.calls[0]?.[0])).toBe(true)
    // The translated body parses with the ORIGINAL tags, so translated
    // hashtags route to the original tag page.
    expect(fediMock.contentFromTranslatedText).toHaveBeenCalledWith(
      'Mira https://mastodon.example/tags/foto del viaje',
      ['photo'],
    )
    // End to end: the translated label shows, but the tap routes to the
    // ORIGINAL tag — never the translated one.
    expect(screen.getByText('#foto')).toBeTruthy()
    fireEvent.press(screen.getByText('#foto'))
    expect(onHashtagPress).toHaveBeenCalledWith('photo')
  })
})

describe('translation live card (Mastodon path)', () => {
  const memVault = (): TokenVault => ({
    getToken: () => Promise.resolve(null),
    setToken: () => Promise.resolve(),
    removeToken: () => Promise.resolve(),
  })

  async function renderLive(post: ReturnType<typeof makePost>, backend: any) {
    mockBackendHolder.current = backend
    const sessionStore = createSessionStore({
      storage: createMemoryStore(),
      vault: memVault(),
      homeOrigin: 'https://app.example',
    })
    const session = await sessionStore.add({
      origin: 'https://mastodon.example',
      family: 'mastodon',
      flavor: 'mastodon',
      accountId: 'alice',
      token: 'token-alice',
      grant: 'password',
      hosting: 'third-party',
    })
    const client = new QueryClient({
      defaultOptions: {queries: {retry: false, gcTime: 60_000}},
    })
    render(
      <QueryClientProvider client={client}>
        <I18nProvider i18n={i18n}>
          <ThemeProvider theme="light">
            <SessionProvider
              store={sessionStore}
              homeOrigin="https://app.example">
              <PostCard post={post} sessionId={session.id} />
            </SessionProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    )
    return {
      sessionId: session.id,
      done: () => {
        mockBackendHolder.current = null
        client.clear()
      },
    }
  }

  it('manual translate still fetches on demand for a tag-only body the auto path skips', async () => {
    fediMock.hasTranslatableNodes.mockReturnValue(false)
    const translate = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Foto arte',
    }))
    const backend = {capabilities: {translation: 'supported'}, translate}
    const post = makePost({
      id: 'live-tag1',
      content: {mfm: '#photo #art', plain: '#photo #art'},
      tags: ['photo', 'art'],
    })
    const {done} = await renderLive(post, backend)
    try {
      // Auto path skipped: no request for a tag-only body…
      await waitFor(() => expect(translate).not.toHaveBeenCalled())
      expect(screen.getByTestId('post-body-live-tag1')).toBeTruthy()
      // …but the manual row is never gated: the user explicitly asked.
      fireEvent.press(screen.getByTestId('post-menu-live-tag1'))
      fireEvent.press(screen.getByTestId('post-menu-live-tag1-item-translate'))
      expect(
        await screen.findByTestId('post-translation-live-tag1'),
      ).toBeTruthy()
      expect(translate).toHaveBeenCalledTimes(1)
      expect(translate).toHaveBeenCalledWith('live-tag1', 'en')
      expect(screen.getByText('Foto arte')).toBeTruthy()
    } finally {
      done()
    }
  })

  it('live auto path fetches for prose posts (no known source language to skip on)', async () => {
    const translate = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    const backend = {capabilities: {translation: 'supported'}, translate}
    const {done} = await renderLive(makePost({id: 'live-prose1'}), backend)
    try {
      expect(
        await screen.findByTestId('post-translation-live-prose1'),
      ).toBeTruthy()
      expect(translate).toHaveBeenCalledTimes(1)
      expect(translate).toHaveBeenCalledWith('live-prose1', 'en')
    } finally {
      done()
    }
  })

  it('manual translate is never blocked: a blocked session still translates on demand', async () => {
    const translate = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    const backend = {capabilities: {translation: 'supported'}, translate}
    const post = makePost({id: 'live-blocked-manual'})
    const {done, sessionId} = await renderLive(post, backend)
    try {
      // Auto fetch fires on mount and renders…
      expect(
        await screen.findByTestId('post-translation-live-blocked-manual'),
      ).toBeTruthy()
      expect(translate).toHaveBeenCalledTimes(1)
      // …then the endpoint starts refusing: the session trips the breaker.
      recordTranslateOutcome(sessionId, 403)
      recordTranslateOutcome(sessionId, 403)
      expect(isTranslateBlocked(sessionId)).toBe(true)
      // The explicit user tap still reaches the server (manual never
      // consults the breaker), and its result still renders.
      fireEvent.press(screen.getByTestId('post-menu-live-blocked-manual'))
      fireEvent.press(
        screen.getByTestId('post-menu-live-blocked-manual-item-translate'),
      )
      await waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
      expect(
        screen.getByTestId('post-translation-live-blocked-manual'),
      ).toBeTruthy()
    } finally {
      done()
    }
  })
})

describe('translation 403 circuit breaker (auto path)', () => {
  const BREAKER_SESSION = 'sess-breaker'

  function forbidden(): Error {
    // The real rejection shape: `ApiError` with `.status` (the guarded
    // backend adapts transport errors at its boundary).
    return new ApiError('Forbidden', 403, 'errors.network.apiError')
  }

  it('two consecutive auto 403s block further auto fetches for the session', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => {
      throw forbidden()
    })
    renderCard(
      <PostCard
        post={makePost({id: 'br1'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    renderCard(
      <PostCard
        post={makePost({id: 'br2'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    // Both refusals recorded: the session trips the breaker.
    await waitFor(() => expect(isTranslateBlocked(BREAKER_SESSION)).toBe(true))
    // A third mount never fetches: original body, silently, no header.
    renderCard(
      <PostCard
        post={makePost({id: 'br3'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    expect(screen.getByTestId('post-body-br3')).toBeTruthy()
    // Let any would-be request land, then confirm none did.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('post-translation-br3')).toBeNull()
    expect(screen.queryByTestId('translation-toggle-br3')).toBeNull()
  })

  it('transient 429 failures never block the auto path', async () => {
    const fetch: TranslationSource['fetch'] = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('Slow down', 429, 'errors.network.apiError'))
      .mockRejectedValueOnce(new ApiError('Slow down', 429, 'errors.network.apiError'))
      .mockResolvedValue({sourceLang: 'es', text: 'Hola traducido'})
    renderCard(
      <PostCard
        post={makePost({id: 'br429-1'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    renderCard(
      <PostCard
        post={makePost({id: 'br429-2'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(isTranslateBlocked(BREAKER_SESSION)).toBe(false)
    // The next mount still fetches — and a success renders.
    renderCard(
      <PostCard
        post={makePost({id: 'br429-3'})}
        sessionId={BREAKER_SESSION}
        translationSource={source(fetch)}
      />,
    )
    expect(await screen.findByTestId('post-translation-br429-3')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('the block is per session: another session still auto-fetches', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => {
      throw forbidden()
    })
    recordTranslateOutcome(BREAKER_SESSION, 403)
    recordTranslateOutcome(BREAKER_SESSION, 403)
    expect(isTranslateBlocked(BREAKER_SESSION)).toBe(true)
    renderCard(
      <PostCard
        post={makePost({id: 'br-other'})}
        sessionId="sess-breaker-other"
        translationSource={source(fetch)}
      />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(isTranslateBlocked('sess-breaker-other')).toBe(false)
  })
})
