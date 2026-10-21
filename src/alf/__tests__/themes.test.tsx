import {render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'
import {Body, Caption, Heading} from '#/alf/typography'
import {SysDebug} from '#/sys/SysDebug'

describe('themes', () => {
  it('ships light and dark palettes with grey values only', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const hex of Object.values(themes[mode].palette)) {
        const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(
          hex,
        )
        expect(m).toBeTruthy()
        expect([m![1], m![2], m![3]].every(c => c === m![1])).toBe(true)
      }
    }
    // Contrast direction without pinning exact literals: light text is
    // darker than the light background; the dark theme inverts the pair.
    // A theme edit that flips either pairing fails here instead of
    // shipping black-on-dark / white-on-light.
    const luminance = (hex: string): number =>
      parseInt(hex.slice(1, 3), 16) / 255
    expect(luminance(themes.light.palette.text)).toBeLessThan(
      luminance(themes.light.palette.bg),
    )
    expect(luminance(themes.dark.palette.bg)).toBeLessThan(
      luminance(themes.dark.palette.text),
    )
    expect(themes.light.palette.text).not.toBe(themes.light.palette.bg)
    expect(themes.dark.palette.text).not.toBe(themes.dark.palette.bg)
  })

  it('renders the debug screen in both modes with all swatches', () => {
    for (const mode of ['light', 'dark'] as const) {
      const {unmount} = render(
        <ThemeProvider theme={mode}>
          <SysDebug />
        </ThemeProvider>,
      )
      expect(screen.getByTestId(`sys-debug-${mode}`)).toBeTruthy()
      for (const key of Object.keys(themes[mode].palette)) {
        expect(screen.getByTestId(`swatch-${key}`)).toBeTruthy()
      }
      unmount()
    }
  })

  it('renders type variants', () => {
    render(
      <ThemeProvider theme="light">
        <Heading>h</Heading>
        <Body>b</Body>
        <Caption>c</Caption>
      </ThemeProvider>,
    )
    expect(screen.getByText('h')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    expect(screen.getByText('c')).toBeTruthy()
  })
})
