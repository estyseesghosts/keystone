// F12: server link-card preview. E9: honest client unfurl.
import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {
  clearPreviewCache,
  contentFromHtml,
  contentFromMfm,
  fetchLinkPreview,
  type LinkCard as LinkCardModel,
  type LinkPreview,
  type PreviewFetch,
} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {makePost} from '#/components/__tests__/fixtures'
import {PostCard} from '#/components/Post/index'
import {firstBareUrl, LinkCard, UnfurledLinkCard} from '#/components/Post/LinkCard'

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

function card(over: Partial<LinkCardModel> = {}): LinkCardModel {
  return {
    url: 'https://example.com/article',
    title: 'An article',
    description: 'Read all about it.',
    image: 'https://example.com/cover.png',
    type: 'link',
    authorName: null,
    authorUrl: null,
    providerName: null,
    ...over,
  }
}

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('LinkCard (F12)', () => {
  it('renders title, description, and host', () => {
    renderCard(<LinkCard card={card()} testID="lc" />)
    expect(screen.getByText('An article')).toBeTruthy()
    expect(screen.getByText('Read all about it.')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('renders nothing for an unsafe card URL', () => {
    const {toJSON} = renderCard(<LinkCard card={card({url: 'javascript:alert(1)'})} testID="lc" />)
    expect(toJSON()).toBeNull()
  })

  it('prefers the server provider name over the bare host', () => {
    renderCard(<LinkCard card={card({providerName: 'Example News'})} testID="lc" />)
    expect(screen.getByText('Example News')).toBeTruthy()
    expect(screen.queryByText('example.com')).toBeNull()
  })
})

describe('firstBareUrl (E9 trigger)', () => {
  const URL = 'https://example.com/article'
  const mfmNodes = (mfm: string) => contentFromMfm(mfm)

  it('finds a bare URL in MFM body nodes', () => {
    expect(firstBareUrl(mfmNodes(`see ${URL} ok`))).toBe(URL)
  })

  it('returns the first of several bare URLs', () => {
    expect(firstBareUrl(mfmNodes(`${URL} then https://example.com/other`))).toBe(URL)
  })

  it('skips labeled links (anchor text is not the URL)', () => {
    const nodes = contentFromHtml(`<p><a href="${URL}">a label</a></p>`)
    expect(firstBareUrl(nodes)).toBeNull()
  })

  it('skips quote-covered URIs', () => {
    expect(firstBareUrl(mfmNodes(`see ${URL} ok`), [URL])).toBeNull()
  })

  it('skips unsafe URLs', () => {
    expect(firstBareUrl(mfmNodes('see javascript:alert(1) ok'))).toBeNull()
  })

  it('finds nothing in plain text', () => {
    expect(firstBareUrl(mfmNodes('no links here'))).toBeNull()
  })
})

describe('UnfurledLinkCard (E9)', () => {
  const URL = 'https://example.com/unfurl-e9'
  const PREVIEW: LinkPreview = {
    title: 'Unfurled title',
    description: 'Unfurled description',
    siteName: 'Example',
    image: 'https://example.com/cover.png',
    icon: null,
  }

  beforeEach(() => {
    clearPreviewCache()
  })

  it('idle shows the host with a Preview trigger and fetches nothing', () => {
    const fetchPreview = jest.fn(async (_url: string) => PREVIEW)
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByTestId('uf-preview')).toBeTruthy()
    expect(screen.queryByText('Unfurled title')).toBeNull()
    expect(fetchPreview).not.toHaveBeenCalled()
  })

  it('tapping Preview unfurls once: title, description, and host', async () => {
    const fetchPreview = jest.fn(async (_url: string) => PREVIEW)
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(await screen.findByText('Unfurled title')).toBeTruthy()
    expect(screen.getByText('Unfurled description')).toBeTruthy()
    expect(fetchPreview).toHaveBeenCalledTimes(1)
    expect(fetchPreview).toHaveBeenCalledWith(URL)
  })

  it('unfurled card shows the site name, falling back to the host', async () => {
    const fetchPreview = jest.fn(async (_url: string) => PREVIEW)
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(await screen.findByText('Example')).toBeTruthy()
    expect(screen.queryByText('example.com')).toBeNull()
  })

  it('unfurled card without a site name falls back to the host', async () => {
    const fetchPreview = jest.fn(async (_url: string) => ({...PREVIEW, siteName: undefined}))
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(await screen.findByText('Unfurled title')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('a single tap fetches exactly once', async () => {
    let calls = 0
    const fetchPreview = async (_url: string): Promise<LinkPreview | null> => {
      calls += 1
      return PREVIEW
    }
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    // The trigger unmounts on first press (loading state), so a second
    // press is impossible — assert the fetch flew exactly once.
    expect(await screen.findByText('Unfurled title')).toBeTruthy()
    expect(calls).toBe(1)
  })

  it('a failed fetch keeps the honest basic card', async () => {
    const fetchPreview = jest.fn(async (_url: string): Promise<LinkPreview | null> => null)
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(await screen.findByTestId('uf')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(fetchPreview).toHaveBeenCalledTimes(1)
  })

  it('a rejecting fetch keeps the honest basic card', async () => {
    const fetchPreview = jest.fn(async (_url: string): Promise<LinkPreview | null> => {
      throw new Error('offline')
    })
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={fetchPreview} testID="uf" />)
    fireEvent.press(screen.getByTestId('uf-preview'))
    expect(await screen.findByTestId('uf')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('a second view of the same URL costs no fetch (module cache)', async () => {
    // Both mounts wire through the real module fetcher; only the
    // underlying transport is stubbed. The second mount's transport
    // throws — the module cache must answer instead.
    const html =
      '<!doctype html><html><head><meta property="og:title" content="Cached title"></head><body></body></html>'
    const first: PreviewFetch = jest.fn(async () => new Response(html, {status: 200}))
    const viaFirst = (pageUrl: string) => fetchLinkPreview(pageUrl, {fetchImpl: first, proxy: null})
    const {unmount} = renderCard(
      <UnfurledLinkCard url={URL} fetchPreview={viaFirst} testID="uf1" />,
    )
    fireEvent.press(screen.getByTestId('uf1-preview'))
    expect(await screen.findByText('Cached title')).toBeTruthy()
    expect(first).toHaveBeenCalledTimes(1)
    unmount()
    const second: PreviewFetch = jest.fn(async () => {
      throw new Error('must not fetch: cache should answer')
    })
    const viaSecond = (pageUrl: string) =>
      fetchLinkPreview(pageUrl, {fetchImpl: second, proxy: null})
    renderCard(<UnfurledLinkCard url={URL} fetchPreview={viaSecond} testID="uf2" />)
    fireEvent.press(screen.getByTestId('uf2-preview'))
    expect(await screen.findByText('Cached title')).toBeTruthy()
    expect(second).not.toHaveBeenCalled()
  })

  it('renders nothing for an unsafe URL', () => {
    const {toJSON} = renderCard(
      <UnfurledLinkCard url="javascript:alert(1)" testID="uf" />,
    )
    expect(toJSON()).toBeNull()
  })
})

describe('PostCard unfurl trigger (E9)', () => {
  const SESSION = 'sess-1'
  const URL = 'https://example.com/trigger-e9'

  it('a bare URL with no server card renders the tap-to-unfurl trigger', () => {
    renderCard(
      <PostCard
        post={makePost({
          id: 'u1',
          card: null,
          content: {mfm: `see ${URL} ok`, plain: `see ${URL} ok`},
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('post-unfurl-u1')).toBeTruthy()
    expect(screen.getByTestId('post-unfurl-u1-preview')).toBeTruthy()
    expect(screen.queryByTestId('post-card-u1')).toBeNull()
  })

  it('a server card wins over the bare URL: one card, never two', () => {
    renderCard(
      <PostCard
        post={makePost({
          id: 'u2',
          card: {
            url: 'https://other.example/s',
            title: 'Server title',
            description: 'Server description',
            image: null,
            type: 'link',
            authorName: null,
            authorUrl: null,
            providerName: null,
          },
          content: {mfm: `see ${URL} ok`, plain: `see ${URL} ok`},
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('post-card-u2')).toBeTruthy()
    expect(screen.queryByTestId('post-unfurl-u2')).toBeNull()
  })

  it('a post with no URLs renders no card at all', () => {
    renderCard(
      <PostCard
        post={makePost({
          id: 'u3',
          card: null,
          content: {mfm: 'no links here', plain: 'no links here'},
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.queryByTestId('post-unfurl-u3')).toBeNull()
    expect(screen.queryByTestId('post-card-u3')).toBeNull()
  })
})
