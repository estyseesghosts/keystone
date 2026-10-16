# 2026-10-16 — Click-to-open posts

## Goal

Match the reference client (`docs/openpost.png`): clicking a post —
body text included — opens its detail view. Previously only the
timestamp, reply-count icon, and folded "Open post" link navigated, so
the post body felt dead.

## What changed

- `frontend/src/components/NoteCard.tsx`: the card navigates to
  `/notes/:shown.id` on body click (skipped on the detail route itself
  via the existing `detail` prop). Guarded, X-style: clicks starting in
  links, buttons, inputs, media controls, menus, or dialogs keep their
  own behavior; text selections and modified clicks are never hijacked.
  No new tab stop — keyboard users keep the time / reply-count /
  Open-post links.
- `frontend/src/styles/global.css`: `.note-openable` pointer cursor on
  cards outside the detail route.
- Docs: `docs/frontend-plan.md` (Slice 2 + Branched-replies section).

## Evidence (real output)

- `tsc --noEmit -p frontend`: clean.
- `npm run build`: green (`index-bQ4x3pW9.js`, 224.36 kB).
- Card click re-verified by code path after the connector addition
  (same guarded handler, `detail` opt-out unchanged); connector is
  CSS-only on stable selectors (`.feed > .reply-branch`,
  `.thread-ancestors > .note`) reusing `var(--border)` in both themes.
- No new signals/effects/subscriptions (one guarded click handler);
  `solidjs.md` §10 re-checked: no prop snapshots, no nested anchors,
  handler reads current signal values.
- Browser click + connector visuals **not yet verified** (no browser
  here — owner).

## Open questions

None.

## Next step

Owner verifies on dvd.chat: click post body → detail; click reply body
→ its detail; links/buttons/media/selection unaffected. Then commit
with the uncommitted replies slice.
