// Post header hover zones: the profile card arms on the display name
// and the handle only — the timestamp and the tag-block bubble never
// arm it (a wide zone covered hashtags with profile cards).
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen, within} from '@testing-library/react-native'
import {Platform, StyleSheet} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'

import {makePost} from './fixtures'

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-1'

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('PostCard hover anchors (web)', () => {
  const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
  afterAll(() => restoreOs.restore())

  const tagged = () =>
    makePost({
      content: {
        mfm: 'Hello world\n\n#photo #linux',
        plain: 'Hello world\n\n#photo #linux',
      },
    })

  it('arms the card on the name press only (not time, tags, or handle)', () => {
    renderCard(<PostCard post={tagged()} sessionId={SESSION} />)
    const nameAnchor = screen.getByTestId('author-hover-name-a1-anchor')
    expect(within(nameAnchor).getByTestId('author-press-a1')).toBeTruthy()
    expect(within(nameAnchor).queryByTestId('post-time-p1')).toBeNull()
    expect(within(nameAnchor).queryByTestId('post-tags-p1')).toBeNull()
    expect(within(nameAnchor).queryByTestId('author-handle-a1')).toBeNull()
    // The tag bubble still renders — outside every hover zone.
    expect(screen.getByTestId('post-tags-p1')).toBeTruthy()
  })

  it('arms the card on the handle press only', () => {
    renderCard(<PostCard post={tagged()} sessionId={SESSION} />)
    const handleAnchor = screen.getByTestId('author-hover-handle-a1-anchor')
    expect(within(handleAnchor).getByTestId('author-handle-a1')).toBeTruthy()
    expect(within(handleAnchor).queryByTestId('author-press-a1')).toBeNull()
    expect(within(handleAnchor).queryByTestId('post-tags-p1')).toBeNull()
  })

  it('hugs the avatar box (no full-height column strip)', () => {
    renderCard(<PostCard post={tagged()} sessionId={SESSION} />)
    const avatarAnchor = screen.getByTestId('author-hover-a1-anchor')
    // The trigger wraps only the avatar press — the column below it is
    // outside the hover/press zone.
    expect(within(avatarAnchor).getByTestId('avatar-press-a1')).toBeTruthy()
    // ...and the anchor opts out of the card row's cross-axis stretch, so
    // its box is the 40×40 avatar instead of a full-post-height column.
    expect(StyleSheet.flatten(avatarAnchor.props.style)?.alignSelf).toBe('flex-start')
  })
})
