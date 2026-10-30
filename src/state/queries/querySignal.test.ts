// Repair X3.1 acceptance — zero queryFns ignore `signal`.
//
// Every read `queryFn` in `src/state/queries/*` must thread react-query's
// `signal` (full threading to the backend where the method takes it, a
// `throwIfAborted(signal)` pre-abort where it cannot). Mutations are NEVER
// cancelled by unmount, so `mutationFn` bodies must not take a signal.
//
// This is a grep-style test: it reads the query sources and asserts on
// each `queryFn`/`mutationFn` chunk, so a new query that forgets its
// signal fails loudly instead of silently piling up requests.
import * as fs from 'fs'
import * as path from 'path'

const DIR = __dirname

// Every read-query module. `retry.ts` (helpers), `keys.ts`/`stale.ts`
// (no queries), `index.ts` (barrel) and `Provider.tsx` (no queryFns,
// owned by X1.4/X3.2) are intentionally not listed.
const QUERY_FILES = [
  'accounts.ts',
  'adminInsight.ts',
  'adminReports.ts',
  'chat.ts',
  'composer.ts',
  'conversations.ts',
  'graph.ts',
  'me.ts',
  'moderation.ts',
  'notifications.ts',
  'pages.ts',
  'recommendations.ts',
  'reports.ts',
  'usePostFeedQuery.ts',
  'usePostThread.ts',
]

type Marker = 'queryFn' | 'mutationFn'

function chunks(src: string): Array<{kind: Marker; body: string}> {
  const marks: Array<{kind: Marker; i: number}> = []
  for (const kind of ['queryFn', 'mutationFn'] as const) {
    let at = 0
    for (;;) {
      const i = src.indexOf(kind, at)
      if (i < 0) break
      marks.push({kind, i})
      at = i + kind.length
    }
  }
  marks.sort((a, b) => a.i - b.i)
  // A chunk ends at the next marker or the next top-level `// --- ` section
  // header, whichever comes first (repair X7.4: the composer upload section
  // carries an explicit per-item cancel `signal` — user-initiated, never the
  // unmount signal — and must not be attributed to the create-post
  // `mutationFn` body above it).
  const headerAt = (from: number): number => {
    const i = src.indexOf('\n// --- ', from)
    return i < 0 ? src.length : i + 1
  }
  return marks.map((m, n) => ({
    kind: m.kind,
    body: src.slice(m.i, Math.min(n + 1 < marks.length ? marks[n + 1].i : src.length, headerAt(m.i + m.kind.length))),
  }))
}

describe('X3.1 — every read queryFn threads signal; no mutationFn takes one', () => {
  it('covers every expected query module', () => {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    const withQueryFn = files.filter(f => {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8')
      return src.includes('queryFn')
    })
    expect(new Set(withQueryFn)).toEqual(new Set(QUERY_FILES))
  })

  it.each(QUERY_FILES)('%s: every queryFn chunk mentions signal', file => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8')
    const found = chunks(src).filter(c => c.kind === 'queryFn')
    expect(found.length).toBeGreaterThan(0)
    for (const c of found) {
      expect(c.body).toMatch(/signal/)
    }
  })

  it.each(QUERY_FILES)('%s: no mutationFn chunk threads a signal', file => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8')
    const found = chunks(src).filter(c => c.kind === 'mutationFn')
    for (const c of found) {
      expect(c.body).not.toMatch(/signal/)
    }
  })
})
