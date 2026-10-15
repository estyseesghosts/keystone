# Keystone — Misskey-family web client (SolidJS)

Minimalist, light-mode-only web client targeting local **Misskey** and
**Sharkey** instances (run backend-only: built-in web UI disabled, API only).
Pinetree remains supported via the same transport. See `state/STATE.md` for
the resume pointer.

## Source briefs (read first)

- `AGENTS.md` — rules for agents (stack, backend targets, workflow, state logging).
- `keystone.md` — original Pinetree frontend brief (historical; `AGENTS.md` §5
  now names the Misskey/Sharkey targets and the verified API surface).
- `solidjs.md` — SolidJS 1.x mental model and React-to-Solid rules.
- `docs/stonekey_ui.md`, `docs/stonekey_backend.md` — review findings and the
  backend-separation plan (note: both contain endpoint errors corrected in
  `docs/api-surface.md` — Misskey sign-in is `POST /api/signin-flow`, not
  `/api/signin`; global/profile/reply endpoints exist on both servers).
- `docs/api-surface.md` — verified endpoint matrix (authoritative for UI work).

## Quickstart

Backends (already running in this environment):

| Instance | API | Keystone frontend | Account |
|---|---|---|---|
| Misskey (backend-only) | `http://127.0.0.1:3101` | `http://127.0.0.1:5176` (`--mode misskey`) | `mk1` / `password123` |
| Sharkey (backend-only) | `http://127.0.0.1:3102` | `http://127.0.0.1:5177` (`--mode sharkey`) | `sk1`, `sk2` / `password123` |

Same frontend, selectable backend (restart Vite when switching):

```bash
cd frontend
npm run dev -- --mode misskey   # → 127.0.0.1:3101 (frontend/.env.misskey)
npm run dev -- --mode sharkey   # → 127.0.0.1:3102 (frontend/.env.sharkey)
npm run dev                     # → Pinetree default 127.0.0.1:3000
npm run build                   # production build (verified green)
```

Login is Keystone-owned: username/password → Keystone permission screen →
scoped app token. No redirect to instance-hosted pages, ever.

## Layout

```text
README.md            this file
AGENTS.md            rules for agents (stack, workflow, state logging)
keystone.md          original Pinetree brief (historical — AGENTS.md §5 wins)
solidjs.md           SolidJS guide for implementers (source of truth for UI model)
docs/                living frontend docs (plan, API surface, reviews) + index
state/               resume pointer (STATE.md) + append-only session logs
frontend/            SolidJS SPA (src/api, src/components, src/routes, src/state)
```

Backend checkouts live outside this repo (`/root/fedifedifedi/misskey`,
`/root/fedifedifedi/sharkey`): both carry the small `KEYSTONE_BACKEND_ONLY`
patch in `packages/backend/src/server/ServerService.ts` (+ matching built
output) so they serve API/files/streaming/federation without their web UI.

## Workflow (summary)

1. Before starting: read `AGENTS.md`, then `state/STATE.md`, then the latest
   `state/logs/` entry.
2. While working: keep slices small; update `state/STATE.md`.
3. When finishing or interrupted: update `state/STATE.md`, append one dated
   log to `state/logs/`. Never rewrite past logs.

Full rules: `AGENTS.md`. Docs index: `docs/README.md`.

## Verification

`npm run build` green; sign in (incl. Keystone permission grant) / session
restore / sign-out; home + local + global timelines with refresh, cursor
paging, and end-of-feed; create / reply (+ reply list) / react / unreact /
repost (single-fire) / open note / profile (+ its notes) / follow / unfollow /
notifications; loading, empty, auth-expired, API-error, and 204 no-content
cases; desktop + mobile widths; no console errors, no unsupported calls, no
inert controls. Evidence: `state/logs/2026-10-15-stonekey.md`.

## License

Not yet declared — no `LICENSE` file.
