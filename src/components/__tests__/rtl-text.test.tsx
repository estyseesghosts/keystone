// RTL user-content direction (X9.6): server-supplied strings render with
// `writingDirection: 'auto'` so mixed-direction post bodies, names, and
// bios follow their own first strong character.
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'

import {contentFromMfm} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {DisplayName} from '#/components/DisplayName'
import {RichText} from '#/components/RichText'

i18n.load('en', {})
i18n.activate('en')

function renderThemed(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

/** Flatten a host element's style prop (arrays nest one level here). */
function flatStyle(el: {props: {style?: unknown}}): Record<string, unknown> {
  const {style} = el.props
  const list = Array.isArray(style) ? style.flat() : [style]
  return Object.assign({}, ...list.filter(s => s != null && typeof s === 'object'))
}

describe('user-content writing direction', () => {
  it('RichText post bodies use writingDirection auto', () => {
    renderThemed(<RichText nodes={contentFromMfm('hello world')} />)
    expect(flatStyle(screen.getByText('hello world'))).toMatchObject({writingDirection: 'auto'})
  })
  it('DisplayName uses writingDirection auto', () => {
    renderThemed(<DisplayName account={{displayName: 'Ann', emojis: {}}} />)
    expect(flatStyle(screen.getByText('Ann'))).toMatchObject({writingDirection: 'auto'})
  })
})
