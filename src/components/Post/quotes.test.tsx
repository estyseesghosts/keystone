// WS-A full-mile quotes: structured, URI-fallback, Mastodon policy,
// marker strip/keep. PostCard-level behavior + the pure strip matrix.
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'

import type {Post} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'
import {PostQuote} from '#/components/Post/PostQuote'
import {postBodyNodes} from '#/components/Post/body'
import {createAppearanceStore} from '#/state/appearance'
import {QuotePolicyRow} from '#/components/Settings/DisplaySection'
import {createMemoryStore} from '@keystone/fedi'

import {makePost} from '../__tests__/fixtures'

// expo-video has no Jest native module: stub the player/hook boundary.
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

function renderCard(ui: React.ReactElement, theme: 'light' | 'dark' = 'light') {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

const SESSION = 'sess-1'
const QUOTED_URI = 'https://remote.example/notes/1'

function quotedPost(): Post {
  return makePost({id: 'q1', uri: QUOTED_URI, url: QUOTED_URI})
}

/** A Misskey structured quote: packed renote + duplicate RE: marker. */
function packedQuotePost(): Post {
  return makePost({
    id: 'p1',
    content: {mfm: 'look at this\nRE: https://remote.example/notes/1', plain: 'look at this RE: https://remote.example/notes/1'},
    renoteId: 'q1',
    renote: quotedPost(),
    quote: quotedPost(),
  })
}

/** A structured URI-only post (Pinetree `quoteTargetUri`, no packed note). */
function uriOnlyPost(): Post {
  return makePost({
    id: 'p9',
    content: {mfm: 'look at this\nRE: https://remote.example/notes/1', plain: 'look at this RE: https://remote.example/notes/1'},
    ext: {quoteTargetUri: QUOTED_URI},
  })
}

/** A pure textual fallback: MFM `RE:` marker, no structured relationship. */
function textualPost(): Post {
  return makePost({
    id: 'pt',
    content: {mfm: 'via relay\nRE: https://remote.example/notes/1', plain: 'via relay RE: https://remote.example/notes/1'},
  })
}

describe('PostCard structured quotes (WS-A)', () => {
  it('renders the packed renote card and strips the duplicate marker', () => {
    renderCard(<PostCard post={packedQuotePost()} sessionId={SESSION} />)
    expect(screen.getByTestId('post-quote-p1-card')).toBeTruthy()
    expect(screen.queryByText(/RE:/)).toBeNull()
  })

  it('resolves a structured URI-only target: indicator, then card, marker stripped', async () => {
    let release!: (found: Post | null) => void
    const pending = new Promise<Post | null>(resolve => {
      release = resolve
    })
    const seen: string[] = []
    renderCard(
      <PostCard
        post={uriOnlyPost()}
        sessionId={SESSION}
        resolveQuoteUri={uri => {
          seen.push(uri)
          return pending
        }}
      />,
    )
    expect(screen.getByTestId('post-quote-resolving-p9')).toBeTruthy()
    expect(screen.queryByTestId('post-quote-p9-card')).toBeNull()
    await act(async () => {
      release(quotedPost())
    })
    await waitFor(() => expect(screen.getByTestId('post-quote-p9-card')).toBeTruthy())
    expect(seen).toEqual([QUOTED_URI])
    expect(screen.queryByTestId('post-quote-resolving-p9')).toBeNull()
    expect(screen.queryByText(/RE:/)).toBeNull()
  })

  it('structured URI-only failure renders unavailable with the marker stripped', async () => {
    renderCard(
      <PostCard post={uriOnlyPost()} sessionId={SESSION} resolveQuoteUri={() => Promise.resolve(null)} />,
    )
    await waitFor(() => expect(screen.getByText('Quoted post unavailable')).toBeTruthy())
    expect(screen.queryByTestId('post-quote-p9-card')).toBeNull()
    expect(screen.queryByText(/RE:/)).toBeNull()
  })

  it('renote id with no packed note renders unavailable without fetching', () => {
    const post = makePost({id: 'pn', content: {mfm: 'hello', plain: 'hello'}, renoteId: 'r1'})
    const fetch = jest.fn(() => Promise.resolve(null))
    renderCard(<PostCard post={post} sessionId={SESSION} resolveQuoteUri={fetch} />)
    expect(screen.getByText('Quoted post unavailable')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('PostCard textual fallbacks (WS-A)', () => {
  it('resolves an MFM textual marker into a card and strips it', async () => {
    renderCard(
      <PostCard post={textualPost()} sessionId={SESSION} resolveQuoteUri={() => Promise.resolve(quotedPost())} />,
    )
    await waitFor(() => expect(screen.getByTestId('post-quote-pt-card')).toBeTruthy())
    expect(screen.queryByText(/RE:/)).toBeNull()
  })

  it('a failed textual lookup keeps the RE: text and renders no card', async () => {
    renderCard(
      <PostCard post={textualPost()} sessionId={SESSION} resolveQuoteUri={() => Promise.resolve(null)} />,
    )
    await waitFor(() => expect(screen.queryByText(/RE:/)).toBeTruthy())
    expect(screen.queryByTestId('post-quote-pt-card')).toBeNull()
    expect(screen.queryByText('Quoted post unavailable')).toBeNull()
  })

  it('resolves a server-HTML bare-URL marker into a card and strips it', async () => {
    const post: Post = {
      ...makePost({id: 'ph'}),
      content: {
        html: '<p>commentary<br>RE: <a href="https://remote.example/notes/1">https://remote.example/notes/1</a></p>',
        plain: 'commentary RE: https://remote.example/notes/1',
      },
    }
    renderCard(
      <PostCard post={post} sessionId={SESSION} resolveQuoteUri={() => Promise.resolve(quotedPost())} />,
    )
    await waitFor(() => expect(screen.getByTestId('post-quote-ph-card')).toBeTruthy())
    expect(screen.queryByText(/RE:/)).toBeNull()
  })

  it('strips the HTML marker duplicating the packed structured quote', () => {
    const post: Post = {
      ...makePost({id: 'pm'}),
      content: {
        html: '<p>commentary<br>RE: <a href="https://remote.example/notes/1">https://remote.example/notes/1</a></p>',
        plain: 'commentary RE: https://remote.example/notes/1',
      },
      quote: quotedPost(),
    }
    renderCard(<PostCard post={post} sessionId={SESSION} />)
    expect(screen.getByTestId('post-quote-pm-card')).toBeTruthy()
    expect(screen.queryByText(/RE:/)).toBeNull()
  })
})

describe('PostCard quote authorization policy (WS-A)', () => {
  function pendingQuotePost(): Post {
    return makePost({
      id: 'pq',
      content: {mfm: 'fyi', plain: 'fyi'},
      quote: quotedPost(),
      quoteState: 'pending',
    })
  }

  it('shows an unauthorized Mastodon quote by default, with its status', () => {
    renderCard(<PostCard post={pendingQuotePost()} sessionId={SESSION} />)
    expect(screen.getByTestId('post-quote-pq-card')).toBeTruthy()
    expect(screen.getByTestId('post-quote-pq-status')).toBeTruthy()
  })

  it('opt-in hides the unauthorized card behind tap-to-reveal; tap reveals', () => {
    renderCard(<PostCard post={pendingQuotePost()} sessionId={SESSION} onlyAuthorizedQuotes />)
    expect(screen.queryByTestId('post-quote-pq-card')).toBeNull()
    expect(screen.getByTestId('post-quote-pq-concealed')).toBeTruthy()
    // The body marker policy is unchanged here (no marker in this body).
    fireEvent.press(screen.getByTestId('post-quote-pq'))
    expect(screen.getByTestId('post-quote-pq-card')).toBeTruthy()
    expect(screen.queryByTestId('post-quote-pq-concealed')).toBeNull()
  })

  it('opt-in leaves authorized quotes (approved/missing status) alone', () => {
    const approved = makePost({id: 'pa', quote: quotedPost(), quoteState: 'accepted'})
    const {unmount} = renderCard(<PostCard post={approved} sessionId={SESSION} onlyAuthorizedQuotes />)
    expect(screen.getByTestId('post-quote-pa-card')).toBeTruthy()
    unmount()
    renderCard(<PostCard post={packedQuotePost()} sessionId={SESSION} onlyAuthorizedQuotes />)
    expect(screen.getByTestId('post-quote-p1-card')).toBeTruthy()
  })
})

describe('PostQuote (WS-A)', () => {
  it('concealed renders the reveal row and calls onReveal on tap', () => {
    const onReveal = jest.fn()
    renderCard(
      <PostQuote quote={quotedPost()} unavailable={false} status="Quote request pending" concealed onReveal={onReveal} testID="qz" />,
    )
    expect(screen.getByTestId('qz-concealed')).toBeTruthy()
    expect(screen.queryByText('quoted body')).toBeNull()
    fireEvent.press(screen.getByTestId('qz'))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('never strips a nested marker: embeds render one level only', () => {
    const inner = makePost({id: 'inner', content: {mfm: 'inner', plain: 'inner'}})
    const nested = makePost({
      id: 'qn',
      content: {
        mfm: 'nested note\nRE: https://remote.example/notes/inner',
        plain: 'nested note RE: https://remote.example/notes/inner',
      },
      renoteId: 'inner',
      renote: inner,
    })
    renderCard(<PostQuote quote={nested} unavailable={false} testID="qn" />)
    expect(screen.queryByText(/RE:/)).toBeTruthy()
  })
})

describe('postBodyNodes coverage (WS-A strip/keep matrix)', () => {
  function textOf(nodes: ReturnType<typeof postBodyNodes>): string {
    return nodes
      .map(n => (n.kind === 'text' ? n.text : n.kind === 'link' ? `[${textOf(n.children)}]` : ''))
      .join('')
  }

  it('strips a structured duplicate only when its URI is covered', () => {
    const post = packedQuotePost()
    expect(textOf(postBodyNodes(post, {coveredQuoteUris: [QUOTED_URI]}))).toBe('look at this')
    expect(textOf(postBodyNodes(post, {coveredQuoteUris: []}))).toContain('RE:')
  })

  it('strips a textual marker only when the resolution covered it', () => {
    const post = textualPost()
    expect(textOf(postBodyNodes(post, {coveredQuoteUris: []}))).toContain('RE:')
    expect(textOf(postBodyNodes(post, {coveredQuoteUris: [QUOTED_URI]}))).toBe('via relay')
  })

  it('legacy default still strips packed structured duplicates', () => {
    expect(textOf(postBodyNodes(packedQuotePost()))).toBe('look at this')
  })
})

describe('QuotePolicyRow (WS-A settings toggle)', () => {
  function setup() {
    const storage = createMemoryStore()
    const store = createAppearanceStore(() => storage)
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QuotePolicyRow store={store} />
        </ThemeProvider>
      </I18nProvider>,
    )
    return store
  }

  it('defaults to Off and toggles the persisted device pref', () => {
    const store = setup()
    expect(store.getOnlyAuthorizedQuotes()).toBe(false)
    expect(screen.getByTestId('quote-policy-row-toggle')).toBeTruthy()
    fireEvent.press(screen.getByTestId('quote-policy-row-toggle'))
    expect(store.getOnlyAuthorizedQuotes()).toBe(true)
    fireEvent.press(screen.getByTestId('quote-policy-row-toggle'))
    expect(store.getOnlyAuthorizedQuotes()).toBe(false)
  })
})
