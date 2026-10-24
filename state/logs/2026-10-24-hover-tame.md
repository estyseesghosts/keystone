# 2026-10-24 — Tame hovercards (tight anchors, fade, no ghosts) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner report — cards fire from far away (a hashtag click gets
covered), cards stick open, no fading; same for profile + matrix
cards.

## Root causes found

- One `HoverAuthor` wrapped the whole post header (name + time + tag
  bubble + handle): hovering the hashtag bubble armed the profile
  card after 400ms. The anchor is now split: name-only and
  handle-only zones (time/tag bubble arm nothing).
- Chained close→unmount timers could strand under single-chunk time
  advancement (found via a consistently failing test, not flakes):
  all hover timers are now scheduled from pointer events only.
- Layout shifts (streaming inserts, image loads) slide anchors under
  a stationary pointer and browsers fire genuine `mouseEnter` for
  it — reopening just-closed cards "by themselves". Enters now
  require recent pointer movement (shared 1s window tracker).

## Did

- `PostCard.tsx`: name press and handle press each get their own
  tight `HoverAuthor` (`headerNameHover` shrinks like the name,
  `headerHandleHover` self-starts like the handle — never
  full-width); time + TagBubble outside every zone. `HoverAuthor`
  takes an anchor `style`.
- `HoverPreview.tsx`: `HoverPreview` takes anchor `style`;
  `useHoverFade` replaced by event-driven show/faded states (open
  400ms, fade-in lead 20ms, single close timer grace+fade 550ms);
  card opacity transitions in `HoverLayer`; anchor-drift dismissal
  (500ms poll, 8px, settle-guarded) kills stuck cards; shared
  pointer-movement tracker (`ensurePointerTracking`,
  `pointerRecentlyMoved`); `HoverLayer` exported for matrix use.
- `RichText.tsx` `MatrixHover`: same timing/ghost/drift treatment.
- Tests: anchor-scope tests (tag bubble outside every zone),
  retimed close tests, `anchorMoved` + ghost tests (stale enter
  ignored, genuine opens), `useHoverFade` removed with its test.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → full suite green with this + the 429-defense work.
- Device hover feel: `not verified` (owner compares live).

## Next

- Owner hover-feel check; push `main`.
