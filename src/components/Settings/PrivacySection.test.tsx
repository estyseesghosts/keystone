// Repair X2.5: the Privacy settings section wires the real prefs.
import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {createPrivacyStore} from '#/state/privacyShield'

import {PrivacySection} from './PrivacySection'

i18n.load('en', {})
i18n.activate('en')

function setup() {
  const storage = createMemoryStore()
  const store = createPrivacyStore(() => storage)
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <PrivacySection store={store} />
      </ThemeProvider>
    </I18nProvider>,
  )
  return store
}

describe('PrivacySection (repair X2.5)', () => {
  it('defaults to tap-to-unfurl with the shield off', () => {
    setup()
    expect(screen.getByTestId('settings-section-privacy')).toBeTruthy()
    expect(screen.getByTestId('link-preview-tap').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('privacy-shield-row-toggle').props.accessibilityState).toMatchObject({
      checked: false,
    })
  })

  it('switching the preview mode persists the pref', () => {
    const store = setup()
    fireEvent.press(screen.getByTestId('link-preview-auto-public'))
    expect(store.getLinkPreviewMode()).toBe('auto-public')
    expect(screen.getByTestId('link-preview-auto-public').props.accessibilityState).toMatchObject({
      selected: true,
    })
    fireEvent.press(screen.getByTestId('link-preview-off'))
    expect(store.getLinkPreviewMode()).toBe('off')
  })

  it('toggling the shield persists the pref', () => {
    const store = setup()
    fireEvent.press(screen.getByTestId('privacy-shield-row-toggle'))
    expect(store.getPrivacyShield()).toBe(true)
    fireEvent.press(screen.getByTestId('privacy-shield-row-toggle'))
    expect(store.getPrivacyShield()).toBe(false)
  })

  it('names the missing OS-level blocking honestly instead of faking it', () => {
    setup()
    expect(screen.getByTestId('placeholder-screenshot-blocking')).toBeTruthy()
  })
})
