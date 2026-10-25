// Repair X2.5: the privacy-shield overlay, driven by a mocked AppState.
import {act, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'
import {AppState} from 'react-native'
import type {ReactNode} from 'react'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'

import {PrivacyShieldHost} from './PrivacyShieldHost'
import {
  createPrivacyStore,
  resetConversationShieldForTests,
  setConversationShieldActive,
} from './privacyShield'

i18n.load('en', {})
i18n.activate('en')

function renderHost(ui: ReactNode) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function setupStore(shield: boolean) {
  const storage = createMemoryStore()
  const store = createPrivacyStore(() => storage)
  store.setPrivacyShield(shield)
  return store
}

type AppStateHandler = (state: string) => void

function mockAppState() {
  const box: {handler: AppStateHandler | null} = {handler: null}
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((...args: unknown[]) => {
      box.handler = args[1] as AppStateHandler
      return {remove: jest.fn()}
    }) as never)
  return {
    spy,
    fire: (state: 'active' | 'background' | 'inactive') => {
      const handler = box.handler
      if (!handler) throw new Error('AppState listener not attached')
      act(() => {
        handler(state)
      })
    },
    restore: () => spy.mockRestore(),
  }
}

describe('PrivacyShieldHost (repair X2.5, D6)', () => {
  beforeEach(() => {
    resetConversationShieldForTests()
  })

  afterEach(() => {
    resetConversationShieldForTests()
  })

  it('renders nothing when the shield is off, even backgrounded', () => {
    const app = mockAppState()
    try {
      const {toJSON} = renderHost(<PrivacyShieldHost store={setupStore(false)} />)
      app.fire('background')
      expect(screen.queryByTestId('privacy-shield')).toBeNull()
      expect(toJSON()).toBeNull()
    } finally {
      app.restore()
    }
  })

  it('renders nothing while active, even when the user opted in', () => {
    const app = mockAppState()
    try {
      renderHost(<PrivacyShieldHost store={setupStore(true)} />)
      app.fire('active')
      expect(screen.queryByTestId('privacy-shield')).toBeNull()
    } finally {
      app.restore()
    }
  })

  it('covers the app on background when the user opted in', () => {
    const app = mockAppState()
    try {
      renderHost(<PrivacyShieldHost store={setupStore(true)} />)
      expect(screen.queryByTestId('privacy-shield')).toBeNull()
      app.fire('background')
      expect(screen.getByTestId('privacy-shield')).toBeTruthy()
      app.fire('inactive')
      expect(screen.getByTestId('privacy-shield')).toBeTruthy()
      app.fire('active')
      expect(screen.queryByTestId('privacy-shield')).toBeNull()
    } finally {
      app.restore()
    }
  })

  it('is always on while a conversation screen is focused, pref or not', () => {
    const app = mockAppState()
    try {
      renderHost(<PrivacyShieldHost store={setupStore(false)} />)
      act(() => {
        setConversationShieldActive(true)
      })
      expect(screen.getByTestId('privacy-shield')).toBeTruthy()
      app.fire('active')
      expect(screen.getByTestId('privacy-shield')).toBeTruthy()
      act(() => {
        setConversationShieldActive(false)
      })
      expect(screen.queryByTestId('privacy-shield')).toBeNull()
    } finally {
      app.restore()
    }
  })
})
