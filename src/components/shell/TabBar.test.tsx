// P6.5 shell layout: the bell badge overlays the glyph (out of flow) so
// the tab bar stays exactly SHELL_TAB_BAR_HEIGHT with the badge visible,
// and the tab's accessibility label carries the count.
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'
import {SafeAreaProvider} from 'react-native-safe-area-context'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {notificationsCountQueryKey} from '#/state/queries/keys'

import {SHELL_TAB_BAR_HEIGHT, ShellTabBar} from './TabBar'

jest.mock('#/state/session/SessionProvider', () => {
  const actual = jest.requireActual('#/state/session/SessionProvider')
  return {...actual, useOptionalActiveSession: () => ({id: 'sess-tab', accountId: 'alice'})}
})

function testClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 60_000}}})
}

function renderBar(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider i18n={i18n}>
        <SafeAreaProvider
          initialMetrics={{
            frame: {x: 0, y: 0, width: 390, height: 844},
            insets: {top: 47, bottom: 0, left: 0, right: 0},
          }}>
          <ThemeProvider theme="light">
            <ShellTabBar leaf={{name: 'Home'}} />
          </ThemeProvider>
        </SafeAreaProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

function flatStyle(testID: string): Record<string, unknown> {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>
}

describe('ShellTabBar bell badge (P6.5)', () => {
  it('tab bar keeps its shape with the badge visible (badge is out of flow)', () => {
    const bare = testClient()
    const {unmount} = renderBar(bare)
    const bareTab = JSON.stringify(flatStyle('tab-Notifications'))
    unmount()

    const badged = testClient()
    badged.setQueryData(notificationsCountQueryKey('sess-tab'), 5)
    renderBar(badged)
    // The badge paints on the glyph…
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('5')
    // …without changing the tab's own box (the overlay is absolute).
    expect(JSON.stringify(flatStyle('tab-Notifications'))).toBe(bareTab)
    expect(SHELL_TAB_BAR_HEIGHT).toBe(72)
  })

  it('badge sits over the icon: relative wrap, absolute corner overlay', () => {
    const qc = testClient()
    qc.setQueryData(notificationsCountQueryKey('sess-tab'), 5)
    renderBar(qc)
    expect(flatStyle('notifications-icon-wrap').position).toBe('relative')
    const overlayStyle = flatStyle('notifications-badge-overlay')
    expect(overlayStyle.position).toBe('absolute')
    expect(overlayStyle.top).toBe(-6)
    expect(overlayStyle.right).toBe(-10)
  })

  it('tab accessibility label carries the count', () => {
    const qc = testClient()
    qc.setQueryData(notificationsCountQueryKey('sess-tab'), 3)
    renderBar(qc)
    const tab = screen.getByTestId('tab-Notifications') as unknown as {props: {accessibilityLabel?: unknown}}
    expect(tab.props.accessibilityLabel).toContain('3')
  })
})
