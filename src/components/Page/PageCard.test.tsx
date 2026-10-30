// P6.5 Pages slice 3: card summary truncation (85 chars + `…`).

import {render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'

import {i18n} from '#/locale/i18n'
import {ThemeProvider} from '#/alf/index'

import {PageCard, pageCardSummary} from './PageCard'
import {makeAccount} from '../__tests__/fixtures'
import type {PageModel} from '@keystone/fedi'

i18n.load('en', {})
i18n.activate('en')

function page(over: Partial<PageModel> = {}): PageModel {
  return {
    id: 'p1',
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    author: makeAccount(),
    title: 'Hello',
    name: 'hello',
    summary: null,
    font: 'sans-serif',
    alignCenter: false,
    hideTitleWhenPinned: false,
    eyeCatchingImageId: null,
    eyeCatchingImage: null,
    attachedFiles: [],
    blocks: [],
    likedCount: 0,
    isLiked: undefined,
    hasLegacyScript: false,
    url: 'https://a.example/@alice/pages/hello',
    ...over,
  }
}

function renderCard(p: PageModel) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <PageCard page={p} testID="card" />
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('pageCardSummary', () => {
  it('short text passes through', () => {
    expect(pageCardSummary(page({title: 'T', summary: 'short'}))).toBe('short')
  })

  it('null summary falls back to title', () => {
    expect(pageCardSummary(page({title: 'T', summary: null}))).toBe('T')
  })

  it('truncates at 85 chars with an ellipsis', () => {
    const long = 'x'.repeat(200)
    const out = pageCardSummary(page({title: long, summary: null}))
    expect(out).toBe(`${'x'.repeat(85)}…`)
    expect(out.length).toBe(86)
  })

  it('exactly 85 chars is untouched', () => {
    const exact = 'y'.repeat(85)
    expect(pageCardSummary(page({title: exact, summary: null}))).toBe(exact)
  })
})

describe('PageCard', () => {
  it('renders the truncated summary', () => {
    renderCard(page({title: 'T', summary: 's'.repeat(200)}))
    expect(screen.getByText(`s`.repeat(85) + '…')).toBeTruthy()
  })
})
