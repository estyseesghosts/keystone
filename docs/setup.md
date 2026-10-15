# Keystone setup: running the client against Misskey, Sharkey, or Pinetree

Keystone is one SolidJS/Vite SPA that talks to any of three backends through
a dev-proxy. The backend is chosen at Vite start time (`--mode`), and the
browser always calls same-origin `/api/*` — the proxy forwards to the real
server. Auth tokens are stored per backend (`keystone_token_misskey`,
`keystone_token_sharkey`, `keystone_token_pinetree`), so a token is never
sent to the wrong server.

## 1. Service map (this rig)

| Service | Listens on | Notes |
|---|---|---|
| Misskey API (backend-only) | `127.0.0.1:3101` | `KEYSTONE_BACKEND_ONLY=1`, Node v24 (see §4) |
| Sharkey API (backend-only) | `127.0.0.1:3102` | `KEYSTONE_BACKEND_ONLY=1` |
| Pinetree API | `127.0.0.1:3000` | default target, full UI |
| Keystone → Misskey | `127.0.0.1:5176` | `npm run dev -- --mode misskey` |
| Keystone → Sharkey | `127.0.0.1:5177` | `npm run dev -- --mode sharkey` |
| Keystone → Pinetree | `127.0.0.1:5173` | plain `npm run dev` |
| Postgres | `127.0.0.1:15432` | docker `pinetree-interop-postgres-1` (postgres:16-alpine) |
| Redis | `127.0.0.1:16379` | docker `pinetree-interop-redis-1` |

Backend configs: `/tmp/pinetree-interop/misskey.yml` (db `misskey`, redis
db 1, `url: http://127.0.1.1/`, `id: aidx`), `sharkey.yml` (db `sharkey`,
redis db 2, `url: http://127.0.1.2/`). Both use db user/password `interop`,
`fulltextSearch: {provider: sqlLike}`, `allowedPrivateNetworks:
['127.0.0.0/8']`. Restart the containers if they are down:

```bash
docker start pinetree-interop-postgres-1 pinetree-interop-redis-1
```

Provisioning a *fresh* Misskey/Sharkey/Pinetree database from zero is covered
by those repos' own docs (clone, install, migrate, initial setup). What
follows assumes their databases already exist, as in this rig.

## 2. Keystone frontend

```bash
cd /root/keystone/frontend
npm install

# Against Pinetree (default http://127.0.0.1:3000):
npm run dev                                   # → http://127.0.0.1:5173

# Against Misskey (http://127.0.0.1:3101):
npm run dev -- --mode misskey --port 5176 --strictPort

# Against Sharkey (http://127.0.0.1:3102):
npm run dev -- --mode sharkey --port 5177 --strictPort
```

The mode selects `frontend/.env.misskey` / `.env.sharkey` (`KEYSTONE_BACKEND_URL`
= proxy target, `VITE_KEYSTONE_BACKEND` = token key + login flow). Restart
Vite when switching targets — the proxy target is read by the dev server,
not hot-reloaded. Production build: `npm run build` (also `npx tsc
--noEmit` for the typecheck); serve `dist/` statically.

## 3. Backends in backend-only mode

Misskey and Sharkey run with their built-in web UI disabled
(`KEYSTONE_BACKEND_ONLY=1` guard around `clientServerService.createServer`
in each `packages/backend/src/server/ServerService.ts`, plus the matching
built output). API, files, and streaming stay live. Verify:

```bash
curl -s http://127.0.0.1:3101/ -o /dev/null -w "%{http_code}\n"   # 404 = UI off
curl -m 5 -s -X POST http://127.0.0.1:3101/api/meta \
  -H 'content-type: application/json' -d '{}' | head -c 120       # 200 + JSON
```

Restart commands (working directory matters; logs under `/tmp/pinetree-interop/`):

```bash
W=/tmp/pinetree-interop

# Misskey — MUST use Node v24 (system node v22 cannot load its re2.node):
cd /root/fedifedifedi/misskey/packages/backend && env \
  "PATH=/root/.nvm/versions/node/v24.22.0/bin:/usr/sbin:$PATH" \
  MISSKEY_CONFIG_YML="$W/misskey.yml" MISSKEY_WEBFINGER_USE_HTTP=true \
  NODE_ENV=development VITE_PORT=5181 EMBED_VITE_PORT=5182 \
  KEYSTONE_BACKEND_ONLY=1 \
  setsid node built/entry.js >$W/misskey.log 2>&1 &

# Sharkey (clustering off for single-process dev):
cd /root/fedifedifedi/sharkey/packages/backend && env \
  "PATH=/usr/sbin:$PATH" \
  MISSKEY_CONFIG_YML="$W/sharkey.yml" MISSKEY_WEBFINGER_USE_HTTP=true \
  NODE_ENV=development VITE_PORT=5174 EMBED_VITE_PORT=5175 \
  MK_DISABLE_CLUSTERING=1 KEYSTONE_BACKEND_ONLY=1 \
  setsid node built/boot/entry.js >$W/sharkey.log 2>&1 &
```

Rebuilding after editing backend sources: each repo's normal build, then
re-apply the `KEYSTONE_BACKEND_ONLY` guard to the *built* `ServerService`
file too (the servers run from `built/`, not `src/`).

Pinetree (`:3000`) runs its normal binary; Keystone's default mode proxies
there. No special flag.

## 4. Sign in

Test accounts: `mk1` / `password123` (Misskey), `sk1` + `sk2` /
`password123` (Sharkey), `ks1` / `password123` (Pinetree).

- **Pinetree mode:** username + password signs in directly.
- **Misskey/Sharkey modes:** one step. Keystone posts `signin-flow`,
  mints a scoped least-privilege app token (`miauth/gen-token` + check),
  verifies it, and stores only that token. The native account credential
  from `signin-flow` is full-authority (the permanent user token) and is
  kept in memory solely for the exchange — never stored. The login form
  lists the requested permissions; there is no second approval screen.
- If a session predates a permission (Drive, antennas, polls, …), the
  server answers 403 and the UI tells you to sign out and sign in again.
  Sign-out best-effort revokes the server token, then always clears local
  state.

## 5. Verify it works

```bash
cd /root/keystone/frontend && npm run build          # must be green
cd /root/keystone
python3 scripts/smoke_flows.py      # core journeys, both servers
python3 scripts/smoke_writes.py     # write round-trips + 204 handling
python3 scripts/smoke_features.py   # drive/antennas/polls/search/profile
```

Override targets with `KEYSTONE_MISSKEY_URL` / `KEYSTONE_SHARKEY_URL`
(defaults are the ports in §1). All three suites must report 0 failures.
They are API-transport probes through Keystone's own proxy (the exact HTTP
the browser performs) plus static source checks — there is no browser in
this environment, so visual/console/media-playback QA is still
**not yet verified** and must be done by a human with a browser before any
"fully verified" claim.

## 6. Backend differences the UI already handles

| Behavior | Misskey / Sharkey | Pinetree |
|---|---|---|
| Drive upload + serving | yes (multipart) | yes |
| Drive listing (`drive/files`) | yes | **404** → Drive shows honest upload-only |
| Antennas | yes | **404** → honest "not available yet" |
| Polls | create + vote | **rejected** → poll UI hidden in Pinetree mode |
| Note search | implemented but usually **policy-disabled** (400 `UNAVAILABLE`) → stated as such | not implemented |
| Tag search | `notes/search-by-tag` works | — |
| Notifications | no `isRead`; `mark-all-as-read` supported | `isRead` packed |
| Reactions | `❤️` normalizes to `❤`; `myReaction`/poll detail only packed **with** credential | per manifest |
| `i/update` editor | bounded subset (name/bio/location/birthday/locked/bot) | same subset per manifest |

Streaming: intentionally not used yet. Every feed has manual refresh +
cursor paging; antenna feeds work without live updates. See
`docs/api-surface.md` (authoritative contract table) and
`docs/frontend-plan.md` (what is built vs. deferred).
