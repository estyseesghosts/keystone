import {render, screen} from '@testing-library/react-native'

import {contentFromMfm} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {RichText} from '#/components/RichText'

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

/** expo-image element for a glyph: the testID is forwarded to wrapper
 * views, so prop assertions pick the sourced match (original props). */
function glyphUriByLabel(label: string): string | undefined {
  const all = screen.UNSAFE_queryAllByProps({accessibilityLabel: label} as never) as unknown as Array<any>
  const found = all.find(el => el.props?.source !== undefined)
  const src = found?.props?.source as {uri?: unknown} | undefined
  return typeof src?.uri === 'string' ? src.uri : undefined
}

describe('default unicode-emoji art (OpenMoji)', () => {
  it('renders UnicodeEmoji without a style as OpenMoji art', () => {
    renderThemed(<UnicodeEmoji sequence="👋" />)
    expect(screen.getByLabelText('👋')).toBeTruthy()
    expect(glyphUriByLabel('👋')).toContain('openmoji')
  })

  it('still honours an explicit Twemoji style', () => {
    renderThemed(<UnicodeEmoji sequence="👋" style="twemoji" />)
    expect(glyphUriByLabel('👋')).toContain('twemoji')
  })

  it('renders the system style as device-font text, never a broken image', () => {
    renderThemed(<UnicodeEmoji sequence="👋" style="system" />)
    expect(screen.getByText('👋')).toBeTruthy()
  })

  it('renders RichText unicode emoji as OpenMoji art unless told otherwise', () => {
    renderThemed(<RichText nodes={contentFromMfm('hi 👋')} />)
    expect(glyphUriByLabel('👋')).toContain('openmoji')
  })

  it('renders RichText with an explicit style override', () => {
    renderThemed(<RichText nodes={contentFromMfm('hi 👋')} emojiStyle="twemoji" />)
    expect(glyphUriByLabel('👋')).toContain('twemoji')
  })
})
