import {act, renderHook} from '@testing-library/react-native'

import {
  collapseSidebar,
  effectiveSidebarLayout,
  expandSidebar,
  getSidebarMode,
  resetSidebarMode,
  setSidebarMode,
  useSidebarMode,
} from '#/state/sideNav'

beforeEach(() => {
  resetSidebarMode()
})

describe('effectiveSidebarLayout', () => {
  it('leaves mobile alone whatever the override', () => {
    expect(effectiveSidebarLayout('mobile', 'auto')).toBe('mobile')
    expect(effectiveSidebarLayout('mobile', 'expanded')).toBe('mobile')
    expect(effectiveSidebarLayout('mobile', 'collapsed')).toBe('mobile')
  })

  it('follows the width in auto', () => {
    expect(effectiveSidebarLayout('rail', 'auto')).toBe('rail')
    expect(effectiveSidebarLayout('full', 'auto')).toBe('full')
  })

  it('pins full/rail on desktop when overridden', () => {
    expect(effectiveSidebarLayout('rail', 'expanded')).toBe('full')
    expect(effectiveSidebarLayout('full', 'collapsed')).toBe('rail')
    expect(effectiveSidebarLayout('rail', 'collapsed')).toBe('rail')
    expect(effectiveSidebarLayout('full', 'expanded')).toBe('full')
  })
})

describe('sidebar mode store', () => {
  it('round-trips through the hook', () => {
    const {result} = renderHook(() => useSidebarMode())
    expect(result.current).toBe('auto')
    act(() => {
      collapseSidebar()
    })
    expect(result.current).toBe('collapsed')
    expect(getSidebarMode()).toBe('collapsed')
    act(() => {
      expandSidebar()
    })
    expect(result.current).toBe('expanded')
    act(() => {
      setSidebarMode('auto')
    })
    expect(result.current).toBe('auto')
  })
})
