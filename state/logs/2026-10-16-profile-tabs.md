# 2026-10-16 — Profile pages (`docs/profile-handoff.md`)

## Goal

Make Keystone profiles look and behave like the competitor's (banner
header, big overlapping avatar, clickable counters, linked bio) with tabs
1:1 matching Misskey's own profile tabs.

## What changed

- `frontend/src/components/FollowList.tsx` (new, extracted from
  `routes/Profile.tsx`): same cursor paging + id dedupe + exhaustion +
  infinite scroll + remembered-cursor retry, plus permission-aware
  failures — pre-scope token (`isPermissionError`) → repo-standard
  re-sign-in hint; any other 403/401 → honest "This list is not visible
  to you" (never an empty page). Reloads on `userId`/`mode` change with
  a generation guard (direct navigation between users' lists reuses the
  component).
- `frontend/src/components/ProfileNotesList.tsx` (new, mirrors the
  `ReplyList` per-branch pattern): per-tab loading / error / cursor /
  dedupe (via `mergeNotes`) / exhaustion; only the active tab mounts (a
  full reset on switch — explicitly allowed — so cursors never mix);
  generation-guarded reload on `userId`/`tab`. Params: Posts
  `withReplies:false + withRenotes:false`, All `withReplies:true`
  (server default covers renotes), Media `withReplies:true +
  withRenotes:true` paged RAW (cursor from raw last id, exhaust on
  raw-empty/all-duplicate) filtered `files.length > 0` at render —
  never sends `withFiles` (server 400s it with `withReplies`), no
  `include*Renotes` / date cursors. Pinetree 404 → honest per-tab
  "Notes are not available on this server".
- `frontend/src/routes/Profile.tsx`: banner strip (`var(--bg-soft)`
  grey when bannerless) + 120px avatar overlapping the banner edge
  (negative-margin trick, same as `.hovercard-overlap`); follow-state
  machine untouched, repositioned top-right with Edit-profile;
  stats row = plain notes count + `<A>` counters to the new sub-routes;
  bio = `<div class="bio"><MfmRenderer text={description} /></div>`
  (`pre-wrap` kept, mention chips + hashtag links free, no `innerHTML`,
  no new fetches beyond mention resolution); tab bar (`role=tablist`,
  `aria-selected`, monochrome underline, visible focus) defaulting to
  Posts; toggle buttons deleted. Exports `FollowersPage` /
  `FollowingPage` (shared `FollowList` in full + back link).
- `frontend/src/App.tsx`: `/users/:id/followers` + `/users/:id/following`.
- `frontend/src/styles/global.css`: profile banner/body/overlap/row/tab
  styles, monochrome only, 160px banner + 96px avatar under 720px.
- Featured tab SHIPPED ABSENT: no pinned-note field was confirmed in the
  endpoint source reviewed, none is packed on `UserDetailed`, and this
  machine has no live backend to probe `users/show` for one — per the
  handoff, never faked; Pinetree can add the source later as its own
  slice.
- Docs: `docs/frontend-plan.md` Slice 3 + `state/STATE.md` pointer.

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green
  (`dist/assets/index-D5z5US24.js`, 238.96 kB;
  `dist/assets/index-BcjQiZ14.css`, 29.19 kB).
- Static checks: no `Hide/Show followers`, no `showFollowers`/
  `showFollowing` left; no `from "react"`, no `innerHTML` (only the
  pre-existing comment naming it); no `include*Renotes` / date cursors;
  `withFiles` never sent.
- Solid checklist (`solidjs.md` §10) walked: props read reactively (no
  destructuring), derived values in memo/JXS, conditionals via `<Show>`,
  lists via `<For>`, setters-only updates, no dep arrays, no `ref`
  props, no new subscriptions.
- API suites NOT re-run (no backends on this machine — `curl` :3101 /
  :3102 / :3000 all connection-refused); browser behavior (banner +
  overlap in both themes, counter navigation, denied states, bio chips,
  per-tab paging to exhaustion, mobile layout) **not yet verified**
  (owner).

## Open questions

- Whether the owner wants tab state preserved across switches (current:
  full reset + refetch per switch, allowed by the handoff) or kept
  alive once visited.
- Featured source: probe `users/show` on a live backend for pinned-note
  fields when one is reachable; add the tab only with a real source.

## Next step

Owner live-tests (bannered + bannerless profiles both themes; counters
→ lists incl. a denied list; bio `@`/`#`/URL rendering; Posts shows no
replies/pure reposts, All shows both, Media shows photo replies and no
text-only notes, each tab pages out; mobile widths). Then commit this
slice.
