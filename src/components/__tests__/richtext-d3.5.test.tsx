// D3.5 split coverage: mention press, hashtag press, and one `fn`
// color allow + one reject through the post-split module tree
// (`RichText` + `richtext/*`). Targeted presses only — no whole-tree
// snapshots.
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'

import {contentFromMfm, fnNode, t} from '@keystone/fedi'

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

describe('RichText post-split press paths (D3.5)', () => {
  it('routes a mention press to the handler with href + label', () => {
    const onMention = jest.fn()
    renderRichText(
      <RichText nodes={contentFromMfm('hi @bob@ex.ample')} onMentionPress={onMention} />,
    )
    fireEvent.press(screen.getByText('@bob@ex.ample'))
    expect(onMention).toHaveBeenCalledWith(null, '@bob@ex.ample')
  })

  it('routes a hashtag press to the handler with the bare tag', () => {
    const onTag = jest.fn()
    renderRichText(<RichText nodes={contentFromMfm('hello #cats')} onHashtagPress={onTag} />)
    fireEvent.press(screen.getByText('#cats'))
    expect(onTag).toHaveBeenCalledWith('cats')
  })

  it('applies an allow-listed fn color to the style', () => {
    renderRichText(
      // eslint-disable-next-line keystone/no-hardcoded-color -- MFM color arg under test
      <RichText nodes={[fnNode('color', {c: '#ff0000'}, [t('red')])]} />,
    )
    const red = StyleSheet.flatten(screen.getByText('red').props.style) as {color?: string}
    // eslint-disable-next-line keystone/no-hardcoded-color -- expected MFM color value
    expect(red?.color).toBe('#ff0000')
  })

  it('rejects a non-hex fn color: content stays, style stays clean', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[color.red hi]')} />)
    expect(screen.getByText('hi')).toBeTruthy()
    const plain = StyleSheet.flatten(screen.getByText('hi').props.style) as {color?: string}
    expect(plain?.color).not.toBe('red')
  })
})
