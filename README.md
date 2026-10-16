# Keystone — minimalist Misskey-family web client (SolidJS)

One SolidJS SPA that talks to local **Misskey**, **Sharkey**, or **Pinetree**
backends through a Vite dev-proxy. Black/white/grey feed, light mode by
default with system-theme dark mode (`prefers-color-scheme`), no accent
colors. Stack: SolidJS 1.x + `@solidjs/router` + `mfm-js`, Vite build tooling
only — no React, no SSR, no component library (see `AGENTS.md`).

## What you get

- Home / Local / Global timelines with refresh, cursor paging, end-of-feed
- Note view (reply context, direct replies), profile + its notes, notifications
- Compose: plain text (limit from `meta.maxNoteTextLength`, 3000 fallback),
  CW, visibility (`public`/`home`/`followers`/`specified` + recipient picker),
  `localOnly`, attachments via Drive `fileIds`, polls (Misskey-family only)
- React / unreact, repost + undo, poll votes, follow / unfollow / cancel-request,
  followers/following lists, delete own note, bounded profile editor
- Drive browser (upload, filter, sensitive toggle, delete, attach-select),
  antennas (CRUD + live feed), user/tag search, hashtag links
- Live updates on Misskey/Sharkey (native-WebSocket Stage A client: timeline
  prepend, reaction/poll reconcile, delete in place, "N new" notification
  count + status badge). Pinetree has no `/streaming` route — client stays
  disabled there, feeds work via refresh + paging
- Auth is Keystone-owned, one step: username/password → scoped least-privilege
  app token. No redirects to instance pages, no second approval screen. Tokens
  are stored per backend and never sent cross-origin

What is *not* here yet: full profile editor (`avatarId`/`bannerId`,
decorations), Drive folder navigation, user-list management, streaming Stage B
vs Pinetree. See `docs/frontend-plan.md` for the built vs deferred checklist.

## Quickstart

Prereqs: Node, `npm`, and either one running backend — or no backend at
all (see "Against a public instance" below).

```bash
cd frontend
npm install

# Against a public instance (no local backend needed):
npm run dev                                   # → http://127.0.0.1:5173
```
Open `http://127.0.0.1:5173/login?mode=external` (the **External server**
tab), enter the instance host (e.g. `dvd.chat`), approve Keystone on the
instance's own page, then "I've approved — finish sign-in". Keystone never
sees your password; traffic goes direct to the instance (CORS `*`), never
through the dev-proxy. Live streaming stays off for external accounts by
design — feeds work via refresh + paging.

# Pinetree default (http://127.0.0.1:3000):
npm run dev                                   # → http://127.0.0.1:5173

# Misskey (http://127.0.0.1:3101):
npm run dev -- --mode misskey --port 5176 --strictPort

# Sharkey (http://127.0.0.1:3102):
npm run dev -- --mode sharkey --port 5177 --strictPort

npm run build   # production build (must stay green)
```

Restart Vite when switching targets — the proxy target (`frontend/.env.misskey`
/ `.env.sharkey`) is read at dev-server start, not hot-reloaded. The browser
always calls same-origin `/api/*`, `/files`, `/proxy`, `/streaming`; the proxy
forwards to `KEYSTONE_BACKEND_URL`.

Test accounts (dev only): `mk1` / `password123` (Misskey), `sk1` + `sk2` /
`password123` (Sharkey), `ks1` / `password123` (Pinetree). Token keys are
per backend (`keystone_token_misskey` / `_sharkey` / `_pinetree`). If a session
predates a permission, the server 403s and the UI tells you to sign out and
sign in again. Full backend setup (DB/Redis, backend-only flags, restart
commands): `docs/setup.md`.

## Backend differences (handled in UI)

| Behavior | Misskey / Sharkey | Pinetree |
|---|---|---|
| Drive upload + serve | yes (multipart) | yes |
| Drive listing (`drive/files`) | yes | 404 → honest upload-only |
| Antennas | yes | 404 → honest "not available" |
| Polls | create + vote | rejected → poll UI hidden |
| Note search | often policy-disabled (400 `UNAVAILABLE`) → stated as such | not implemented |
| Tag search | `notes/search-by-tag` works | — |
| Streaming | live client active | none → client disabled |

Authoritative contract: `docs/api-surface.md`. Transport for all three: JSON
`POST /api/{endpoint}`, auth via `i` body field, writes may return 204
(empty — never blind `response.json()`).

## Layout

```text
README.md            this file
AGENTS.md            agent rules (stack, backends, workflow) — read before changing code
keystone.md          original Pinetree brief (historical)
solidjs.md           SolidJS 1.x guide (authoritative for UI model)
docs/                setup, api-surface, frontend-plan, mfm, router (+ index) — see docs/README.md
scripts/             smoke_flows.py, smoke_writes.py, smoke_features.py, smoke_streaming.py
state/               STATE.md (resume pointer) + append-only session logs
frontend/            SolidJS SPA (src/api, src/components, src/routes, src/state, src/styles)
```

Backend checkouts live outside this repo (`/root/fedifedifedi/misskey`,
`/root/fedifedifedi/sharkey`): both carry the small `KEYSTONE_BACKEND_ONLY`
patch in `packages/backend/src/server/ServerService.ts` (+ matching built
output) so they serve API/files/streaming without their web UI.

## Workflow (agents)

1. Before starting: read `AGENTS.md`, then `state/STATE.md`, then the latest
   `state/logs/` entry.
2. While working: keep slices small; keep `state/STATE.md` current.
3. When finishing or interrupted: update `state/STATE.md`, append one dated
   log to `state/logs/`. Never rewrite past logs.

## Verification

```bash
cd frontend && npm run build          # must be green
cd /root/keystone
python3 scripts/smoke_flows.py       # core journeys, both servers
python3 scripts/smoke_writes.py      # write round-trips + 204 handling
python3 scripts/smoke_features.py    # drive / antennas / polls / search / profile
python3 scripts/smoke_streaming.py   # streaming Stage A (Misskey/Sharkey)
```

Suites are API-transport probes through Keystone's own proxy plus static
source checks. There is no browser in this environment, so visual / console /
media-playback QA is **not yet verified** — needs a human browser pass before
any "fully verified" claim. Latest evidence: `state/logs/`.

## License

Not yet declared — no `LICENSE` file.
