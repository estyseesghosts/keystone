# 2026-10-30 — like-button liked state (`:code@.:` raw text) — agent

Branch: `fix/like-button-liked-state` (from `main`, uncommitted)
Goal: the like button lit up for ANY reaction and printed custom keys
(`:meowBigSob@.:`) as raw text; the pill must mean liked-only.

What the screenshot showed:

- Action row rendered the highlighted like pill as `:meowBigSob@.: 1`
  and `:drgn_flat_heart@.: 1` — raw key text. The reaction CHIPS above
  resolved fine (cat image + counts); the broken glyph was the LIKE
  button's, fed by `LikeGlyph`'s `UnicodeEmoji` fallback (a custom key is
  not a unicode sequence, so it printed verbatim).
- Root cause, two parts: (a) `active={!!mine}` lit the button for any
  reaction, not for the configured like; (b) art lookup was
  entry-URL-or-UnicodeEmoji, bypassing the packed/session chain that
  makes the chips work (entry `url` is null while packed carries the art).

Did:

- `src/components/Post/ActionBar.tsx` — like button lit iff
  `isLikeActive(likeEmoji, mine)` (fedi, pre-existing: bare `:name:` ≡
  local `:name@.:`, either heart form when the like is a heart, remote
  hosts never equate). `LikeGlyph` rewritten: unlit → outline `HeartIcon`
  always; lit + heart like → filled heart; lit + custom like → art for
  the WIRE entry key through `CustomEmojiGlyph` (entry URL → packed →
  session), filled-heart fallback when unresolvable — the button can no
  longer print a raw key. Tap: lit → `set(null)`; unlit →
  `set(likeEmoji)` (replaces a different reaction on single-reaction
  servers via delete-then-create). Label follows the same rule.
- Addendum (verified, no change): the count is already the all-kinds
  total (`reactions.total` = server `reactionCount`, entries-sum
  fallback) — pinned by test, not just believed.

Tests / verification (paste commands + results):

- New `packages/fedi/test/api-emoji-like.test.ts` (3 tests: sameEmojiKey
  forms, isLikeActive incl. legacy-heart-unliked + remote-mismatch).
- `postactions.test.tsx` +4 in `like-key wiring (F18)`: other-reaction →
  unlit + label `Like, 8 reactions` (total-across-kinds pin) + tap sets ❤
  (delete-then-create: unreact fires for the old key, react once for ❤);
  custom-like reacted → selected + image, no `:code:` text (screenshot
  regression); bare setting ≡ `@.`-suffixed reaction; remote lookalike
  unlit.
- `NODE_ENV=test npx jest api-emoji-like postactions` → 47/47 pass.
- Neighbors (reaction-chips-emoji, contrast, ErrorBoundary,
  feed-viewability) → 29/29 pass.
- `pnpm typecheck` (ios+android+web) → clean; `pnpm lint` → clean.
  (One fix during the gate: `liked` doesn't narrow `mine` for the
  `msg` template — label now checks `liked && mine`.)
- Full `pnpm test` → not run (targeted + gates green; run before merge).
- Web/device runs → `not verified`.

Decided:

- Art resolves by the WIRE entry key (`mine`), not the setting — packed/
  entries are keyed by wire form; the setting only decides heart-vs-
  custom and the liked predicate. (Caught while writing tests: bare
  `:wow:` setting + `:wow@.:`-keyed packed misses lookup.)
- Display-only residual: an emoji unresolvable everywhere (no entry URL,
  no packed hit, no session listing) still renders literal `:code:` —
  same as chips, honest, not a regression.
- No ADR (reuses decided semantics: F18 like key, `isLikeActive`,
  X2.5 packed trust); DECISIONS line only.

Next:

- Owner visual check on web (Misskey/Sharkey custom-like account).
- Full `pnpm test` flat at pre-existing 90, then merge decision.
