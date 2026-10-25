import {isDevBuild, linkingScreens} from '#/routes'

// D3.8 prod gate: `/sys/debug` must never be reachable from production
// linking, while dev builds keep the route. `__DEV__` flips per call
// (read inside `linkingScreens`), so the test toggles the global the
// same way Metro/Hermes would.
function setDevFlag(value: boolean | undefined) {
  const g = globalThis as {__DEV__?: unknown}
  if (value === undefined) delete g.__DEV__
  else g.__DEV__ = value
}

describe('SysDebug production gate', () => {
  const realFlag = (globalThis as {__DEV__?: unknown}).__DEV__
  afterEach(() => {
    setDevFlag(realFlag as boolean | undefined)
  })

  it('exposes /sys/debug in dev builds', () => {
    setDevFlag(true)
    expect(isDevBuild()).toBe(true)
    expect(JSON.stringify(linkingScreens())).toMatch(/SysDebug/)
    expect(JSON.stringify(linkingScreens())).toMatch(/sys\/debug/)
  })

  it('drops /sys/debug from production linking', () => {
    setDevFlag(false)
    expect(isDevBuild()).toBe(false)
    const table = JSON.stringify(linkingScreens())
    expect(table).not.toMatch(/SysDebug/)
    expect(table).not.toMatch(/sys\/debug/)
  })

  it('keeps every other route in production', () => {
    setDevFlag(false)
    const screens = linkingScreens()
    for (const name of ['Note', 'Tag', 'Settings', 'Login', 'Compose'] as const) {
      expect(screens[name]).toBeDefined()
    }
  })
})
