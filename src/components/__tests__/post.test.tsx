import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'
import {PostCard} from '#/components/Post/index'
import type {TranslationSource} from '#/components/Post/PostCard'

import {makeAccount, makeMedia, makePost} from './fixtures'

// expo-video has no Jest native module: stub the player/hook boundary.
// The branch mapping (which tile for which kind) is what's under test,
// not playback itself.
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

/** Effective text color of a host Text element (style arrays flattened). */
function renderedColor(testID: string): unknown {
  const style = screen.getByTestId(testID).props.style as unknown
  const parts = (Array.isArray(style) ? style : [style]).flat(Infinity) as Array<unknown>
  const merged = parts.reduce<Record<string, unknown>>(
    (acc, p) => ({...acc, ...(typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {})}),
    {},
  )
  return merged.color
}

const SESSION = 'sess-1'

describe('PostCard', () => {
  it('renders avatar fallback, name, handle, time, and body', () => {
    const createdAt = new Date(Date.now() - 22 * 3_600_000).toISOString()
    renderCard(<PostCard post={makePost({createdAt})} sessionId={SESSION} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    // v1 parity: the handle links to the profile, the time to the post —
    // separate stops, not one caption.
    // The card renders in the APP locale (useLocale, 'en' here), not the
    // device default — mirror that in the expectation.
    const expected = `· ${new Intl.RelativeTimeFormat('en', {style: 'narrow'}).format(-22, 'hour')}`
    expect(screen.getByText('@alice@example.social')).toBeTruthy()
    expect(screen.getByText(expected)).toBeTruthy()
    expect(screen.getByTestId('avatar-fallback-a1')).toBeTruthy()
    expect(screen.getByTestId('post-body-p1')).toBeTruthy()
  })

  it('toggles CW content', () => {
    renderCard(<PostCard post={makePost({id: 'p2', cw: 'spoilers'})} sessionId={SESSION} />)
    expect(screen.queryByTestId('post-body-p2')).toBeNull()
    fireEvent.press(screen.getByTestId('cw-toggle-p2'))
    expect(screen.getByTestId('post-body-p2')).toBeTruthy()
  })

  it('shows a boost header with the original for pure renotes', () => {
    const original = makePost({id: 'orig', content: {mfm: 'original text', plain: 'original text'}})
    const wrapper = makePost({
      id: 'wrap',
      author: makeAccount({id: 'b1', username: 'bob', acct: 'bob', host: null, name: 'Bob', displayName: 'Bob'}),
      content: {plain: ''},
      renoteId: 'orig',
      renote: original,
    })
    renderCard(<PostCard post={wrapper} sessionId={SESSION} />)
    expect(screen.getByTestId('boost-header-wrap')).toBeTruthy()
    expect(screen.getByText('original text')).toBeTruthy()
  })

  it('renders reply context, quote embed, and media images', () => {
    const parent = makePost({id: 'parent', author: makeAccount({id: 'c1', username: 'carol', acct: 'carol@x.social', host: 'x.social', name: '', displayName: 'carol'})})
    const post = makePost({
      id: 'p3',
      replyToId: 'parent',
      reply: parent,
      quote: makePost({id: 'q1', content: {mfm: 'quoted body', plain: 'quoted body'}}),
      media: [makeMedia({id: 'm9'})],
    })
    renderCard(<PostCard post={post} sessionId={SESSION} />)
    expect(screen.getByTestId('reply-context-p3')).toBeTruthy()
    expect(screen.getByTestId('post-quote-p3')).toBeTruthy()
    expect(screen.getByText('quoted body')).toBeTruthy()
    expect(screen.getByTestId('media-m9')).toBeTruthy()
    expect(screen.getByTestId('post-actions-p3')).toBeTruthy()
  })

  it('renders an unavailable quote as an honest fallback', () => {
    renderCard(<PostCard post={makePost({id: 'p4', quote: null, quoteUnavailable: true})} sessionId={SESSION} />)
    expect(screen.getByTestId('post-quote-p4')).toBeTruthy()
  })

  it('renders video/gifv/audio/file branches with real players, never a fake tile', () => {
    renderCard(
      <PostCard
        post={makePost({
          id: 'p5',
          media: [
            makeMedia({id: 'v1', kind: 'video', mimeType: 'video/mp4'}),
            makeMedia({id: 'g1', kind: 'gifv', mimeType: 'video/mp4'}),
            makeMedia({id: 'a1', kind: 'audio', mimeType: 'audio/mpeg'}),
            makeMedia({id: 'f1', kind: 'file', mimeType: 'application/pdf'}),
          ],
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('media-video-v1')).toBeTruthy()
    expect(screen.getByTestId('media-gifv-g1')).toBeTruthy()
    expect(screen.getByTestId('media-audio-a1')).toBeTruthy()
    expect(screen.getByTestId('media-audio-toggle-a1')).toBeTruthy()
    expect(screen.getByTestId('media-file-f1')).toBeTruthy()
    expect(screen.getByTestId('media-file-open-f1')).toBeTruthy()
    expect(screen.queryByTestId('media-placeholder-v1')).toBeNull()
  })

  it('tapping a still opens the Lightbox at its index and closes', () => {
    renderCard(
      <PostCard
        post={makePost({id: 'p8', media: [makeMedia({id: 'm8'}), makeMedia({id: 'm9'})]})}
        sessionId={SESSION}
      />,
    )
    expect(screen.queryByTestId('post-lightbox-p8')).toBeNull()
    fireEvent.press(screen.getByTestId('media-m9'))
    expect(screen.getByTestId('post-lightbox-p8')).toBeTruthy()
    fireEvent.press(screen.getByTestId('lightbox-close'))
    expect(screen.queryByTestId('post-lightbox-p8')).toBeNull()
  })

  it('hides sensitive media behind a tap-to-show gate', () => {
    renderCard(
      <PostCard post={makePost({id: 'p6', media: [makeMedia({id: 's1', isSensitive: true})]})} sessionId={SESSION} />,
    )
    expect(screen.queryByTestId('media-s1')).toBeNull()
    fireEvent.press(screen.getByTestId('media-sensitive-show'))
    expect(screen.getByTestId('media-s1')).toBeTruthy()
  })

  it('renders read-only reaction chips, disabled with a reason', () => {
    const post = makePost()
    post.reactions = {
      total: 8,
      entries: [
        {key: '👍', count: 3, mine: false, url: null},
        {key: '❤', count: 5, mine: false, url: null},
      ],
      mine: null,
      myReactions: [],
      urls: {},
    }
    renderCard(<PostCard post={post} sessionId={SESSION} />)
    expect(screen.getByLabelText('👍, 3. Reactions are read-only here.')).toBeTruthy()
  })

  it('hides the heart chip: hearts live on the like button (F18)', () => {
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    expect(screen.queryByTestId('reaction-❤')).toBeNull()
    expect(screen.queryByTestId('post-reactions-p1')).toBeNull()
  })

  it('hides reaction chips when reactions are unsupported', () => {
    renderCard(
      <PostCard
        post={makePost({id: 'p7'})}
        sessionId={SESSION}
        capabilities={{reactions: 'unsupported'} as never}
      />,
    )
    expect(screen.queryByTestId('post-reactions-p7')).toBeNull()
  })

  it('signed-out action row is static counts, never buttons', () => {
    renderCard(<PostCard post={makePost({id: 'p8'})} sessionId={SESSION} />)
    expect(screen.getByTestId('post-actions-p8')).toBeTruthy()
    // Static spans: no pressable actions without a session.
    expect(screen.queryByLabelText('Reply. Sign in to reply.')).toBeNull()
    expect(screen.queryByLabelText('Boost. Sign in to boost.')).toBeNull()
  })
})

describe('PostQuote (F6)', () => {
  it('quote card is a pressable link into the quoted post', async () => {
    const {PostQuote} = await import('#/components/Post/PostQuote')
    const onPress = jest.fn()
    const quote = makePost({id: 'q9', content: {mfm: 'quoted body', plain: 'quoted body'}})
    renderCard(<PostQuote quote={quote} unavailable={false} onPress={onPress} testID="quote-f6" />)
    const card = screen.getByTestId('quote-f6')
    expect(card.props.accessibilityRole).toBe('link')
    fireEvent.press(card)
    expect(onPress).toHaveBeenCalledWith(quote)
  })

  it('card mention taps route through the card handler, not the nav', async () => {
    const {PostQuote} = await import('#/components/Post/PostQuote')
    const onPress = jest.fn()
    const onMentionPress = jest.fn()
    const quote = makePost({
      id: 'q10',
      content: {mfm: 'hi @bob@example.social', plain: 'hi @bob@example.social'},
    })
    renderCard(
      <PostQuote
        quote={quote}
        unavailable={false}
        onPress={onPress}
        onMentionPress={onMentionPress}
        testID="quote-f6-mention"
      />,
    )
    expect(screen.getByTestId('quote-f6-mention')).toBeTruthy()
    expect(onPress).not.toHaveBeenCalled()
    expect(onMentionPress).not.toHaveBeenCalled()
  })
})

describe('safeHttpUrl gating (F4)', () => {
  it('renders the avatar fallback for a non-http avatar URL', () => {
    renderCard(
      <PostCard
        post={makePost({author: makeAccount({id: 'evil', avatarUrl: 'javascript:alert(1)'})})}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('avatar-fallback-evil')).toBeTruthy()
  })

  it('renders the missing-image placeholder for a non-http media URL', () => {
    renderCard(
      <PostCard post={makePost({media: [makeMedia({id: 'bad', url: 'ftp://evil/x.png'})]})} sessionId={SESSION} />,
    )
    expect(screen.getByTestId('media-missing-bad')).toBeTruthy()
  })
})

describe('post badges (F15/F16)', () => {
  it('renders pinned/edited badges on the card', () => {
    renderCard(
      <PostCard post={makePost({id: 'pb', pinned: true, editedAt: '2026-10-20T00:00:00.000Z'})} sessionId={SESSION} />,
    )
    expect(screen.getByTestId('post-badge-pinned-pb')).toBeTruthy()
    expect(screen.getByTestId('post-badge-edited-pb')).toBeTruthy()
  })

  it('renders the quote authorization status on the quote card', () => {
    const quoted = makePost({id: 'qs'})
    const post = makePost({
      id: 'qw',
      content: {mfm: 'take', plain: 'take'},
      quote: quoted,
      ext: {quoteAuthorizationStatus: 'pending'},
    })
    renderCard(<PostCard post={post} sessionId={SESSION} />)
    expect(screen.getByTestId('post-quote-qw-status')).toBeTruthy()
  })
})

describe('boost collapsing banner (F17)', () => {
  it('reads "X and N others boosted" with aggregated renoters', async () => {
    const {boostLabel} = await import('#/components/Post/PostCard')
    const bob = makeAccount({id: 'b1', username: 'bob', acct: 'bob', name: 'Bob', displayName: 'Bob'})
    const carol = makeAccount({id: 'c1', username: 'carol', acct: 'carol', name: 'Carol', displayName: 'Carol'})
    expect(boostLabel(makePost(), [bob])).toBe('Alice boosted')
    expect(boostLabel(makePost(), [bob, carol])).toBe('Bob and 1 other boosted')
  })

  it('renders the aggregated banner on the card', () => {
    const bob = makeAccount({id: 'b1', username: 'bob', acct: 'bob', name: 'Bob', displayName: 'Bob'})
    const carol = makeAccount({id: 'c1', username: 'carol', acct: 'carol', name: 'Carol', displayName: 'Carol'})
    const original = makePost({id: 'orig'})
    const wrapper = makePost({
      id: 'wrap2',
      author: bob,
      content: {plain: ''},
      renoteId: 'orig',
      renote: original,
    })
    renderCard(<PostCard post={wrapper} sessionId={SESSION} renoters={[bob, carol]} />)
    expect(screen.getByTestId('boost-header-wrap2')).toHaveTextContent('Bob and 1 other boosted')
  })
})

describe('display-name color (black-on-dark fix)', () => {
  it('defaults to the themed text color in both themes', async () => {
    const {DisplayName} = await import('#/components/DisplayName')
    const {makeAccount} = await import('./fixtures')
    const account = makeAccount()
    const light = renderCard(<DisplayName account={account} testID="dn-light" />)
    expect(renderedColor('dn-light')).toBe(themes.light.palette.text)
    light.unmount()
    renderCard(<DisplayName account={account} testID="dn-dark" />, 'dark')
    expect(renderedColor('dn-dark')).toBe(themes.dark.palette.text)
  })

  it('an explicit textStyle color still wins', async () => {
    const {DisplayName} = await import('#/components/DisplayName')
    const {makeAccount} = await import('./fixtures')
    renderCard(<DisplayName account={makeAccount()} textStyle={{color: '#ff0000'}} testID="dn-override" />)
    expect(renderedColor('dn-override')).toBe('#ff0000')
  })
})

describe('name==handle collapse (v1)', () => {
  it('collapses handle spellings and exact username echoes, nothing else', async () => {
    const {shouldCollapseName} = await import('#/components/DisplayName')
    const remote = {username: 'rina', host: 'example.social'}
    for (const displayName of [
      'rina',
      'rina@example.social',
      '@rina@example.social',
      '',
      '   ',
    ]) {
      expect(shouldCollapseName({displayName, ...remote})).toBe(true)
    }
    // A host-less @-mention is not a remote user's handle.
    expect(shouldCollapseName({displayName: '@rina', ...remote})).toBe(false)
    // Ordinary names stay two lines — even a case-only near miss.
    expect(shouldCollapseName({displayName: 'Rina', ...remote})).toBe(false)
    expect(shouldCollapseName({displayName: 'Rina!', ...remote})).toBe(false)
    expect(shouldCollapseName({displayName: 'RINA@EXAMPLE.SOCIAL', ...remote})).toBe(false)
    expect(shouldCollapseName({displayName: 'bob', username: 'bob', host: null})).toBe(true)
    expect(shouldCollapseName({displayName: '@bob', username: 'bob', host: null})).toBe(true)
    expect(shouldCollapseName({displayName: 'Bobby', username: 'bob', host: null})).toBe(false)
    // The established fixture name is NOT a handle echo.
    expect(
      shouldCollapseName({displayName: 'Alice', username: 'alice', host: 'example.social'}),
    ).toBe(false)
  })

  it('PostCard header shows one line when the display name equals the handle', () => {
    const author = makeAccount({
      id: 'h1',
      username: 'rina',
      host: 'example.social',
      name: 'rina@example.social',
      displayName: 'rina@example.social',
    })
    renderCard(<PostCard post={makePost({id: 'hc', author})} sessionId={SESSION} />)
    expect(screen.getByTestId('author-name-h1')).toHaveTextContent('@rina@example.social')
    // One line only: no second smaller handle line underneath.
    expect(screen.queryAllByText('@rina@example.social')).toHaveLength(1)
  })

  it('PostCard header keeps two lines for a real display name', () => {
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.queryAllByText('@alice@example.social')).toHaveLength(1)
  })

  it('PostQuote collapses to a single handle line', async () => {
    const {PostQuote} = await import('#/components/Post/PostQuote')
    const quote = makePost({
      id: 'hq',
      author: makeAccount({id: 'h2', username: 'rina', host: 'example.social', name: 'rina', displayName: 'rina'}),
    })
    renderCard(<PostQuote quote={quote} unavailable={false} testID="quote-collapse" />)
    expect(screen.queryAllByText('@rina@example.social')).toHaveLength(1)
    expect(screen.queryByText('rina')).toBeNull()
  })
})

describe('auto-translate (v1)', () => {
  function source(fetch: TranslationSource['fetch'], supported = true): TranslationSource {
    return {supported, targetLang: 'en', fetch}
  }

  it('auto-fetches on mount and renders the translation with a header above the body', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard post={makePost({id: 'tr1'})} sessionId={SESSION} translationSource={source(fetch)} />,
    )
    expect(await screen.findByTestId('post-translation-tr1')).toBeTruthy()
    expect(screen.getByText('Hola traducido')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('tr1', 'en')
    expect(screen.getByTestId('translation-toggle-tr1')).toBeTruthy()
    expect(screen.getByText(/Translated from es/)).toBeTruthy()
    expect(screen.getByText(/Show original/)).toBeTruthy()
    // The translation replaces the body — the original is hidden.
    expect(screen.queryByTestId('post-body-tr1')).toBeNull()
  })

  it('tapping the header toggles between translation and original, once', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard post={makePost({id: 'tr2'})} sessionId={SESSION} translationSource={source(fetch)} />,
    )
    expect(await screen.findByTestId('post-translation-tr2')).toBeTruthy()
    fireEvent.press(screen.getByTestId('translation-toggle-tr2'))
    expect(screen.getByTestId('post-body-tr2')).toBeTruthy()
    expect(screen.queryByTestId('post-translation-tr2')).toBeNull()
    expect(screen.getByText(/Showing original/)).toBeTruthy()
    fireEvent.press(screen.getByTestId('translation-toggle-tr2'))
    expect(await screen.findByTestId('post-translation-tr2')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('unsupported capability renders the original with no header and no request', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard post={makePost({id: 'tr3'})} sessionId={SESSION} translationSource={source(fetch, false)} />,
    )
    // Let any would-be request land.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
    expect(screen.getByTestId('post-body-tr3')).toBeTruthy()
    expect(screen.queryByTestId('translation-toggle-tr3')).toBeNull()
  })

  it('empty text never requests', () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => ({
      sourceLang: 'es',
      text: 'Hola traducido',
    }))
    renderCard(
      <PostCard
        post={makePost({id: 'tr4', content: {mfm: '', plain: ''}})}
        sessionId={SESSION}
        translationSource={source(fetch)}
      />,
    )
    expect(screen.getByTestId('post-body-tr4')).toBeTruthy()
    expect(screen.queryByTestId('translation-toggle-tr4')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetch failure keeps the original body silently', async () => {
    const fetch: TranslationSource['fetch'] = jest.fn(async () => {
      throw new Error('no translation service')
    })
    renderCard(
      <PostCard post={makePost({id: 'tr5'})} sessionId={SESSION} translationSource={source(fetch)} />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('post-translation-tr5')).toBeNull())
    expect(screen.getByTestId('post-body-tr5')).toBeTruthy()
    expect(screen.queryByTestId('translation-toggle-tr5')).toBeNull()
  })
})

describe('display-name emoji (F11)', () => {
  it('renders name emoji codes as glyphs in the card header', async () => {
    const {DisplayName} = await import('#/components/DisplayName')
    const {makeAccount} = await import('./fixtures')
    const account = makeAccount({
      id: 'e1',
      displayName: 'Ann :wave:',
      emojis: {wave: 'https://example.social/emoji/wave.png'},
    })
    renderCard(<DisplayName account={account} testID="dn" />)
    expect(screen.getByTestId('dn')).toBeTruthy()
    expect(screen.queryByText('Ann :wave:')).toBeNull()
  })

  it('leaves unknown codes literal', async () => {
    const {DisplayName} = await import('#/components/DisplayName')
    const {makeAccount} = await import('./fixtures')
    const account = makeAccount({id: 'e2', displayName: 'Bob :nope:'})
    renderCard(<DisplayName account={account} testID="dn2" />)
    expect(screen.getByTestId('dn2')).toHaveTextContent('Bob :nope:')
  })
})

describe('fold (F13)', () => {
  const long = 'word '.repeat(200).trim()
  it('folds long bodies with an in-place expand/collapse', () => {
    renderCard(
      <PostCard post={makePost({id: 'fold1', content: {mfm: long, plain: long}})} sessionId={SESSION} />,
    )
    expect(screen.getByTestId('post-expand-fold1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-expand-fold1'))
    expect(screen.getByTestId('post-collapse-fold1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-collapse-fold1'))
    expect(screen.getByTestId('post-expand-fold1')).toBeTruthy()
  })

  it('does not fold short bodies', () => {
    renderCard(<PostCard post={makePost({id: 'fold2'})} sessionId={SESSION} />)
    expect(screen.queryByTestId('post-expand-fold2')).toBeNull()
  })

  it('renders the server link card', () => {
    renderCard(
      <PostCard
        post={makePost({
          id: 'lc1',
          card: {
            url: 'https://example.com/article',
            title: 'An article',
            description: 'Read all about it.',
            image: null,
            type: 'link',
            authorName: null,
            authorUrl: null,
            providerName: null,
          },
        })}
        sessionId={SESSION}
      />,
    )
    expect(screen.getByTestId('post-card-lc1')).toBeTruthy()
    expect(screen.getByText('An article')).toBeTruthy()
  })
})
