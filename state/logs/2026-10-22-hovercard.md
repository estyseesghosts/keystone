# 2026-10-22 — Hovercard v1 parity + mention/hover rollout — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner — copy the v1 hovercard (`docs/k1k2-20261022/v1-hovercard.png`);
hover on avatar/displayname/handle + mention chips; mentions/hashtags must
resolve in bios + profile fields.

## Did

- New `src/components/Profile/HoverPreview.tsx`: generic web-only hover
  wrapper (400ms open delay, no layout shift). Placement is
  viewport-aware: below by default, flips above when there is no room
  underneath (roomier side wins, below wins ties), right-aligns near
  the right edge (`placementFor` pure + unit-tested).
- `PostCard` `HoverAuthor` now delegates to `HoverPreview` (same
  testIDs/behavior): avatar, display name AND handle all trigger.
- Mention chips hover via `HoverPreview` once the account resolves
  (tap still navigates; native unchanged).
- `UserHoverCardView` restyled to v1: banner image top (88px, fallback
  block), 56px avatar overlapping (-28), bordered Follow/Unfollow/
  Requested button top-right, underlined `Open profile` link, name/
  handle/bio/counts. Bio renders through RichText (mention chips +
  taps) with plain-text fallback.
- `ProfileHeader` takes optional `backend` (wired in `User.tsx`):
  bio + profile fields render resolving mention chips + working
  hashtag taps; backend-less trees (tests) keep static chips.

## Not built (explicit)

- Notification-row hover mounts (mount point noted in code, not wired).
- Hovercard bio has no backend (static chips, working taps) — v1 shows
  plain bio text anyway; full resolution there is a follow-up.

## Tests / verification

- `pnpm run typecheck` (ios+android+web) + `lint` clean; full suite
  **192 / 2433 green** (15 new: placement matrix, banner, bio chips,
  backend-resolved profile bio).
- Device/web runs → `not verified` (owner visual pass: placement flip
  near viewport bottom, banner/overlap rendering).
