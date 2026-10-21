import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {Linking} from 'react-native'

import {contentFromHtml, contentFromMfm} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {RichText} from '#/components/RichText'
import {navigationRef} from '#/navigationRef'
import {appearanceStore} from '#/state/appearance'

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

describe('RichText mentions (F9)', () => {
  it('passes the mention href and visible label to the handler', () => {
    const onMention = jest.fn()
    renderRichText(
      <RichText nodes={contentFromMfm('hi @bob@ex.ample')} onMentionPress={onMention} />,
    )
    fireEvent.press(screen.getByText('@bob@ex.ample'))
    expect(onMention).toHaveBeenCalledWith(null, '@bob@ex.ample')
  })
})

// PF-E2/E3 repro: handler-less surfaces (bio, fields, notification
// excerpt) must still land in-app — mentions on the profile, hashtags
// on the Tag screen, never an external browser or a dead tap.
describe('RichText handler-less mention/hashtag routing (PF-E2/E3)', () => {
  let navigateSpy: jest.SpyInstance
  let openSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    openSpy = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true))
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('E2: an MFM mention with no handler opens the profile by handle', () => {
    renderRichText(<RichText nodes={contentFromMfm('hi @bob@ex.ample')} />)
    fireEvent.press(screen.getByText('@bob@ex.ample'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'bob@ex.ample'},
    })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('E2: an HTML mention with no handler opens the profile by label', () => {
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p><a class="u-url mention" href="https://ex.ample/@bob">@<span>bob</span></a></p>',
        )}
      />,
    )
    fireEvent.press(screen.getByText('@bob'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'bob@ex.ample'},
    })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('E2: an HTML mention with a display-name label resolves via the profile URL', () => {
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p><a class="u-url mention" href="https://ex.ample/users/bob">Bobby</a></p>',
        )}
      />,
    )
    fireEvent.press(screen.getByText('Bobby'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'bob@ex.ample'},
    })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('E3: an MFM hashtag with no handler opens the Tag screen', () => {
    renderRichText(<RichText nodes={contentFromMfm('hello #cats')} />)
    fireEvent.press(screen.getByText('#cats'))
    expect(navigateSpy).toHaveBeenCalledWith('Tag', {tag: 'cats'})
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('E3: an HTML hashtag with no handler opens the Tag screen, not the browser', () => {
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p><a class="hashtag" data-tag="cats" href="https://ex.ample/tag/cats">#cats</a></p>',
        )}
      />,
    )
    fireEvent.press(screen.getByText('#cats'))
    expect(navigateSpy).toHaveBeenCalledWith('Tag', {tag: 'cats'})
    expect(openSpy).not.toHaveBeenCalled()
  })
})

describe('RichText text scale + content mode (P1/P3)', () => {
  it('scales the body size with the alf font scale', () => {
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light" fontScale={2}>
          <RichText nodes={contentFromMfm('hello')} />
        </ThemeProvider>
      </I18nProvider>,
    )
    const text = screen.getByText('hello')
    const flattened = (Array.isArray(text.props.style) ? text.props.style : [text.props.style]).flat()
    const sized = flattened.find(s => s && typeof s.fontSize === 'number')
    expect(sized.fontSize).toBe(30)
  })

  it('renders the plain-text projection in plain content mode', () => {
    appearanceStore.setContentMode('plain')
    try {
      renderRichText(
        <RichText nodes={contentFromMfm('**bold** and [label](https://example.com)')} testID="plain" />,
      )
      expect(screen.getByText('bold and label')).toBeTruthy()
    } finally {
      appearanceStore.setContentMode('auto')
    }
  })
})
