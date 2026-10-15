# 2026-10-15 — Vector icons, repost action, first push

**Goal:** replace emoji buttons with vector symbols, animate repost/heart
states, git init + push to `estyseesghosts/keystone` main.

## What changed (`frontend/`)

- New `components/icons.tsx`: inline SVG `HeartIcon` (fills when active),
  `ReplyIcon`, `RepostIcon` — `currentColor`, monochrome.
- `NoteCard`: emoji (💬🔁🤍❤️) replaced with icons; renote count promoted to a
  real **repost button** (was a static span) with `onRepost`/`reposting`/
  `reposted` props mirroring the reaction pattern.
- `TimelineFeed`: `repost()` via `notes/create {renoteId}` — prepends the
  renote, bumps the count, flashes `active` for 2 s; failures surface inline
  without wiping the list.
- `routes/Note.tsx`: detail card supports repost (reloads counts after).
- `global.css`: `.action svg` sizing, `action-pop` keyframe on
  `.action.active svg` (heart fill + repost flash both pop), `transition` on
  state change, `prefers-reduced-motion` disables both.

## Docs (owner-provided drafts adopted)

- Found owner-added `docs/mfm.md` + `docs/router.md` (Draft, versions TBD) +
  their session log. Filled both version pins from installed packages
  (`solid-js` 1.9.17, `@solidjs/router` 1.0.0, `mfm-js` 0.27.0) with the
  property table read from `built/index.d.ts`; recorded the implemented
  beyond-allow-list extras (all verified shapes, safe degradation);
  added the `/global` fallback row (owner decision); marked Validated.
- `docs/README.md` index updated.

## Evidence

- `npx tsc --noEmit` clean, `npm run build` green.
- `git init -b main`, committed `8e71c3a`, remote `origin` →
  `https://github.com/estyseesghosts/keystone.git`, `git push -u origin main`
  → `[new branch] main -> main`.

## Next

Browser check of icons/animations + remaining §12 pass (reload persistence,
paging, profile, notifications, mobile, console errors). Removed
`frontend/pnpm-lock.yaml` (template leftover; npm lockfile is canonical).
