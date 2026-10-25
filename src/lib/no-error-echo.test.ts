import fs from 'node:fs'
import path from 'node:path'

// Grep gate (X9.7 step 3): `showToast(` / `toastError(` never receives
// `err.message` / `String(e)` directly. Toasts render localized codes
// (or the generic fallback) through `toastError` / `formatFediError` —
// raw error text and server response bodies must never be echoed
// (security L2: a malicious URL or response body must not land in UI).
describe('no error-text echo into toasts (grep gate)', () => {
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'locales' || entry.name === '__tests__') continue
        out.push(...walk(full))
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  it('showToast(/toastError( never receives err.message / String(e) directly', () => {
    const root = path.join(__dirname, '..')
    const offenders: string[] = []
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const [i, line] of text.split('\n').entries()) {
        if (!/(showToast|toastError)\(/.test(line)) continue
        // Docs never trip the gate: strip trailing line comments first.
        const code = line.split('//')[0]
        if (!/(showToast|toastError)\(/.test(code)) continue
        if (/\.message/.test(code) || /String\(/.test(code)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
