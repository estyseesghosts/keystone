# 2026-10-29 — polish/8 media caps — agent

Branch: `polish/8-media-caps` (cut from `polish/7-feed-fill`)
Goal: cap link embed cards + single images at ~520px on wide columns while
the feed itself stays full-width (owner follow-up with exact scope).

Did:

- `src/alf/tokens.ts` — new `mediaPx.singleMaxW = 520` (sits between the
  480 media height cap and the 600 mobile column; shared by both caps).
- `src/components/Post/PostMediaGrid.tsx` — new exported pure
  `singleFrameWidth(kind, aspect, bleed)`: single stills (`kind image`,
  non-bleed) hug `min(480 × aspect, 520)`; video/gifv/quote-bleed singles
  keep the height-cap width. `TileFrame` uses it; inner frame gains
  `testID media-frame-<id>` for assertions. `maxWidth: 100%` + aspect +
  contain/cover fitting untouched, so narrow viewports shrink as before.
- `src/components/Post/LinkCard.tsx` — `styles.cardCap` (`width: 100%`,
  `maxWidth: 520`) on the `LinkCard` outer Pressable and the
  `UnfurledLinkCard` outer View. Cards mount only in PostCard, never in
  quotes — quote rendering provably unchanged.
- `src/components/Post/media-caps.test.tsx` (new, 9 tests): pure-unit pins
  (wide still capped, portrait untouched, video/gifv/bleed exempt) +
  rendered pins (capped frame keeps aspect + contain fit + fluid props,
  portrait frame unchanged, strips uncapped, both card types capped +
  fluid + chrome intact).

Decided:

- Bleed (quote-embedded) singles exempt: quotes render `PostMediaGrid`
  with `bleed`, and the owner scoped quote rendering out. Sensitive
  covers for single images cap with their tile (same `TileFrame` path),
  so reveal never shifts post height.
- New test file rather than extending `LinkCard.test.tsx` (3 pre-existing
  E9 failures there, unrelated) or `PostMediaGrid.test.tsx` (left
  untouched, 23/23 still green).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean (one self-caught
  value/type import slip in the new test, fixed before the gate).
- `pnpm lint` → clean.
- New suite → 9/9 pass. Neighbors: PostMediaGrid + LinkCard-policy +
  contrast 43/43; LinkCard.test still exactly its 3 pre-existing E9
  failures (unchanged).
- `pnpm test` → 303 suites (290 pass, 13 fail) / 4252 tests (4162 pass,
  90 fail) — failing set is exactly the 13 pre-existing content/
  linkpreview/richtext/post suites. Delta is precisely +1 suite / +9
  tests, all green. Zero new failures.
- Web/device runs → `not verified` (owner eyeballs the wide layout).

Deviations (files touched outside the slice + why):

- None beyond the two components, tokens, and the new test file.

Next:

- Owner confirms 520 proportions on the wide window (tune `singleMaxW`
  if wanted); `mainColMaxWide` (720, orphaned by slice 7) still awaits
  its one-line cleanup.
- Merge decision for the `polish/*` chain stays with the owner.
