import {createMemoryStore} from '@keystone/fedi'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'

import {createLocaleStore} from '#/locale/i18n'
import {LanguageSection} from './LanguageSection'

function renderSection(initial = 'en') {
  const storage = createMemoryStore({[ 'keystone.locale' ]: JSON.stringify(initial)})
  const store = createLocaleStore(() => storage)
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <LanguageSection store={store} />
      </ThemeProvider>
    </I18nProvider>,
  )
  return {storage, store}
}

describe('LanguageSection', () => {
  it('renders all 8 locales as a radio group with the stored one selected', () => {
    renderSection('fr')
    expect(screen.getByTestId('settings-section-language')).toBeTruthy()
    for (const code of ['en', 'fr', 'de', 'zh-CN', 'zh-TW', 'yue-HK', 'ja', 'hi']) {
      expect(screen.getByTestId(`locale-${code}`)).toBeTruthy()
    }
    expect(screen.getByTestId('locale-fr').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('locale-en').props.accessibilityState).toMatchObject({
      selected: false,
    })
  })

  it('switches locale at runtime and persists the code', () => {
    const {storage, store} = renderSection('en')
    fireEvent.press(screen.getByTestId('locale-ja'))
    expect(store.get()).toBe('ja')
    expect(storage.getItem('keystone.locale')).toBe(JSON.stringify('ja'))
    expect(i18n.locale).toBe('ja')
    // Back to English restores the singleton for other suites.
    fireEvent.press(screen.getByTestId('locale-en'))
    expect(store.get()).toBe('en')
  })
})
