# 2026-10-24 — Composer autogrow: the real frozen-box fix — agent

Branch: `main` (direct; owner follow-up, no plan slice).
Goal: finish the composer grow/shrink work the previous session left
with uncommitted debug instrumentation after a crash (`hi` x2 in the
transcript tails). Owner requirement: the post box scales larger AND
smaller with the amount of text entered.

## Where the previous session left off

Two transcripts
(`/var/folders/.../T/session-afdc209f-...md` — 51k lines,
`session-c7a72e56-...json` — 727 msgs) show the diagnosis converged but
the fix never landed:

- `remeasure` math proven correct on desktop web: real TEXTAREA,
  `scrollHeight` tracking content 72→483, events firing.
- `computedHeight` probe added: rendered height flops `72px ↔ Npx`
  between renders while state stays correct.
- Instance tracking added: exactly one `mount`, zero `unmount`s —
  NOT a remount loop. Session crashed before concluding.

## Root cause (mine, evidence-backed)

`remeasure` cleared the node and waited on React:

```ts
node.style.height = 'auto'
const h = node.scrollHeight
node.style.height = ''   // ← waits for React to re-apply
clamp(h)                 // ← setHeight: bails out when identical
```

When the measured value equaled current state (every post-commit
effect run, every same-line keystroke), React bailed out of the
re-render — and the DOM stayed cleared at resting size (72px). State
correct, measurements correct, box visually frozen. This single
mechanism explains every log line: the `computedHeight: 72px` reads
are the previous effect's uncleared clear, and growth only *appeared*
to work because a changed value still re-rendered (then the trailing
no-op effect cleared it again).

## Did

- `src/components/Composer/useAutogrowInput.ts`: `remeasure` now
  writes the clamped height back synchronously
  (`node.style.height = \`${next}px\``) before `setHeight(next)`.
  The DOM is correct even when state bails out; the re-render becomes
  a harmless no-op. All debug instrumentation (console probes,
  instance ids, mount/unmount tracking) removed — none of it committed.
  Shared `clampValue` helper so event and remeasure converge on the
  identical value. No call-site changes (both composers untouched).
- `useAutogrowInput.test.ts`: updated `style.height` expectations from
  `''` to the measured `Npx`; added regression test `leaves the DOM at
  the measured height when state bails out (no frozen box)`.

## Decided

- No ADR. One-line-class fix (clear → restore) with a regression test.
- Bluesky source paths consulted: none this session (no reference
  needed; diagnosis came from the owner's pasted console logs).

## Tests / verification

- `pnpm test -- src/components/Composer/useAutogrowInput.test.ts` →
  6/6 green (5 existing + 1 new regression test).
- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2530 tests green**.
- Web visual: **owner live-verified ("looks fine now")** on desktop —
  the confirmation the previous session never got.

## Deviations

- Touched only the hook, its test, this log, and `state/STATE.md`.
  Untracked owner drops (`docs/*`, `ios/`) untouched.

## Next

- Push `main` (owner commit flow; this fix rides with the unpushed
  composer/recommendations work listed in STATE step 0/0b).
