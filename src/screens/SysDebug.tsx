import {ThemeProvider} from '#/alf/index'
import {isDevBuild} from '#/routes'
import {SysDebug} from '#/sys/SysDebug'

// Route screen for `/sys/debug`. Wraps the showcase so the route works
// even before the root provider tree changes. Dev-only (D3.8 gate):
// production linking drops the leaf (`linkingScreens`) and this screen
// renders nothing there as defense in depth.
export function SysDebugScreen() {
  if (!isDevBuild()) return null
  return (
    <ThemeProvider>
      <SysDebug />
    </ThemeProvider>
  )
}
