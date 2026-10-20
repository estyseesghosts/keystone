import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {contentFromHtml, contentFromMfm} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {RichText} from '#/components/RichText'

i18n.load('en', {})
i18n.activate('en')

function renderRichText(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('RichText (sole AST renderer)', () => {
  it('renders MFM bold/italic/strike/code text', () => {
    renderRichText(<RichText nodes={contentFromMfm('**bold** *italic* ~~strike~~ `code`')} />)
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByText('italic')).toBeTruthy()
    expect(screen.getByText('strike')).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
  })

  it('renders links, mentions, hashtags with press handlers', () => {
    const onLink = jest.fn()
    const onTag = jest.fn()
    renderRichText(
      <RichText
        nodes={contentFromMfm('[label](https://example.com) @alice #tag')}
        onLinkPress={onLink}
        onHashtagPress={onTag}
      />,
    )
    fireEvent.press(screen.getByText('label'))
    expect(onLink).toHaveBeenCalledWith('https://example.com/')
    fireEvent.press(screen.getByText('#tag'))
    expect(onTag).toHaveBeenCalledWith('tag')
  })

  it('degrades unknown MFM fn to its children', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[spin hello]')} />)
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('renders unicode emoji and code blocks/quotes as blocks', () => {
    renderRichText(<RichText nodes={contentFromMfm('hi 👋')} />)
    // OpenMoji default renders the hosted asset with the sequence as label.
    expect(screen.getByLabelText('👋')).toBeTruthy()
  })

  it('renders code blocks and quotes as blocks', () => {
    renderRichText(<RichText nodes={contentFromMfm('```js\nlet x = 1\n```\n> quoted')} />)
    expect(screen.getByText('let x = 1')).toBeTruthy()
    expect(screen.getByText('quoted')).toBeTruthy()
  })

  it('renders custom emoji from the packed map, literal for unknown codes', () => {
    renderRichText(
      <RichText nodes={contentFromMfm('hey :wave: and :nope:')} emojis={{wave: 'https://example.social/emoji/wave.png'}} />,
    )
    // Packed code renders the hosted image (never a fabricated URL).
    expect(screen.getByLabelText(':wave:')).toBeTruthy()
    // Unknown code renders its literal — content is never dropped.
    expect(screen.getByText(':nope:')).toBeTruthy()
  })

  it('drops javascript: hrefs to text (XSS guard)', () => {
    renderRichText(<RichText nodes={contentFromHtml('<a href="javascript:alert(1)">click</a>')} />)
    expect(screen.getByText('click')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('drops script subtrees from HTML', () => {
    renderRichText(<RichText nodes={contentFromHtml('<p>safe</p><script>alert(1)</script>')} />)
    expect(screen.getByText('safe')).toBeTruthy()
    expect(screen.queryByText('alert(1)')).toBeNull()
  })
})
