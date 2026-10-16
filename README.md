# Keystone — minimalist Misskey-family web client (SolidJS)

One SolidJS SPA that talks to local **Misskey**, **Sharkey**, or **Pinetree**
backends through a Vite dev-proxy (or direct to a public instance as an
external MiAuth client). Black/white/grey, no accent colors; explicit
colour mode (light / dark / follow system) plus global text size
(50–400%, layout adapts). Stack: SolidJS 1.x + `@solidjs/router` +
`mfm-js`, Vite build tooling only — no React, no SSR, no component
library (see `AGENTS.md`).

## What you get

- Home / Local / Global timelines with refresh, cursor paging,
  infinite scroll, end-of-feed; live updates on Misskey/Sharkey
  (native-WebSocket Stage A client — timeline prepend, reaction/poll
  reconcile, delete in place, "N new" notification count + status
  badge; disabled on Pinetree, feeds work via refresh + paging)
- Note view (ancestor thread, paged reply branches, click-to-open),
  profiles (banner header, counters → followers/following pages, MFM
  bio, Posts / All / Media tabs), notifications
- Compose: text (limit from `meta.maxNoteTextLength`, 3000 fallback),
  CW, visibility (`public`/`home`/`followers`/`specified` + recipient
  picker), `localOnly`, attachments via Drive `fileIds`, polls
  (Misskey-family only), floating composer with per-backend drafts
- React / unreact (Misskey-style chips + likes), repost / quote + undo,
  repost collapsing, poll votes, follow / unfollow / cancel-request,
  delete own note, bounded profile editor (on your own profile page)
- Drive browser (upload, grouped Images/Videos/Audio/Files, sensitive
  toggle, delete, attach-select), antennas (CRUD + live feed),
  user/tag search, hashtag links, mention chips, quote embeds,
  auto-translation where the server offers it
- Auth is Keystone-owned: internal one-step username/password →
  scoped least-privilege app token (no redirects, no second screen),
  or external MiAuth (never sees your password; direct-to-instance
  traffic). Tokens stored per backend/host, never sent cross-origin.
  Multi-account switching from the account menu
- Client settings pages (`/settings` → account / display): session
  info + sign out, colour mode, text size. Sidebar is labeled nav on
  wide screens, icon rail under 1000px, bottom bar on mobile

What is *not* here yet: full profile editor (`avatarId`/`bannerId`,
decorations, fields[]), Drive folder navigation, user-list management
(blocks `list`-source antennas), streaming Stage B vs Pinetree, a pinned-notes
source for a Featured profile tab. See `docs/frontend-plan.md` for the
built vs deferred checklist.

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
