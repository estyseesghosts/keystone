// F12: server link-card preview.
import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import type {LinkCard as LinkCardModel} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {LinkCard} from '#/components/Post/LinkCard'

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
})
