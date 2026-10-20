import {getStateFromPath} from '@react-navigation/native'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {linking, Navigation} from '#/Navigation'
import {i18n} from '#/locale/i18n'
import {Root} from '#/Root'

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `keystone://${path}`,
}))

// Pin the phone shell (the primary target). Jest's default window (750px)
// is the rail cut point, where tab entries render as icons without labels.
jest.mock('#/alf/useViewportWidth', () => ({
  useViewportWidth: () => 390,
}))

// Seed for the plan §3.3 provider-regression guard: the app boots and
// renders. Slice 3.4 replaced the Home placeholder with the real Home
// screen (signed-out honest state); fixture-backed tests land per slice.
describe('App', () => {
  it('boots into the Home screen', async () => {
    render(<Root />)
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })
})

describe('Navigation', () => {
  it('switches tabs', async () => {
    render(<Root />)
    fireEvent.press(await screen.findByTestId('tab-Explore'))
    expect(await screen.findByText('Explore — not built')).toBeTruthy()
  })

  it('maps Keystone URLs to routes', () => {
    const sys = getStateFromPath('/sys/debug', linking.config)
    expect(JSON.stringify(sys)).toMatch(/SysDebug/)

    const note = getStateFromPath('/notes/abc', linking.config)
    expect(JSON.stringify(note)).toMatch(/"id":"abc"/)

    const network = getStateFromPath('/network/social', linking.config)
    expect(JSON.stringify(network)).toMatch(/Network/)
    expect(JSON.stringify(network)).toMatch(/social/)
  })

  it('accepts an initial state (deep-link landing)', () => {
    render(
      <I18nProvider i18n={i18n}>
        <Navigation
          initialState={{
            routes: [{name: 'SysDebug'}],
          }}
        />
      </I18nProvider>,
    )
    expect(screen.getByTestId('sys-debug-light')).toBeTruthy()
  })
})
