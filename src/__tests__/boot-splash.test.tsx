import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {act, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {BootSplash} from '#/Root'

// `BootSplash` rides in via `#/Root`, which pulls navigation/linking:
// mock `expo-linking` the way the other app-shell tests do so module
// load never touches scheme resolution in tests.
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

i18n.load('en', {})
i18n.activate('en')

function renderSplash() {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <BootSplash />
      </ThemeProvider>
    </I18nProvider>,
  )
}

// Repair X3.5: boot never renders a blank screen — a translated loader with
// an accessible label shows immediately, and a "taking longer" line appears
// after 3 s. (On the old code `Root` rendered `null` until ready, so the
// loader assertions fail without the fix.)
describe('BootSplash (X3.5 boot never blocks)', () => {
  it('shows a labelled loader immediately, with no slow line yet', () => {
    renderSplash()
    expect(screen.getByTestId('boot-loading')).toBeTruthy()
    expect(screen.getByTestId('boot-loading-indicator')).toBeTruthy()
    expect(screen.getByLabelText('Loading Keystone')).toBeTruthy()
    expect(screen.queryByText('Taking longer than usual. Check your connection.')).toBeNull()
  })

  it('adds the slow line after 3 s', async () => {
    jest.useFakeTimers()
    try {
      renderSplash()
      expect(screen.queryByText('Taking longer than usual. Check your connection.')).toBeNull()
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000)
      })
      expect(screen.getByText('Taking longer than usual. Check your connection.')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})
