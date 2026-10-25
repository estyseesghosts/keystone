// Repair X2.5: link-preview pref matrix × visibility, and the
// auto-translate visibility gate. Presentational PostCard (no session
// providers), so `linkPreviewMode` is injected explicitly — the live
// card injects the device pref.
import {act, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'
import type {ReactNode} from 'react'

import {clearPreviewCache, type Translation} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {makePost} from '#/components/__tests__/fixtures'
import {PostCard} from '#/components/Post/index'
import type {LinkPreviewMode} from '#/state/privacyShield'

// expo-video has no Jest native module: stub the player/hook boundary
// (PostCard pulls it in via PostMediaGrid/Lightbox).
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

i18n.load('en', {})
i18n.activate('en')

function renderCard(ui: ReactNode) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

const SESSION = 'sess-x25'
const URL = 'https://example.com/x25-article'

function postWithLink(id: string, visibility: 'public' | 'quiet' | 'followers' | 'direct') {
  return makePost({
    id,
    card: null,
    visibility: {kind: visibility, localOnly: false, raw: visibility},
    content: {mfm: `see ${URL} ok`, plain: `see ${URL} ok`},
  })
}

function renderRow(id: string, mode: LinkPreviewMode, visibility: 'public' | 'quiet' | 'followers' | 'direct') {
  renderCard(<PostCard post={postWithLink(id, visibility)} sessionId={SESSION} linkPreviewMode={mode} />)
}

describe('PostCard link-preview policy (repair X2.5, D5)', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    clearPreviewCache()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('tap (default pref): trigger, no automatic fetch — public or private', () => {
    const fetchMock = jest.fn(async (): Promise<Response> => {
      throw new Error('tap must not fetch')
    })
    globalThis.fetch = fetchMock as never
    renderRow('x25-tap-pub', 'tap', 'public')
    expect(screen.getByTestId('post-unfurl-x25-tap-pub')).toBeTruthy()
    expect(screen.getByTestId('post-unfurl-x25-tap-pub-preview')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auto-public: public posts fetch on mount without a tap', async () => {
    const html =
      '<!doctype html><html><head><meta property="og:title" content="Auto public"></head><body></body></html>'
    globalThis.fetch = (async () => new Response(html, {status: 200})) as never
    renderRow('x25-auto-pub', 'auto-public', 'public')
    expect(await screen.findByText('Auto public')).toBeTruthy()
  })

  it.each(['followers', 'direct'] as const)(
    'auto-public: %s posts never fetch automatically',
    visibility => {
      const fetchMock = jest.fn(async (): Promise<Response> => {
        throw new Error('private posts must not auto-unfurl')
      })
      globalThis.fetch = fetchMock as never
      const id = `x25-auto-${visibility}`
      renderRow(id, 'auto-public', visibility)
      // The tap trigger stays (the user can still choose to load it).
      expect(screen.getByTestId(`post-unfurl-${id}`)).toBeTruthy()
      expect(screen.getByTestId(`post-unfurl-${id}-preview`)).toBeTruthy()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('auto-public: unlisted (quiet) posts never fetch automatically', () => {
    const fetchMock = jest.fn(async (): Promise<Response> => {
      throw new Error('quiet posts must not auto-unfurl')
    })
    globalThis.fetch = fetchMock as never
    renderRow('x25-auto-quiet', 'auto-public', 'quiet')
    expect(screen.getByTestId('post-unfurl-x25-auto-quiet-preview')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('off: no unfurl card at all, and no fetch', () => {
    const fetchMock = jest.fn(async (): Promise<Response> => {
      throw new Error('off must not fetch')
    })
    globalThis.fetch = fetchMock as never
    renderRow('x25-off', 'off', 'public')
    expect(screen.queryByTestId('post-unfurl-x25-off')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PostCard auto-translate gate (repair X2.5)', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function renderTranslatable(id: string, visibility: 'public' | 'followers' | 'direct') {
    const fetch = jest.fn(
      async (_postId: string, _lang: string): Promise<Translation> => ({
        sourceLang: 'es',
        text: 'texto traducido diferente',
      }),
    )
    renderCard(
      <PostCard
        post={makePost({
          id,
          card: null,
          visibility: {kind: visibility, localOnly: false, raw: visibility},
          content: {mfm: 'hello world, this is a longer English post', plain: 'hello world, this is a longer English post'},
        })}
        sessionId={`sess-x25-tr-${id}`}
        translationSource={{supported: true, targetLang: 'en', fetch}}
        linkPreviewMode="off"
      />,
    )
    return fetch
  }

  it('auto-translates public posts', async () => {
    const fetch = renderTranslatable('x25-tr-pub', 'public')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })

  it.each(['followers', 'direct'] as const)('never auto-translates %s posts', async visibility => {
    const fetch = renderTranslatable(`x25-tr-${visibility}`, visibility)
    // Flush effects and microtasks: the auto path fires its fetch
    // synchronously inside the mount effect, so a settled tree with no
    // call means the gate held (no fetch ever fires later either — the
    // request is marked per post id and never retried).
    await act(async () => {})
    expect(fetch).not.toHaveBeenCalled()
    // The original body stays, with no translation header.
    expect(screen.getByTestId(`post-body-x25-tr-${visibility}`)).toBeTruthy()
  })
})
