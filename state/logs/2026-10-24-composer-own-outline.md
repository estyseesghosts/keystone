# 2026-10-24 — Composer: our own outline removed, remeasure glitch guards — agent

Branch: `main` (direct; owner follow-up, no plan slice).
Goal: remove the outline the app itself draws around the composer
textfield (browser ring already gone), in BOTH the overlay and the
inline composer; fix the expand/contract glitching.

## Did

- **Our outline** (`Composer.tsx`): the modal input had
  `borderWidth: 1, borderColor: edge` — a literal box of our own around
  the prose. Removed (radius/padding kept); the modal input is now
  chrome-free like the inline one, which was already borderless
  (verified: no border/outline/shadow anywhere near its input).
- **Glitch guards** (`useAutogrowInput.ts`): `remeasure(text)` now skips
  the synchronous reflow when it cannot change anything — no explicit
  height set (unconstrained box, the event sees truth), or text strictly
  grew since the last measure (growth is the contentSize event's job).
  Forced reflows now happen only on deletions/replacements while grown,
  exactly the stuck case. Both composers pass `text` through.
- **Tests** (`useAutogrowInput.test.ts`): growth-skip leaves node/DOM
  untouched, null-height skip, first-measure + ceiling, malformed node.

## Decided

- No ADR (bug fixes; chrome-free composer language predates this).
- Length-guard hole acknowledged: same-or-longer text with fewer lines
  (e.g. multi-line select replaced by one long line) skips until the
  next deletion, then self-heals. Rare + transient; accepted over a
  reflow on every keystroke.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **196 suites / 2484 tests green** (+1 net: +4 new,
  −3 superseded remeasure cases).
- Web visual: `not verified` — no desktop browser attached to this
  session. Owner to confirm: no ring on either composer, smooth
  grow/shrink while typing/deleting.

## Deviations

- Touched only the two composer inputs, the autogrow hook, and its
  test. Untracked owner drops untouched.

## Next

- Owner: visual confirm on desktop web; push `main`.
