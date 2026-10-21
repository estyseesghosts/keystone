// Contrast sweep (stream A): every feed-content foreground must resolve
// to `theme.palette` in BOTH themes, and text-bearing surfaces must carry
// an explicit paired background.
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import type {ContentNode, ReactionSummary} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {themes, type ThemeName} from '#/alf/themes'
import {makeAccount, makePost} from '#/components/__tests__/fixtures'
import {LinkCard} from '#/components/Post/LinkCard'
import {PostPoll} from '#/components/Post/PostPoll'
import {PostQuote} from '#/components/Post/PostQuote'
import {ReactionChips} from '#/components/Post/ReactionChips'
import {RichText} from '#/components/RichText'

i18n.load('en', {})
i18n.activate('en')

function renderWithTheme(ui: React.ReactElement, theme: ThemeName) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function fgOfText(text: string): string | undefined {
  const flat = StyleSheet.flatten(screen.getByText(text).props.style) as
    | {color?: string}
    | undefined
  return flat?.color
}

function bgOfTestId(id: string): string | undefined {
  const flat = StyleSheet.flatten(screen.getByTestId(id).props.style) as
    | {backgroundColor?: string}
    | undefined
  return flat?.backgroundColor
}

describe.each(['light', 'dark'] as const)('feed content contrast (%s theme)', theme => {
  const palette = themes[theme].palette

  it('RichText body draws in the themed text color', () => {
    const nodes: ContentNode[] = [{kind: 'text', text: 'Hello world'}]
    renderWithTheme(<RichText nodes={nodes} />, theme)
    expect(fgOfText('Hello world')).toBe(
      palette.text,
    )
  })

  it('RichText code blocks pair themed text on a themed background', () => {
    const nodes: ContentNode[] = [{kind: 'codeBlock', language: null, code: 'x = 1'}]
    const {toJSON} = renderWithTheme(<RichText nodes={nodes} />, theme)
    expect(fgOfText('x = 1')).toBe(palette.text)
    // The block container carries the paired background.
    const tree = toJSON()
    const blocks: unknown[] = []
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      const node = n as {type?: unknown; props?: {style?: unknown}; children?: unknown};
      if (node.type === 'View' && node.props?.style) {
        const flat = StyleSheet.flatten(node.props.style) as
          | {backgroundColor?: string}
          | undefined
        if (flat?.backgroundColor === palette.bgSoft) blocks.push(node)
      }
      const kids = (n as {children?: unknown}).children
      if (Array.isArray(kids)) kids.forEach(walk)
    }
    walk(tree)
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('mine reaction chips draw the :code: fallback in the inverted foreground', () => {
    const reactions: ReactionSummary = {
      total: 3,
      entries: [{key: ':blobcat:', count: 3, url: null, mine: true}],
      mine: ':blobcat:',
      myReactions: [],
      urls: {},
    }
    renderWithTheme(<ReactionChips reactions={reactions} testID="chips" />, theme)
    expect(fgOfText(':blobcat:')).toBe(
      palette.bg,
    )
  })

  it('unselected reaction chips draw the :code: fallback in the text color', () => {
    const reactions: ReactionSummary = {
      total: 3,
      entries: [{key: ':blobcat:', count: 3, url: null, mine: false}],
      mine: null,
      myReactions: [],
      urls: {},
    }
    renderWithTheme(<ReactionChips reactions={reactions} testID="chips" />, theme)
    expect(fgOfText(':blobcat:')).toBe(
      palette.text,
    )
  })

  it('LinkCard pairs its text with an explicit background', () => {
    renderWithTheme(
      <LinkCard
        card={{
          url: 'https://example.com/a',
          title: 'An article',
          description: 'Read all about it.',
          image: null,
          type: 'link',
          authorName: null,
          authorUrl: null,
          providerName: null,
        }}
        testID="lc"
      />,
      theme,
    )
    expect(bgOfTestId('lc-card')).toBe(palette.bg)
    expect(fgOfText('An article')).toBe(
      palette.text,
    )
  })

  it('PostPoll pairs its box with an explicit background', () => {
    renderWithTheme(
      <PostPoll
        poll={{
          multiple: false,
          expiresAt: null,
          expired: false,
          votesCount: 10,
          votersCount: 8,
          options: [
            {text: 'Alpha', votesCount: 7, voted: false},
            {text: 'Beta', votesCount: 3, voted: false},
          ],
        }}
        onVote={jest.fn()}
        testID="poll"
      />,
      theme,
    )
    expect(bgOfTestId('poll')).toBe(palette.bg)
  })

  it('PostQuote pairs its card with an explicit background', () => {
    const quote = makePost({id: 'q1', author: makeAccount(), content: {mfm: 'quoted', plain: 'quoted'}})
    renderWithTheme(<PostQuote quote={quote} unavailable={false} testID="pq" />, theme)
    // The card view carries the paired background.
    expect(bgOfTestId('pq-card')).toBe(palette.bg)
  })
})
