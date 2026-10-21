// Contrast sweep (stream A): emoji fallbacks must draw in the themed
// foreground in BOTH themes — RN `Text` defaults to black, which vanishes
// on dark backgrounds.
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'

function renderWithTheme(ui: React.ReactElement, theme: 'light' | 'dark') {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function colorOf(el: unknown): string | undefined {
  const style = (el as {props: {style: unknown}}).props.style
  const flat = StyleSheet.flatten(style) as {color?: string} | undefined
  return flat?.color
}

describe.each(['light', 'dark'] as const)('EmojiImage fallbacks (%s theme)', theme => {
  it('renders the Unicode system-font fallback in the themed text color', () => {
    renderWithTheme(<UnicodeEmoji sequence="😀" style="system" testID="u" />, theme)
    expect(colorOf(screen.getByTestId('u'))).toBe(themes[theme].palette.text)
  })

  it('renders the literal :code: fallback in the themed text color', () => {
    renderWithTheme(
      <CustomEmojiGlyph name="blobcat" host={null} src={null} packed={null} testID="c" />,
      theme,
    )
    expect(colorOf(screen.getByTestId('c'))).toBe(themes[theme].palette.text)
  })

  it('lets an inverted surface override the fallback color', () => {
    renderWithTheme(
      <CustomEmojiGlyph
        name="blobcat"
        host={null}
        src={null}
        packed={null}
        textStyle={{color: themes[theme].palette.bg}}
        testID="c-inv"
      />,
      theme,
    )
    expect(colorOf(screen.getByTestId('c-inv'))).toBe(themes[theme].palette.bg)
  })
})
