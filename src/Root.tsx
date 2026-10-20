import {I18nProvider} from '@lingui/react'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {Navigation} from '#/Navigation'

// App root: providers + navigation. Shared by native and web entries;
// platform divergences (if any) land in App.web.tsx.
export function Root() {
  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <Navigation />
      </ThemeProvider>
    </I18nProvider>
  )
}
