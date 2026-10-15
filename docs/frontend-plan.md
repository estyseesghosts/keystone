# Frontend plan (MVP)

**Status:** Built + verified 2026-10-15 against Misskey and Sharkey
(see `../state/logs/2026-10-15-stonekey.md`). Tracks `AGENTS.md` §5 and
`docs/api-surface.md`. Check boxes only with executed evidence.

## Slice 0 — Scaffold

- [x] SolidJS SPA (`frontend/`: Solid 1.x + `@solidjs/router`, `mfm-js`)
- [x] Vite proxy for `/api` + `/files` (+ `/proxy`, `/streaming`) with
      selectable backend target (`--mode misskey` / `--mode sharkey`;
      `frontend/.env.misskey`, `frontend/.env.sharkey`)
- [x] `npm run build` succeeds; dev serves per-mode ports

## Slice 1 — Auth + shell (done, all three backends)

- [x] Typed `apiCall` helper (`src/api/client.ts`): `POST /api/${endpoint}`,
      `i` body-field auth, empty/204 handling, safe JSON parse, `error.message`;
      per-backend token keys (session isolation)
- [x] Keystone-owned login: Pinetree `signin`; Misskey-family `signin-flow`
      → Keystone permission screen → `miauth/gen-token` + check → scoped app
      token (no redirects; temp credential never persisted)
- [x] Token + current-user signals; startup `i` restore; auth-failure clears
      token; explicit sign-out; mobile account strip separated from bottom nav
- [x] `App` root + `Layout`, routes: `/login`, `/`, `/local`, `/global`,
      `/notifications`, `/notes/:id`, `/users/:id`
- [x] Loading / empty / error / logged-out states; visible keyboard focus

## Slice 2 — Timelines + note view (done)

- [x] Home (`notes/timeline`, auth), local (`notes/local-timeline`, public),
      global (`notes/global-timeline`, public — supported on both servers):
      limit 20, `untilId` "load older" with dedupe, exhausted end-state,
      retry-older (not refresh), failures keep loaded data
- [x] Note detail (`notes/show`): parent reply + renoted context as returned,
      direct replies via `notes/replies` (labeled partial, with paging);
      missing/invisible → API error path
- [x] `NoteCard` (avatar, name, handle, timestamp, text, CW, media by MIME
      type with failure fallback, counts), profile links from avatar/name and
      notification authors, mention resolution via cached `users/show`,
      `MfmRenderer` (allow-listed `mfm-js` subset, safe fallback, no
      `innerHTML`); quote embeds use a separate "Open quoted note" link

## Slice 3 — Interactions (done)

- [x] Compose text note (`notes/create`, reply via `replyId`, renote via
      `renoteId`, quote = text + `renoteId`); 3,000-char limit; `public` default
      (`public`/`home`/`followers`)
- [x] React/unreact (honor `myReaction`; counts re-verified from server);
      repost single-fire with persistent state; follow/unfollow (response is
      `UserLite`); delete own note (204 path)
- [x] Profile timeline (`users/notes`); notifications with readable labels +
      timestamps + paging (`i/notifications` has no `isRead` — no read styling)

## Deliberately deferred (do not build until scoped)

Streaming/live updates, media upload UI (`drive/files/create` is multipart —
backend verified working; UI deferred), full profile editor (`i/update`
subset compatible), note search, follower/following lists, dark mode.

## Verification per slice

Build green, desktop + mobile, real Misskey + Sharkey flows, 204 handling, no
console errors, no unsupported calls, no inert controls, no React
dependencies. Latest evidence: `../state/logs/2026-10-15-stonekey.md`.
