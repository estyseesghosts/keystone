// Relative timestamps for post headers (Keystone v1 `time.ts` behavior).
//
// Thin re-export of the shared app-locale formatter
// (`#/locale/format`, repair X9.5): past ages read narrow
// `Intl.RelativeTimeFormat` ("5m ago"), the first minute the locale's
// "now", older the locale date. Invalid input echoes back (never a crash,
// never blank). `locale`/`nowMs` are injectable for tests; the UI passes
// the app locale (or leaves it undefined for the activated app locale)
// with the shared minute ticker as `nowMs`.

export {formatRelativeTime} from '#/locale/format'
