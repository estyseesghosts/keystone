// Repair X2.5 (privacy F7, UI half): a node `src` that does not match
// a URL in the post's packed emoji map never loads — the literal
// `:code:` renders instead.
import {render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {CustomEmojiGlyph} from '#/components/EmojiImage'

function renderGlyph(ui: React.ReactElement) {
  return render(<ThemeProvider theme="light">{ui}</ThemeProvider>)
}

describe('CustomEmojiGlyph packed-source guard (repair X2.5)', () => {
  it('loads a node src that matches the packed map', () => {
    renderGlyph(
      <CustomEmojiGlyph
        name="wave"
        host={null}
        src="https://packed.example/wave.png"
        packed={{':wave:': 'https://packed.example/wave.png'}}
        testID="g-ok"
      />,
    )
    expect(screen.getByTestId('g-ok').props.source?.uri).toBe('https://packed.example/wave.png')
  })

  it('renders the literal :code: for a node src outside the packed map (tracking pixel)', () => {
    renderGlyph(
      <CustomEmojiGlyph
        name="sneaky"
        host={null}
        src="http://tracker.example/p.gif?u=abc"
        packed={{':wave:': 'https://packed.example/wave.png'}}
        testID="g-track"
      />,
    )
    // The fallback is text (no image `source`), never the tracker URL.
    expect(screen.getByText(':sneaky:')).toBeTruthy()
    expect(screen.getByTestId('g-track').props.source).toBeUndefined()
  })

  it('renders the literal :code: when the packed map is empty', () => {
    renderGlyph(
      <CustomEmojiGlyph name="sneaky" host={null} src="https://tracker.example/p.gif" packed={{}} testID="g-empty" />,
    )
    expect(screen.getByText(':sneaky:')).toBeTruthy()
    expect(screen.getByTestId('g-empty').props.source).toBeUndefined()
  })

  it('keeps the picker path (no packed map): the vetted src loads', () => {
    renderGlyph(
      <CustomEmojiGlyph name="pick" host={null} src="https://picker.example/pick.png" packed={null} testID="g-pick" />,
    )
    expect(screen.getByTestId('g-pick').props.source?.uri).toBe('https://picker.example/pick.png')
  })
})
