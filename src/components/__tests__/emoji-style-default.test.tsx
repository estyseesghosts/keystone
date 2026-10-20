import {render, screen} from '@testing-library/react-native'

import {contentFromMfm} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {RichText} from '#/components/RichText'

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

describe('default unicode-emoji art (OpenMoji)', () => {
  it('renders UnicodeEmoji without a style as OpenMoji art', () => {
    renderThemed(<UnicodeEmoji sequence="👋" />)
    const image = screen.getByLabelText('👋')
    expect(image.props.source.uri).toContain('openmoji')
  })

  it('still honours an explicit Twemoji style', () => {
    renderThemed(<UnicodeEmoji sequence="👋" style="twemoji" />)
    expect(screen.getByLabelText('👋').props.source.uri).toContain('twemoji')
  })

  it('renders the system style as device-font text, never a broken image', () => {
    renderThemed(<UnicodeEmoji sequence="👋" style="system" />)
    expect(screen.getByText('👋')).toBeTruthy()
  })

  it('renders RichText unicode emoji as OpenMoji art unless told otherwise', () => {
    renderThemed(<RichText nodes={contentFromMfm('hi 👋')} />)
    expect(screen.getByLabelText('👋').props.source.uri).toContain('openmoji')
  })

  it('renders RichText with an explicit style override', () => {
    renderThemed(<RichText nodes={contentFromMfm('hi 👋')} emojiStyle="twemoji" />)
    expect(screen.getByLabelText('👋').props.source.uri).toContain('twemoji')
  })
})
