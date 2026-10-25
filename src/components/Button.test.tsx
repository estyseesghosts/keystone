// Disabled buttons (repair X10.2, audit a11y 9): a disabled Button must
// NOT halve the whole box's opacity (that dims the label too). The label
// drops to the muted text token (>= 3:1 on every surface, pinned in the
// alf contrast test) and the chrome hollows out to a dashed outline — a
// shape/pattern cue, not a colour-only one. Focus/hover behaviour stays in
// the shared Pressable and is asserted structurally here (the style
// function still resolves).
import {render, screen} from '@testing-library/react-native'
import {StyleSheet, type StyleProp, type ViewStyle} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {themes, type ThemeName} from '#/alf/themes'
import {Button} from '#/components/Button'

function renderButton(theme: ThemeName, props: {disabled?: boolean; variant?: 'primary' | 'secondary'}) {
  render(
    <ThemeProvider theme={theme}>
      <Button
        label="Post"
        onPress={() => {}}
        testID="btn"
        variant={props.variant}
        disabled={props.disabled}
        disabledReason={props.disabled ? 'Over the character limit.' : undefined}
      />
    </ThemeProvider>,
  )
  return screen.getByTestId('btn')
}

// The shared Pressable wraps the Button's style array in a state function;
// resolve it as resting (no press/hover/focus) like the other chrome tests.
// Accepts a plain array too, so the test survives a query-semantics change.
function restingBoxStyle(el: {props: {style?: unknown}}) {
  const {style} = el.props
  const resolved =
    typeof style === 'function'
      ? (style as (s: {pressed: boolean}) => unknown)({pressed: false})
      : style
  return StyleSheet.flatten(resolved as StyleProp<ViewStyle>) as
    | {backgroundColor?: string; borderColor?: string; borderStyle?: string; opacity?: number}
    | undefined
}

describe.each(['light', 'dark'] as const)('Button disabled state (%s theme)', theme => {
  it('hollows out instead of dimming, with a muted label and AT state', () => {
    const el = renderButton(theme, {disabled: true})
    const box = restingBoxStyle(el)
    expect(box?.opacity).toBeUndefined()
    expect(box?.backgroundColor).toBe('transparent')
    expect(box?.borderStyle).toBe('dashed')
    expect(box?.borderColor).toBe(themes[theme].palette.edge)
    const label = StyleSheet.flatten(screen.getByText('Post').props.style) as
      | {color?: string}
      | undefined
    expect(label?.color).toBe(themes[theme].palette.muted)
    expect(el.props.accessibilityState?.disabled).toBe(true)
    expect(el.props.accessibilityLabel).toContain('Over the character limit.')
  })

  it('keeps the enabled primary pair solid with a background label', () => {
    const el = renderButton(theme, {})
    const box = restingBoxStyle(el)
    expect(box?.opacity).toBeUndefined()
    expect(box?.backgroundColor).toBe(themes[theme].palette.borderStrong)
    expect(box?.borderStyle).toBeUndefined()
    const label = StyleSheet.flatten(screen.getByText('Post').props.style) as
      | {color?: string}
      | undefined
    expect(label?.color).toBe(themes[theme].palette.bg)
    expect(el.props.accessibilityState?.disabled).toBeFalsy()
  })

  it('keeps the enabled secondary pair solid-bordered with a text label', () => {
    const el = renderButton(theme, {variant: 'secondary'})
    const box = restingBoxStyle(el)
    expect(box?.backgroundColor).toBe('transparent')
    expect(box?.borderStyle).not.toBe('dashed')
    const label = StyleSheet.flatten(screen.getByText('Post').props.style) as
      | {color?: string}
      | undefined
    expect(label?.color).toBe(themes[theme].palette.text)
    expect(el.props.accessibilityState?.disabled).toBeFalsy()
  })
})
