# 2026-10-26 — clicktargets — coordinator

Branch: `main`
Goal: Fix the two oversized click/hover targets from `docs/clicktargets/` (two subagents, file-disjoint, one batch).

Did:

- Avatar hover strip (`PostCard.tsx` `Avatar`): the `HoverAuthor` anchor `View` had no style, so the card row stretched it to full post height (DevTools: 40×561.66 strip) — hovering anywhere in the left column popped the hovercard. Added `avatarHover: {alignSelf: 'flex-start'}` so the anchor box is exactly the 40×40 avatar (already top-aligned — zero pixel change, only the hit area shrinks). Profile-navigation press was already on the inner avatar-hugging `Pressable`; name/handle anchors already hugged; `PostQuote` avatars have no hover wrapper. Native path untouched.
- Media dead zone (`PostMediaGrid.tsx` `TileFrame`): the outer "Open media" `Pressable` had no style, so the column wrap stretched it full row width (635px) while the fitted frame hugged at 360px. Added `alignSelf: 'flex-start'` (+ single-only `maxWidth: '100%'`; strip tiles keep aspect widths for horizontal scroll). Image, frame sizing, alt-text, sensitivity gating, lightbox path, `hitSlop={8}` all unchanged. Same frame serves singles, strips, gifv, video, and quote-card bleed.
- Tests in place: hover-anchor hug test (`post-hover-anchors.test.tsx`), single + strip pressable shrink-wrap tests (`PostMediaGrid.test.tsx`).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2963 tests passed (pre-batch: 217 / 2960; +3).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`. Owner can verify visually against the `docs/clicktargets/correct-*.png` DevTools states.

Deviations (files touched outside the slice + why):

- None. 2 prod files + 2 test files.

Next:

- Owner verifies on web (hover only the avatar; click only the image). Replies program complete; composer program complete.
