# 2026-10-16 — user hover profile popup

## Goal
Hover popup showing a user's profile info on note avatars/names:
aesthetic + content per `docs/profile.png`, banner usage per
`docs/profile2.png` (avatar overlapping the banner's bottom edge).

## What changed
- `frontend/src/components/UserHoverCard.tsx` (new): `UserHover` wrapper
  + `formatCompactCount` + session `users/show` cache + follow button.
  - Opens 350ms after hover/focus, only on `(hover: hover)` pointers;
    200ms close grace so the pointer can travel onto the card. Closes on
    mouse-leave, Escape, page scroll, outside click.
  - Card: banner header (88px, `bannerUrl`; omitted when null — no
    fabricated image), 56px avatar overlapping the banner edge,
    Follow/Unfollow right (hidden logged-out or on self; pending state
    from `hasPendingFollowRequestFromYou`, state refreshed from
    `users/show` after each write), display name, `@handle` (+ locked /
    automated flags), plain-text bio, compact stats
    (`30.7K`-style, full values on `title`), "Open profile" link.
  - Pre-fetch / failure state still shows the note-packed `UserLite`
    (avatar, name, handle, profile link) plus loading status or a
    wired Retry — never blank, never stuck.
- `frontend/src/components/NoteCard.tsx`: avatar and name links wrapped
  in `UserHover` (shown/original author, so repost banners keep working).
- `frontend/src/styles/global.css`: `.hoverwrap` / `.hovercard*` styles,
  grey palette only; `@media (hover: none)` hides the card so touch
  keeps tap-to-profile.
- `state/STATE.md`: current-task pointer updated.

## Evidence
- `npm run build` green (`dist/assets/index-*.js` contains `hovercard`).
- `npx tsc --noEmit` clean.
- Compact format sanity: `426 | 999 | 1.2K | 30.7K | 1M` (node Intl check).
- No React imports; only supported endpoints (`users/show`,
  `following/create|delete`) — `users/show` verified in
  `docs/api-surface.md`.
- Browser QA **not yet verified** (no browser in this environment;
  local backend `:3000` not running here) — owner pass needed:
  desktop hover open/dismiss, follow toggle in card, mobile widths
  (no popup, tap navigates), dark mode.

## Open questions / next
- Repost-banner names and notification authors have no hover card yet
  (NoteCard avatar/name only) — trivial follow-up with the same wrapper.
- Bio is plain text like `ProfileCard`; MFM rendering not attempted.
