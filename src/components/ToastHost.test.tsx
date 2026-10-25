// ToastHost (rn-ui M4): floats above the mobile tab bar (safe-area inset
// + bar height), pauses auto-dismiss while hovered/focused, and dismisses
// on tap. Live-region semantics are X10.1 — not covered here.

import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {AccessibilityInfo, StyleSheet} from 'react-native'
import {SafeAreaProvider} from 'react-native-safe-area-context'

import {ThemeProvider} from '#/alf/index'
import {clearToasts, showToast} from '#/lib/toast'
import {i18n} from '#/locale/i18n'

import {SHELL_TAB_BAR_HEIGHT} from './shell/TabBar'
import {ToastHost} from './ToastHost'

const layoutHolder: {layout: 'mobile' | 'rail'} = {layout: 'mobile'}
jest.mock('#/alf/breakpoints', () => {
  const actual = jest.requireActual('#/alf/breakpoints')
  return {...actual, useShellLayout: () => layoutHolder.layout}
})

function renderHost(bottom: number) {
  return render(
    <I18nProvider i18n={i18n}>
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 390, height: 844},
          insets: {top: 47, bottom, left: 0, right: 0},
        }}>
        <ThemeProvider theme="light">
          <ToastHost />
        </ThemeProvider>
      </SafeAreaProvider>
    </I18nProvider>,
  )
}

function hostBottom(): number | undefined {
  const flat = StyleSheet.flatten(screen.getByTestId('toast-host').props.style) as {
    bottom?: number
  }
  return flat.bottom
}

// The dismiss testID lands on the composite Pressable (owns onHoverIn/out,
// onFocus/Blur, onPress) and inner host Views (partial props): handler
// calls pick the match that owns them.
function dismissEl(id: number): any {
  const all = screen.UNSAFE_queryAllByProps({testID: `toast-dismiss-${id}`} as never) as unknown as Array<any>
  const found = all.find(el => typeof el.props?.onHoverIn === 'function')
  if (!found) throw new Error(`no dismiss control for toast ${id} (${all.length} matches)`)
  return found
}

beforeEach(() => {
  layoutHolder.layout = 'mobile'
  clearToasts()
})

afterEach(() => {
  clearToasts()
  jest.useRealTimers()
})

describe('ToastHost position (rn-ui M4)', () => {
  it('floats above the mobile tab bar: inset + bar height + gap', () => {
    const {unmount} = renderHost(34)
    try {
      let id = 0
      act(() => {
        id = showToast('hello')
      })
      expect(screen.getByTestId(`toast-${id}`)).toBeTruthy()
      expect(hostBottom()).toBe(34 + SHELL_TAB_BAR_HEIGHT + 16)
    } finally {
      unmount()
    }
  })

  it('keeps the historic float margin on shells without a tab bar', () => {
    layoutHolder.layout = 'rail'
    const {unmount} = renderHost(0)
    try {
      let id = 0
      act(() => {
        id = showToast('hello')
      })
      expect(hostBottom()).toBe(24)
    } finally {
      unmount()
    }
  })
})

describe('ToastHost timer + early dismiss (rn-ui M4)', () => {
  it('pauses auto-dismiss while hovered/focused, resumes after', () => {
    jest.useFakeTimers()
    const {unmount} = renderHost(0)
    try {
      let id = 0
      act(() => {
        id = showToast('paused?')
      })
      const dismiss = dismissEl(id)
      act(() => {
        dismiss.props.onHoverIn()
      })
      act(() => {
        jest.advanceTimersByTime(10_000)
      })
      expect(screen.getByTestId(`toast-${id}`)).toBeTruthy()
      act(() => {
        dismiss.props.onHoverOut()
      })
      act(() => {
        jest.advanceTimersByTime(4_000)
      })
      expect(screen.queryByTestId(`toast-${id}`)).toBeNull()
    } finally {
      unmount()
    }
  })

  it('dismisses early on tap', () => {
    jest.useFakeTimers()
    const {unmount} = renderHost(0)
    try {
      let id = 0
      act(() => {
        id = showToast('tap me')
      })
      fireEvent.press(dismissEl(id))
      expect(screen.queryByTestId(`toast-${id}`)).toBeNull()
    } finally {
      unmount()
    }
  })
})

describe('ToastHost announcement (a11y 6)', () => {
  it('renders info toasts as a polite live region with no alert role', () => {
    const {unmount} = renderHost(0)
    try {
      let id = 0
      act(() => {
        id = showToast('saved')
      })
      const toast = screen.getByTestId(`toast-${id}`)
      expect(toast.props.accessibilityLiveRegion).toBe('polite')
      expect(toast.props.accessibilityRole).toBeUndefined()
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('renders error toasts as an assertive alert', () => {
    const {unmount} = renderHost(0)
    try {
      let id = 0
      act(() => {
        id = showToast('failed', {kind: 'error'})
      })
      // (Role-queried: the toast sits inside the accessible dismiss
      // control, so assert the props directly.)
      const toast = screen.getByTestId(`toast-${id}`)
      expect(toast.props.accessibilityLiveRegion).toBe('assertive')
      expect(toast.props.accessibilityRole).toBe('alert')
    } finally {
      unmount()
    }
  })

  it('announces the head message on native via AccessibilityInfo', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {})
    const {unmount} = renderHost(0)
    try {
      act(() => {
        showToast('hello native')
      })
      expect(announce).toHaveBeenCalledWith('hello native')
    } finally {
      unmount()
      announce.mockRestore()
    }
  })
})
