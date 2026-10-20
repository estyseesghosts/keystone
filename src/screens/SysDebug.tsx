import {ThemeProvider} from '#/alf/index'
import {SysDebug} from '#/sys/SysDebug'

// Route screen for `/sys/debug`. Wraps the showcase so the route works
// even before the root provider tree changes.
export function SysDebugScreen() {
  return (
    <ThemeProvider>
      <SysDebug />
    </ThemeProvider>
  )
}
