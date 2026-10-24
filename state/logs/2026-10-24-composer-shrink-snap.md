# 2026-10-24 — Autogrow single source of truth (shrink snap) — agent

Branch: `main` (direct; owner follow-up, no plan slice).
Goal: fix the composer contracting with a visible snap/fight on
delete. Both inline and overlay composers.

## Root cause

Two writers owned the web height with different blind spots: the
contentSize event (blind on shrink — `scrollHeight` pins to the
explicit height) and `remeasure` with a growth-skip guard (blind on
regrowth after a shrink). After shrink → retype cycles the box sat
stuck tall with neither path correcting it, and the next deletion
snapped it down — the visible fight. The guard was the bug, not the
fix: it optimized away the one reflow that keeps the box honest.

## Did

- `useAutogrowInput(min, max, text)`: one measuring path per
  platform, one converging value. Web ignores the event for height
  and measures unconditionally — pre-paint from `onChangeText`
  (zero-lag typing) plus post-commit on every text change (covers
  drafts, restores, suggestion picks, which bypass the handler).
  Native keeps the event path. All paths compute the identical
  clamped value, so repeats converge instead of fighting.
- Both composers pass `text` in and call bare `remeasure()` on change.
- Tests rewritten for unconditional measuring (mount, up, down,
  clamps, malformed node, native no-op).

## Decided

- No ADR. One sync reflow per text change is the honest price of a
  correct box; the skipped reflows are what caused the snap.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2529 tests green** (hook suite
  rewritten: 5 tests).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched only the hook, its two call sites, and its test.
  Untracked owner drops untouched.

## Next

- Owner: confirm smooth contract on delete on desktop web; push `main`.
