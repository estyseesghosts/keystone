# Frontend plan (MVP)

**Status:** Draft (2026-10-15, init — tracks `keystone.md` §§2,3,5,8,12)

Slice order is deliberate: each slice is independently usable and verifiable.
Do not start the next slice until the current one meets `keystone.md` §12
for its scope. Check boxes only with executed evidence.

## Slice 0 — Scaffold

- [ ] `npm init solid@latest frontend` (SolidStart: No, `ts`, TypeScript: Yes)
- [ ] `npm install`; `npm add @solidjs/router mfm-js`
- [ ] Vite proxy for `/api` + `/files` → `http://127.0.0.1:3000`, Solid plugin intact
- [ ] `npm run build` succeeds; `npm run dev` serves on `http://localhost:5173`

## Slice 1 — Auth + shell

- [ ] Typed `apiCall` helper (`src/api/client.ts`): `POST /api/${endpoint}`,
      `i` body-field auth, empty/204 handling, safe JSON parse, `error.message`
- [ ] Token signal + current-user signal; startup `i` restore; auth-failure
      clears token; explicit sign-out (`localStorage` dev store, no passwords)
- [ ] `App` root + `Layout` (left nav desktop / bottom nav mobile), routes:
      `/login`, `/`, `/local`, `/notifications`, `/notes/:id`, `/users/:id`
- [ ] Loading / empty / error / logged-out states; visible keyboard focus

## Slice 2 — Timelines + note view

- [ ] Home (`notes/timeline`, auth) and local (`notes/local-timeline`, public):
      limit ~20, `sinceId`/`untilId` "load older", manual refresh, no overlap,
      failures don't wipe loaded data
- [ ] Note detail (`notes/show`): reply/renote context as returned only —
      never claim a complete thread; missing/invisible → API error path
- [ ] `NoteCard` (avatar, name, handle, timestamp, text, CW, media, counts),
      `MfmRenderer` (allow-listed `mfm-js` subset, safe fallback, no `innerHTML`)

## Slice 3 — Interactions

- [ ] Compose text note (`notes/create`, reply via `replyId`, renote via
      `renoteId`); 3,000-char limit; `public` default; documented visibilities only
- [ ] React/unreact (`notes/reactions/create|delete`, honor `myReaction`);
      follow/unfollow (`following/create|delete`); delete own note (204 path)
- [ ] Notifications (`i/notifications`) only after confirming response fields
      against the manifest/implementation; basic profile edit (`i/update`
      subset) deferred unless trivial

## Deliberately deferred (backend has no support — do not build)

Profile timelines, follower/following lists, note search, global timeline,
lists/antennas/clips/channels/polls/quotes/custom-emoji endpoints, Mastodon
REST, streaming/live updates, media upload polish (`drive/files/create`
`FormData` path may defer past Slice 3), dark mode.

## Verification per slice

`keystone.md` §12 adapted to slice scope: build green, desktop + mobile,
real backend flows, 204 handling, no console errors, no unsupported calls,
no inert controls, no React dependencies.
