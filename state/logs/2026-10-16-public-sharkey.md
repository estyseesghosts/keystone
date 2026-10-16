# 2026-10-16 — public Sharkey bring-up (no local backend)

**Goal:** get Keystone running on this machine (macOS, no local
Misskey/Sharkey/Pinetree) against a public Sharkey (`dvd.chat`).

## What was already in place

Slice 8 (external MiAuth accounts, `f32a446`, already on `origin/main`)
covers exactly this: the **External server** tab on `/login` talks direct
to the instance over CORS, bypassing the Vite proxy — no local backend
needed. Streaming refuses to open a socket while an external account is
active (token must never reach the local `/streaming` endpoint); feeds use
refresh + paging.

## Evidence (real output, this machine)

- `cd frontend && npm run build` → green (vite 7.3.7, 66 modules,
  `dist/` written in 784ms). Node v26.8.1 / npm 11.19.0.
- `npm run dev -- --port 5173 --strictPort` → `GET /` 200, `GET /login` 200
  (dev server left running on `:5173`).
- `POST https://dvd.chat/api/meta` → 200, `version: "2025.4.7"`
  (Sharkey — same version as the local Sharkey rig, so the verified
  `docs/api-surface.md` matrix applies).
- `GET https://dvd.chat/miauth/test-session?...` → 200 (approval page live).
- `POST https://dvd.chat/api/meta` with `Origin: http://127.0.0.1:5173` →
  200 + `access-control-allow-origin: *` (direct browser traffic works).
- `POST https://dvd.chat/api/signin-flow` (empty body) → 400, i.e. endpoint
  exists (not 404).

## What changed

- `README.md`: quickstart gains the no-local-backend path (external tab).
- `docs/setup.md`: new §7 "No local backend? Test against a public instance".

No code changes — none needed. The internal "This server" tab fails without
a local backend; that is expected, not a bug.

## Open questions / next step

- Browser round-trip (approve on dvd.chat → redirect to
  `127.0.0.1:5173/login?extcb=1…` → feeds) is **not yet verified** — needs
  the owner in a real browser. Steps: open `:5173/login?mode=external`,
  enter `dvd.chat`, approve, finish sign-in.
