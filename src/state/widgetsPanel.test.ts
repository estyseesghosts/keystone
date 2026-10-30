import {act, renderHook} from '@testing-library/react-native'

import {
  collapseSidebar,
  expandSidebar,
  getSidebarMode,
  resetSidebarMode,
} from '#/state/sideNav'
import {
  autoWidgetsPanelVisible,
  getWidgetsPanelMode,
  hideWidgetsPanel,
  resetWidgetsPanelMode,
  setWidgetsPanelMode,
  shouldShowWidgetsPanel,
  showWidgetsPanel,
  toggleWidgetsPanel,
  useWidgetsPanelMode,
  widgetsPanelAutoMinWidth,
} from '#/state/widgetsPanel'

beforeEach(() => {
  resetSidebarMode()
  resetWidgetsPanelMode()
})

describe('widgetsPanelAutoMinWidth', () => {
  it('fits the full sidebar + full feed + panel without squeezing', () => {
    // 220 + 600 + 332: derived from butterfly tokens, not a new breakpoint.
    expect(widgetsPanelAutoMinWidth()).toBe(1152)
  })
})

describe('autoWidgetsPanelVisible', () => {
  it('hides the panel on mobile, rail, and intermediate widths', () => {
    for (const width of [390, 720, 721, 800, 1000, 1001, 1050, 1100, 1151]) {
      expect(autoWidgetsPanelVisible(width)).toBe(false)
    }
  })

  it('shows the panel once the full three-region shell fits', () => {
    expect(autoWidgetsPanelVisible(1152)).toBe(true)
    expect(autoWidgetsPanelVisible(1280)).toBe(true)
    expect(autoWidgetsPanelVisible(2560)).toBe(true)
  })

  it('treats a missing viewport as hidden', () => {
    expect(autoWidgetsPanelVisible(0)).toBe(false)
    expect(autoWidgetsPanelVisible(Number.NaN)).toBe(false)
    expect(autoWidgetsPanelVisible(-100)).toBe(false)
  })
})

describe('shouldShowWidgetsPanel', () => {
  it('pins hidden whatever the width', () => {
    expect(shouldShowWidgetsPanel(1280, 'hidden')).toBe(false)
    expect(shouldShowWidgetsPanel(2560, 'hidden')).toBe(false)
  })

  it('follows the width rule in auto', () => {
    expect(shouldShowWidgetsPanel(1050, 'auto')).toBe(false)
    expect(shouldShowWidgetsPanel(1280, 'auto')).toBe(true)
  })
})

describe('widgets panel mode store', () => {
  it('round-trips through the hook', () => {
    const {result} = renderHook(() => useWidgetsPanelMode())
    expect(result.current).toBe('auto')
    act(() => {
      hideWidgetsPanel()
    })
    expect(result.current).toBe('hidden')
    expect(getWidgetsPanelMode()).toBe('hidden')
    act(() => {
      showWidgetsPanel()
    })
    expect(result.current).toBe('auto')
    act(() => {
      toggleWidgetsPanel()
    })
    expect(result.current).toBe('hidden')
    act(() => {
      toggleWidgetsPanel()
    })
    expect(result.current).toBe('auto')
    act(() => {
      setWidgetsPanelMode('hidden')
    })
    expect(result.current).toBe('hidden')
  })

  it('keeps left and right visibility modes independent', () => {
    // Toggling one side never toggles or resets the other.
    collapseSidebar()
    expect(getSidebarMode()).toBe('collapsed')
    expect(getWidgetsPanelMode()).toBe('auto')
    hideWidgetsPanel()
    expect(getWidgetsPanelMode()).toBe('hidden')
    expect(getSidebarMode()).toBe('collapsed')
    expandSidebar()
    expect(getSidebarMode()).toBe('expanded')
    expect(getWidgetsPanelMode()).toBe('hidden')
    showWidgetsPanel()
    expect(getWidgetsPanelMode()).toBe('auto')
    expect(getSidebarMode()).toBe('expanded')
  })
})
