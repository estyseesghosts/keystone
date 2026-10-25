// RTL icon flips (X9.6): directional glyphs mirror, action glyphs do not.
//
// `isRtlNow` is forced on via a partial mock of `#/locale/i18n` (no global
// `I18nManager` mutation, no storage writes); the LTR default is covered by
// `icons.test.tsx` (no transform anywhere).
jest.mock('#/locale/i18n', () => {
  const actual = jest.requireActual('#/locale/i18n')
  return {...actual, isRtlNow: () => true}
})

import {render} from '@testing-library/react-native'

import type {ComponentType} from 'react'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'

import {
  BackIcon,
  CollapseIcon,
  ExpandIcon,
  HomeIcon,
  LoginIcon,
  ReplyIcon,
} from '../icons'

function scaleXOf(Icon: ComponentType<{size?: number; color?: string}>): unknown {
  const tree = render(
    <ThemeProvider theme="light">
      <Icon size={24} color={themes.light.palette.text} />
    </ThemeProvider>,
  )
  const json = JSON.stringify(tree.toJSON())
  tree.unmount()
  return json.includes('scaleX') ? -1 : 1
}

describe('icons in RTL', () => {
  it('flips back and sidebar chevrons', () => {
    expect(scaleXOf(BackIcon)).toBe(-1)
    expect(scaleXOf(CollapseIcon)).toBe(-1)
    expect(scaleXOf(ExpandIcon)).toBe(-1)
  })
  it('leaves action glyphs (home, reply, login) unflipped', () => {
    expect(scaleXOf(HomeIcon)).toBe(1)
    expect(scaleXOf(ReplyIcon)).toBe(1)
    expect(scaleXOf(LoginIcon)).toBe(1)
  })
})
