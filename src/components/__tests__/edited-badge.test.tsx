// Edited badge gating (clickstone §1.7): the badge opens the history screen
// ONLY where a history endpoint exists (the live card wires the press when
// the backend has `editHistory`). Without the handler it stays plain text —
// a non-interactive marker, never a dead link to an unimplemented screen.

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'

import {makePost} from './fixtures'

i18n.load('en', {})
i18n.activate('en')

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('Edited badge', () => {
  const edited = makePost({editedAt: '2026-10-21T00:00:00.000Z'})

  it('renders as a marker when no history handler is connected', () => {
    renderCard(<PostCard post={edited} sessionId="sess-1" />)
    const badge = screen.getByTestId(`post-badge-edited-${edited.id}`)
    expect(badge).toHaveTextContent('Edited')
    expect(badge.props.accessibilityRole).toBeUndefined()
  })

  it('opens the history when the card supplies the handler', () => {
    const onEditedPress = jest.fn()
    renderCard(
      <PostCard post={edited} sessionId="sess-1" onEditedPress={onEditedPress} />,
    )
    const badge = screen.getByTestId(`post-badge-edited-${edited.id}`)
    expect(badge.props.accessibilityRole).toBe('link')
    fireEvent.press(badge)
    expect(onEditedPress).toHaveBeenCalledTimes(1)
  })

  it('an unedited post has no badge at all', () => {
    const plain = makePost({editedAt: null})
    renderCard(<PostCard post={plain} sessionId="sess-1" />)
    expect(screen.queryByTestId(`post-badge-edited-${plain.id}`)).toBeNull()
  })
})
