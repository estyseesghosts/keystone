# 2026-10-24 — Autogrow freeze: restore event-driven growth — agent

Branch: `main` (direct; owner-reported regression, no plan slice).
Goal: the composer stopped expanding AND contracting after the
single-source refactor.

## Root cause (mine)

The refactor skipped the contentSize event on web, leaving the
imperative remeasure as the only writer. The event path was the one
half proven to work in the reporter's environment (smooth expansion);
removing it froze growth wherever the remeasure read couldn't
compensate. Lesson logged: never remove the proven path before the
replacement is visually confirmed — especially without a browser.

## Did

- `useAutogrowInput`: the event is authoritative for growth again on
  every platform (it fires exactly when content outgrows the box);
  unconditional web `remeasure` keeps shrink/init/programmatic
  coverage. Each direction has exactly one writer, so they cannot
  fight; equal values bail out of state.
- No call-site changes (hook signature and both composers untouched
  since the last commit).

## Decided

- No ADR. If shrink still glitches after this, the remaining suspect
  is the `scrollHeight` read itself in the reporter's browser — next
  step is a debug build logging measurements, not more blind edits.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2529 tests green** (hook suite
  unchanged: 5 tests).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched only the hook's event guard + comment. Untracked owner
  drops untouched.

## Next

- Owner: confirm expand AND contract on desktop web; push `main`.
