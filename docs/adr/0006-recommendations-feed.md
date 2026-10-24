# ADR 0006 — Fork recommendations feed (dvd-sharkey port)

Date: 2026-10-24
Status: accepted
Plan ref: `~/.opencode/plan/recommendations-client-port.md` (owner-supplied; not in `rn-rebuild-plan.md`)

## Problem

The owner needs Keystone to test against a live dvd-sharkey server that ships a
recommendations feed (`notes/recommendations*`, `i/recommendation-interests`,
`i/update {recommendationSettings}`). No upstream Misskey/Mastodon has these
endpoints, so support cannot be a static flavor fact — it must be detected per
server, on by default where present, and invisible everywhere else.

## Options considered

1. Static `detect.ts` capability (e.g. `recommendations: supported` on
   `sharkey`). Rejected: a flavor label cannot prove a backport present or a
   fork build absent; stock Misskey 404s the same paths.
2. Live endpoint probe with per-origin cache (chosen). Mirrors the existing
   `notes/like` pattern (`misskey/like.ts`): only a real 404/405 (or
   `UNKNOWN_API_ENDPOINT`) caches absence.
3. Settings as a new route (`/settings/recommendations`). Rejected by the
   owner: the settings surface is an overlay popup with save-or-discard on
   dismiss, never a page.

## Decision

- New `FeedDescriptor` string `recommendations` (offset-paged, not id-cursor;
  `encodeRecCursor`/`decodeRecCursor` in `core/recommendations.ts`).
- New optional `Backend.recommendations` (`RecommendationsApi`), implemented on
  the Misskey family only; `fetchRecommendationPage` pages by `offset` and
  moves `_recommendationFactors_` into `Post.ext.recommendation` (transient,
  never forwarded).
- Availability = module present AND `recommendationSettings.enabled !== false`
  (default true) AND probe verdict not false; the Home tab bar (`Home |
  Recommendations`, above the composer) shows optimistically and a real 404
  hides it.
- Dwell tracking is a FlatList-viewability hook (`viewAreaCoveragePercent
  Threshold 50`, 600ms minimum, 15s flush, best-effort).
- Per-note `Why / Not interested` rows prepend the note menu only when the
  outer wrapper carries a breakdown; `not-interested` uses the appeared id.
- Settings overlay loads `me` + `i/recommendation-interests` (latter overlays
  once until touched), saves via `i/update`, and asks save-or-discard on
  backdrop/X/Escape when dirty.

## Consequences

- Good: servers without the fork see no tab, no menu rows, no settings — one
  404 probe per session, cached per origin. Mastodon family untouched
  (`recommendations` stays undefined).
- Bad / accepted risk: `withRenotes` has no Keystone pref behind it yet, so
  the feed always sends `withRenotes: true`; the home-tab restore is
  device-local per session.
- Follow-ups: hook the timeline show-boosts pref into `withRenotes` if one
  ever ships; deck columns can address `recommendations` already.
