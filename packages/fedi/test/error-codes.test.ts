// Repair X9.7: every `errors.*` code thrown in `packages/fedi` production
// source must be a member of `FEDI_ERROR_CODES` (the UI's message table is
// typed over that union, so membership here is what guarantees a thrown
// code always has a localized message). Server wire codes
// (`PERMISSION_DENIED`, …) are never `errors.*`-namespaced, so they cannot
// trip this gate. The union definition itself (`core/errors.ts`) is
// excluded from the scan — otherwise the gate would be circular.
import * as fs from 'node:fs'
import * as path from 'node:path'

import {FEDI_ERROR_CODES} from '../src/core/errors';

describe('error codes', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full));
      } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        if (path.basename(full) === 'errors.ts') continue;
        out.push(full);
      }
    }
    return out;
  }

  it('every errors.* literal in fedi source is a FEDI_ERROR_CODES member', () => {
    const root = path.join(__dirname, '..', 'src');
    const known = new Set<string>(FEDI_ERROR_CODES);
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/["'](errors\.[a-zA-Z0-9_.]+)["']/g)) {
        if (!known.has(m[1])) {
          offenders.push(`${path.relative(root, file)}: ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
