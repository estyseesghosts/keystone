# 2026-10-16 — External accounts + account card (implementer)

Goal: let the owner test Keystone against a live, populated Misskey-family
server by authorizing Keystone as an *external* client (MiAuth redirect on
the host instance), plus the requested account-card UI (avatar + rounded-
rect profile card, menu with Profile / Settings / Switch account icons).
Internal login + internal API access must stay exactly as they were.

## What changed (all in `frontend/src`)

- `api/error.ts` (new): `ApiError` moved here, re-exported from
  `api/client.ts` so existing imports keep working. Lets `api/external.ts`
  throw the same class with no import cycle.
- `api/external.ts` (new): external-account path. `normalizeHost`
  (bare host + scheme, explicit-`http` honored for local targets, junk
  schemes rejected), `buildMiauthUrl` (comma-separated permission, optional
  callback), `checkExternalSession` / `fetchExternalMe` / `externalApiCall`
  / `externalUploadFile` (direct `https://<host>/api/...` fetch with the
  same 204/JSON semantics; CORS `origin: *` verified in Misskey
  `ApiServerService.ts`), per-host session storage
  (`keystone_external_sessions` + `keystone_active_external`, stale pointer
  resolves to null), `isExternalAccountActive`.
- `api/client.ts`: `apiCall` + `uploadDriveFile` route to the active
  external instance when one is set; otherwise the exact previous proxy
  path. New `apiCallInternal` (no routing) for session ops that must always
  hit the configured backend. `apiCallPublic` unchanged.
- `state/auth.tsx`: external sessions + active-host signals alongside the
  untouched internal token/user signals. `token()`/`me()` follow the active
  account; `signin` (both backends), internal restore, internal revoke all
  use `apiCallInternal`. `signout()` signs out of the ACTIVE account only
  (external sign-out removes that session, internal untouched).
- `api/stream.ts`: `subscribeChannel`/`captureNote` return disabled/no-op
  while an external account is active — an external token never reaches the
  local `/streaming` socket. Feeds/notifications fall back to paging +
  refresh; badges render nothing (already the `disabled` behavior).
- `components/AccountCard.tsx` (new): rounded-rect card (avatar, display
  name, handle) + menu (Profile, Settings, Switch account — new
  `ProfileIcon`/`SettingsIcon`/`SwitchIcon` in `icons.tsx`), per-host
  switcher with remove, "Add external account…" → `/login?mode=external`,
  sign-out. Outside-click + Escape dismiss via effect + `onCleanup`.
- `components/Layout.tsx`: sidebar footer + mobile strip render
  `AccountCard` (avatar-only on mobile); old handle spans + inline
  sign-out removed (now in the menu).
- `components/ProfileEditor.tsx` (new): bounded `i/update` subset
  extracted verbatim from `routes/Profile.tsx`, reused by Settings.
- `routes/Settings.tsx` (new) + `/settings` route in `App.tsx`: session
  info, external live-updates note, shared editor (remounted per account),
  sign-out.
- `routes/Login.tsx`: This-server (unchanged behavior) + External-server
  tabs; external = host → `window.open(<host>/miauth/<session>?…&callback=…)`
  + fallback link → "I've approved" polls check (15×2s) → verify `i` →
  store + activate; `?extcb=1&host&scheme&session` callback auto-finishes.
  Signed-in users with `?mode=external`/`extcb` see the form (can add a
  second account); otherwise the signed-in redirect is unchanged.
- `styles/global.css`: account card/menu/switcher/login-tabs/settings
  styles, black/white/grey only; collapsed sidebar shows avatar only.

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green (see command output
  referenced at commit time).
- 22/22 external-helper checks green via esbuild-bundled node run
  (`/tmp/opencode/ext-test.ts` — normalizeHost x8, session ids, MiAuth URL
  x5, storage x7 incl. upsert/stale-pointer/active).
- Internal suites (`scripts/smoke_*.py`) NOT re-run: the backend DB layer
  (pg 15432 / redis 16379) is down in this environment and Sharkey fails to
  boot (missing `@sentry/profiling-node` native binding); Misskey exits on
  `ECONNREFUSED 127.0.0.1:15432`. Internal-path safety is by construction
  (routing only when an external session is active; session ops pinned to
  `apiCallInternal`) + `tsc`/build — must be re-verified with the suites on
  the test machine before trusting it.
- Browser QA: not yet verified (no browser here) — the full external
  round-trip (new tab approval → callback/poll → feed/drive/reactions on a
  live instance) is the first job on the test machine.

## Decisions / notes

- MiAuth happens OUTSIDE Keystone on the host instance (redirect/new tab),
  per owner direction. Keystone never sees the external password.
- Provider side (someone on pinetree/keystone authorizing an external
  client) is NOT built here: Pinetree already serves `GET/POST
  /miauth/{session}` + check itself (`/root/pinetree/src/api/misskey/
  endpoints/mod.rs`) — that work stays in the pinetree repo, owner-owned.
  No pinetree changes were needed for this slice; none were made.
- Streaming for external accounts is deliberately off (token isolation).
  Wiring `wss://<host>/streaming?i=` is future work, not this slice.
- `localStorage` for external tokens carries the same dev-only caveat as
  internal tokens.

## Next step

Commit + push this slice, then hand off: test-machine runs internal suites
(flows/writes/features/streaming) to confirm no regression, then the live-
instance external round-trip.
