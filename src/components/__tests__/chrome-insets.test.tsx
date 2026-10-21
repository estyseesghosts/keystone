import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
import {StatusBar, StyleSheet} from 'react-native'
import {SafeAreaProvider} from 'react-native-safe-area-context'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {space} from '#/alf/tokens'
import {themes} from '#/alf/themes'
import {ComposeFab} from '#/components/ComposeFab'
import {Lightbox} from '#/components/Lightbox'
import {useSystemUI} from '#/state/systemUI'

jest.mock('#/screens/HomeFeed', () => ({
  useActiveBackend: () => ({session: {id: 'sess-insets-1'}, backend: null}),
}))

jest.mock('#/alf/breakpoints', () => {
  const actual = jest.requireActual('#/alf/breakpoints')
  return {...actual, useShellLayout: () => 'mobile'}
})

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native')
  return {...actual, useNavigation: () => ({navigate: jest.fn()})}
})

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn().mockResolvedValue(undefined),
  getBackgroundColorAsync: jest.fn().mockResolvedValue(null),
}))

import * as SystemUIModule from 'expo-system-ui'

const setRootBg = SystemUIModule.setBackgroundColorAsync as unknown as jest.Mock

i18n.load('en', {})
i18n.activate('en')

const METRICS = (insets: {top: number; bottom: number; left: number; right: number}) => ({
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets,
})

function imageMedia(over: Partial<Media> = {}): Media {
  return {
    id: 'm1',
    kind: 'image',
    mimeType: 'image/png',
    url: 'https://cdn.example/i1.png',
    previewUrl: null,
    name: 'i1.png',
    description: 'Alt caption',
    blurhash: null,
    isSensitive: false,
    size: 10,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
    ...over,
  } as Media
}

function renderFab(bottom: number) {
  return render(
    <I18nProvider i18n={i18n}>
      <SafeAreaProvider initialMetrics={METRICS({top: 47, bottom, left: 0, right: 0})}>
        <ThemeProvider theme="light">
          <ComposeFab />
        </ThemeProvider>
      </SafeAreaProvider>
    </I18nProvider>,
  )
}

function fabBottom(): number | undefined {
  const wraps = screen.root.findAll(node => typeof node.type === 'string' && (() => {
    const flat = StyleSheet.flatten(node.props?.style) as {position?: string; right?: number} | null
    return !!flat && flat.position === 'absolute' && flat.right === 16
  })())
  expect(wraps).toHaveLength(1)
  return (StyleSheet.flatten(wraps[0].props.style) as {bottom?: number}).bottom
}

describe('ComposeFab safe-area offset (N21)', () => {
  it('sits at the base clearance with no inset', () => {
    renderFab(0)
    expect(screen.getByTestId('compose-fab')).toBeTruthy()
    expect(fabBottom()).toBe(88)
  })

  it('stacks the home-indicator inset on top of the base clearance', () => {
    renderFab(34)
    expect(screen.getByTestId('compose-fab')).toBeTruthy()
    expect(fabBottom()).toBe(88 + 34)
  })
})

describe('Lightbox safe-area chrome (N21)', () => {
  function renderBox(bottom: number, top = 47) {
    return render(
      <I18nProvider i18n={i18n}>
        <SafeAreaProvider initialMetrics={METRICS({top, bottom, left: 0, right: 0})}>
          <ThemeProvider theme="light">
            <Lightbox
              media={[imageMedia()]}
              index={0}
              onClose={() => {}}
              testID="lb-insets"
            />
          </ThemeProvider>
        </SafeAreaProvider>
      </I18nProvider>,
    )
  }

  it('pads chrome below the notch and caption above the home indicator', () => {
    renderBox(34)
    const chrome = screen.getByTestId('lightbox-chrome')
    const caption = screen.getByTestId('lightbox-caption')
    const flat = (s: unknown) => Object.assign({}, ...((Array.isArray(s) ? s : [s]) as object[])) as Record<string, number>
    expect(flat(chrome.props.style).paddingTop).toBe(47 + space.md)
    expect(flat(caption.props.style).paddingBottom).toBe(34 + space.md)
  })

  it('falls back to the base padding with zero insets', () => {
    renderBox(0, 0)
    const chrome = screen.getByTestId('lightbox-chrome')
    const caption = screen.getByTestId('lightbox-caption')
    const flat = (s: unknown) => Object.assign({}, ...((Array.isArray(s) ? s : [s]) as object[])) as Record<string, number>
    expect(flat(chrome.props.style).paddingTop).toBe(space.md)
    expect(flat(caption.props.style).paddingBottom).toBe(space.md)
  })
})

describe('useSystemUI single owner (P11)', () => {
  function Harness() {
    useSystemUI()
    return null
  }

  function expectSystemUI(theme: 'light' | 'dark', barStyle: string, root: string) {
    const setBarStyle = jest.spyOn(StatusBar, 'setBarStyle').mockImplementation(() => {})
    setRootBg.mockClear()
    const {unmount} = render(
      <ThemeProvider theme={theme}>
        <Harness />
      </ThemeProvider>,
    )
    expect(setBarStyle).toHaveBeenCalledWith(barStyle, true)
    expect(setRootBg).toHaveBeenCalledWith(root)
    setBarStyle.mockRestore()
    unmount()
  }

  it('light theme uses dark-content bars and a white root', () => {
    expectSystemUI('light', 'dark-content', themes.light.palette.bg)
  })

  it('dark theme uses light-content bars and a near-black root', () => {
    expectSystemUI('dark', 'light-content', themes.dark.palette.bg)
  })
})
