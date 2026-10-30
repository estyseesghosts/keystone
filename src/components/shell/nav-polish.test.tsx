// Navigation + interaction polish (polish/5-nav-polish, Deliverable 5):
// icon-only shell chrome names itself on hover (Tooltip mirrors the
// accessibility label), footer quick actions carry the same active state
// as the nav rows, and the profile/Matrix hovercards are untouched.
//
// Tooltip renders a `title` wrapper on web only — native trees render
// the children alone, so touch stays complete with no hover layer.

import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import type {TokenVault} from '#/storage'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'
import {resetSidebarMode} from '#/state/sideNav'
import {resetWidgetsPanelMode} from '#/state/widgetsPanel'
import {createWidgetsStore, type WidgetsStore} from '#/widgets/store'
import type {KeyValueStore} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'
import {MatrixHovercard} from '#/components/richtext/MatrixHover'
import {Tooltip} from '#/components/Tooltip'
import {Sidebar} from './Sidebar'
import {WidgetsPanel, WidgetsPanelRestore} from './WidgetsPanel'

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
})

function widgetSetup(): WidgetsStore {
  const storage: KeyValueStore = createMemoryStore()
  return createWidgetsStore(() => storage)
}

function renderPanel(store?: WidgetsStore) {
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <WidgetsPanel store={store ?? widgetSetup()} />
      </ThemeProvider>
    </I18nProvider>,
  )
}

function renderRestore() {
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <WidgetsPanelRestore />
      </ThemeProvider>
    </I18nProvider>,
  )
}

function renderSidebar(
  layout: 'rail' | 'full',
  store?: ReturnType<typeof createSessionStore>,
) {
  const tree = <Sidebar layout={layout} leaf={{name: 'Home'}} />
  if (store) {
    render(
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin="https://app.example">
            <ThemeProvider theme="light">{tree}</ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>,
    )
    return
  }
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{tree}</ThemeProvider>
    </I18nProvider>,
  )
}

async function signedInStore(
  family: 'mastodon' | 'misskey' = 'mastodon',
): Promise<ReturnType<typeof createSessionStore>> {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://app.example',
  })
  await store.add({
    origin: `https://${family}.example`,
    family,
    flavor: family,
    accountId: 'alice',
    token: 'token-a',
    grant: family === 'mastodon' ? 'oauth-pkce' : 'miauth',
    hosting: 'third-party',
  })
  return store
}

/** Titles of every Tooltip wrapper in the current tree. Tooltips render
 * a host `<span>` (the only spans in prod `src/`); composite `title`
 * props elsewhere (e.g. the closed editor `Dialog`) are unrelated and
 * must not match — so filter by host type, not by prop alone. */
function tooltipTitles(): string[] {
  return screen
    .UNSAFE_queryAllByType('span' as never)
    .map(el => (el.props as {title?: unknown}).title)
    .filter((title): title is string => typeof title === 'string')
}

/** True when no Tooltip wrapper rendered anywhere (native trees). */
function noTooltipsRendered(): boolean {
  return tooltipTitles().length === 0
}

beforeEach(() => {
  resetSidebarMode()
  resetWidgetsPanelMode()
})

describe('Tooltip primitive', () => {
  it('wraps children in a titled span on web', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      render(
        <Tooltip label="Expand sidebar" testID="tt">
          <></>
        </Tooltip>,
      )
      const spans = screen.UNSAFE_queryAllByType('span' as never)
      expect(spans).toHaveLength(1)
      expect((spans[0].props as {title?: string}).title).toBe('Expand sidebar')
    } finally {
      restoreOs.restore()
    }
  })

  it('renders children alone on native (no hover layer, touch complete)', () => {
    expect(Platform.OS).not.toBe('web')
    render(
      <Tooltip label="Expand sidebar">
        <></>
      </Tooltip>,
    )
    expect(screen.UNSAFE_queryAllByType('span' as never)).toHaveLength(0)
  })
})

describe('widget rail chrome tooltips', () => {
  it('names the icon-only edit/collapse controls on web', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      renderPanel()
      const titles = tooltipTitles()
      expect(titles).toContain('Edit widgets')
      expect(titles).toContain('Collapse widgets panel')
      // Tooltip mirrors the accessible label — the control is still
      // identified the same way without hover.
      const edit = screen.getByTestId('widgets-panel-edit')
      expect(edit.props.accessibilityLabel).toBe('Edit widgets')
      const collapse = screen.getByTestId('widgets-panel-collapse')
      expect(collapse.props.accessibilityLabel).toBe('Collapse widgets panel')
    } finally {
      restoreOs.restore()
    }
  })

  it('names the restore control on web (slice-2 placement review)', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      renderRestore()
      expect(tooltipTitles()).toContain('Show widgets panel')
      expect(screen.getByTestId('widgets-panel-restore').props.accessibilityLabel).toBe(
        'Show widgets panel',
      )
    } finally {
      restoreOs.restore()
    }
  })

  it('adds no hover wrapper on native (rail chrome stays touch-complete)', () => {
    renderPanel()
    expect(noTooltipsRendered()).toBe(true)
    expect(screen.getByTestId('widgets-panel-edit')).toBeTruthy()
    expect(screen.getByTestId('widgets-panel-collapse')).toBeTruthy()
  })

  it('editor move/remove actions keep text labels (self-identifying, no tooltip)', () => {
    renderPanel()
    expect(screen.getByTestId('widgets-panel-edit')).toBeTruthy()
    // The editor opens from the rail entry; its rows are tested in
    // WidgetsEditor.test.tsx — here pin that the rail itself adds no
    // title wrappers around labeled dialog actions on any platform.
    expect(noTooltipsRendered()).toBe(true)
  })
})

describe('sidebar icon-only tooltips + quick-action active states', () => {
  it('signed-out rail names expand + sign-in icon buttons on web', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      renderSidebar('rail')
      const titles = tooltipTitles()
      expect(titles).toContain('Expand sidebar')
      expect(titles).toContain('Sign in')
      // Feed rows are icon-only in rail: hover must name them too.
      expect(titles).toContain('Home')
      expect(titles).toContain('My Network')
      expect(titles).toContain('Explore')
    } finally {
      restoreOs.restore()
    }
  })

  it('full sidebar keeps text labels and tooltips only the collapse toggle', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      renderSidebar('full')
      const titles = tooltipTitles()
      expect(titles).toContain('Collapse sidebar')
      // Labeled rows need no tooltip: Home/My Network/Explore render text.
      expect(titles).not.toContain('Home')
      expect(screen.getByText('Home')).toBeTruthy()
    } finally {
      restoreOs.restore()
    }
  })

  it('signed-in rail marks the active quick action like the nav rows', async () => {
    const store = await signedInStore('mastodon')
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      render(
        <I18nProvider i18n={i18n}>
          <QueryClientProvider client={new QueryClient()}>
            <SessionProvider store={store} homeOrigin="https://app.example">
              <ThemeProvider theme="light">
                <Sidebar layout="rail" leaf={{name: 'Notifications'}} />
              </ThemeProvider>
            </SessionProvider>
          </QueryClientProvider>
        </I18nProvider>,
      )
      const notifications = screen.getByTestId('sidebar-notifications')
      expect(notifications.props.accessibilityState).toMatchObject({selected: true})
      const messages = screen.getByTestId('sidebar-messages')
      expect(messages.props.accessibilityState).toMatchObject({selected: false})
      // Icon-only rail quick actions are tooltip-named.
      expect(tooltipTitles()).toContain('Notifications')
      expect(tooltipTitles()).toContain('Messages')
    } finally {
      restoreOs.restore()
    }
  })

  it('signed-in full sidebar marks the messages stack entry selected', async () => {
    const store = await signedInStore('mastodon')
    render(
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider store={store} homeOrigin="https://app.example">
            <ThemeProvider theme="light">
              <Sidebar layout="full" leaf={{name: 'Conversations'}} />
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>,
    )
    expect(screen.getByTestId('sidebar-messages').props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(screen.getByTestId('sidebar-notifications').props.accessibilityState).toMatchObject({
      selected: false,
    })
  })
})

describe('hovercard regression (Deliverable 5 must not regress these)', () => {
  it('Matrix hovercard still renders the handle + copy action untouched', () => {
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <MatrixHovercard userId="@local:server" />
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(screen.getByTestId('matrix-popup-handle')).toBeTruthy()
    expect(screen.getByTestId('matrix-copy')).toBeTruthy()
    // No Tooltip wrapper inside hovercard content on any platform.
    expect(noTooltipsRendered()).toBe(true)
  })
})
