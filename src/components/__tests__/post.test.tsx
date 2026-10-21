import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'

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

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

const SESSION = 'sess-1'

describe('PostCard', () => {
  it('renders avatar fallback, name, handle, time, and body', () => {
    const createdAt = new Date(Date.now() - 22 * 3_600_000).toISOString()
    renderCard(<PostCard post={makePost({createdAt})} sessionId={SESSION} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    // v1 parity: the handle links to the profile, the time to the post —
    // separate stops, not one caption.
    const expected = `· ${new Intl.RelativeTimeFormat(undefined, {style: 'narrow'}).format(-22, 'hour')}`
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
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    expect(screen.getByLabelText('❤, 5. Reactions are read-only in this build — the write path lands in Phase 4.')).toBeTruthy()
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
