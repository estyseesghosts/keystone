import {render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'
import {Body, Caption, Heading} from '#/alf/typography'
import {SysDebug} from '#/sys/SysDebug'

// WCAG 2.x contrast (repair X10.2, audit a11y 9): every text token must
// meet AA (4.5:1) on every surface it can sit on. `faint` is non-essential
// text only; the pairs where it sits on a secondary surface are explicitly
// allowlisted below (each still clears the 3:1 large-text/icon floor).
const AA_NORMAL_TEXT = 4.5
const LARGE_TEXT_FLOOR = 3

function channelToLinear(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (!m) throw new Error(`contrast test needs #rrggbb, got ${hex}`)
  const [r, g, b] = [m[1], m[2], m[3]].map(h =>
    channelToLinear(parseInt(h, 16)),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const hi = Math.max(relativeLuminance(a), relativeLuminance(b))
  const lo = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT_TOKENS = ['text', 'muted', 'faint'] as const
const SURFACES = ['bg', 'bgSoft', 'raise'] as const

// Below-AA pairs that ship anyway. A stale entry (now >= 4.5), a sub-3:1
// pair, or an entry matching no real pair fails the test, so this list
// can neither silently grow nor rot.
const DECORATIVE_ALLOWLIST: Record<string, string> = {
  // Measured 4.20:1 and 3.84:1 — faint captions inside secondary chrome.
  'light:faint on bgSoft': 'non-essential captions on secondary surfaces only',
  'light:faint on raise': 'non-essential captions on secondary surfaces only',
  // Measured 4.38:1.
  'dark:faint on raise': 'non-essential captions on secondary surfaces only',
}

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

  it('meets WCAG AA for every text-token x surface pair except allowlisted decorative ones', () => {
    const failures: string[] = []
    const seen = new Set<string>()
    for (const mode of ['light', 'dark'] as const) {
      const palette = themes[mode].palette
      for (const text of TEXT_TOKENS) {
        for (const surface of SURFACES) {
          const key = `${mode}:${text} on ${surface}`
          const ratio = contrastRatio(palette[text], palette[surface])
          if (DECORATIVE_ALLOWLIST[key]) {
            seen.add(key)
            if (ratio < LARGE_TEXT_FLOOR) {
              failures.push(
                `${key} is allowlisted but ${ratio.toFixed(2)}:1 is below the 3:1 floor`,
              )
            }
            if (ratio >= AA_NORMAL_TEXT) {
              failures.push(
                `${key} now passes at ${ratio.toFixed(2)}:1 — remove it from the allowlist`,
              )
            }
          } else if (ratio < AA_NORMAL_TEXT) {
            failures.push(
              `${key} is ${ratio.toFixed(2)}:1, below 4.5:1, and not allowlisted`,
            )
          }
        }
      }
    }
    for (const key of Object.keys(DECORATIVE_ALLOWLIST)) {
      if (!seen.has(key)) {
        failures.push(`allowlist entry ${key} matches no text-token x surface pair`)
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps the disabled-button label token at or above 3:1 on every surface', () => {
    // Button's disabled label is `muted` on a hollow (transparent) chrome,
    // so it can sit on any surface. Pinned at the 3:1 floor the slice
    // requires (it clears 4.5 everywhere today, per the matrix above).
    const failures: string[] = []
    for (const mode of ['light', 'dark'] as const) {
      const palette = themes[mode].palette
      for (const surface of SURFACES) {
        const ratio = contrastRatio(palette.muted, palette[surface])
        if (ratio < LARGE_TEXT_FLOOR) {
          failures.push(
            `${mode}:muted on ${surface} is ${ratio.toFixed(2)}:1, below 3:1`,
          )
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps the primary-button inverted pair at AA', () => {
    // Enabled primary labels the theme background on the borderStrong
    // fill; the disabled restyle must not regress the enabled pair.
    for (const mode of ['light', 'dark'] as const) {
      const palette = themes[mode].palette
      expect(
        contrastRatio(palette.bg, palette.borderStrong),
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    }
  })
})
