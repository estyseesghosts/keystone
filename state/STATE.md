# STATE — resume pointer (mutable, keep current)

**Phase:** 2 — Misskey/Sharkey targets live (2026-10-15)
**Backends:** Misskey `2026.10.1-alpha.0` @ `127.0.0.1:3101`
(`KEYSTONE_BACKEND_ONLY=1`, web UI disabled, API verified) ·
Sharkey `2025.4.7` @ `127.0.0.1:3102` (same mode) ·
Pinetree default @ `127.0.0.1:3000`
**Frontends:** Keystone misskey-mode `:5176`, sharkey-mode `:5177`
(Vite `--mode misskey` / `--mode sharkey`); Pinetree-mode `:5173`
**Last session:** 2026-10-15 stonekey — backend-only switch, Keystone-owned
auth, all stonekey_ui P1/P2 fixes, smoke-verified both servers (see logs)

## Decisions since init

- Targets are Misskey + Sharkey (backend-only) with Pinetree default kept;
  `docs/api-surface.md` is the authoritative endpoint matrix (supersedes
  `keystone.md` §§7–8 unsupported list for these backends).
- Auth is Keystone-owned: no redirect to instance `/miauth/*` pages, ever.
  Misskey-family login = `signin-flow` → Keystone permission screen →
  `miauth/gen-token` + check → scoped app token (temp native credential never
  stored). Doc correction: native route is `/api/signin-flow`, not `/api/signin`.
- Cross-backend params limited to `{limit, sinceId, untilId}` (+ ids/text);
  never Misskey-only `include*Renotes`; `i/notifications` has no `isRead`.
- Palette: black/white/grey only, no accent colors (owner; `keystone.md` §2
  pine-green brief superseded).
- Feeds: Home + Local + Global (global exists on both servers);
  profile notes via `users/notes`; replies via `notes/replies` (labeled partial).

## Current task

Stonekey slice landed + pushed. Next (explicitly scoped, each its own slice):
streaming, media upload UI, broader feature support.

## Servers running (background, dev only)

- Misskey: `node built/entry.js` in `/root/fedifedifedi/misskey/packages/backend`
  (Node v24.22.0) with `MISSKEY_CONFIG_YML=/tmp/pinetree-interop/misskey.yml`,
  `KEYSTONE_BACKEND_ONLY=1` → `127.0.0.1:3101`
  (log `/tmp/pinetree-interop/misskey.log`)
- Sharkey: `node built/boot/entry.js` in `/root/fedifedifedi/sharkey/packages/backend`
  with `MISSKEY_CONFIG_YML=/tmp/pinetree-interop/sharkey.yml`,
  `KEYSTONE_BACKEND_ONLY=1` → `127.0.0.1:3102`
  (log `/tmp/pinetree-interop/sharkey.log`)
- Keystone Vite: misskey-mode `:5176` (log `/tmp/keystone-vite-misskey.log`),
  sharkey-mode `:5177` (log `/tmp/keystone-vite-sharkey.log`),
  Pinetree-mode `:5173`
- Test accounts: mk1 / `password123` (misskey), sk1 + sk2 / `password123` (sharkey)
- Backend source patch: `KEYSTONE_BACKEND_ONLY` guard around
  `clientServerService.createServer` registration in both
  `packages/backend/src/server/ServerService.ts` (+ matching built output:
  misskey `built/ServerService-BRIfgkyT.js`, sharkey
  `built/server/ServerService.js`)
- Smoke: `/tmp/keystone-smoke.py` + `/tmp/keystone-smoke2.py` all green
  (see `logs/2026-10-15-stonekey.md`); `npm run build` green

## Blockers / open questions

- License for this repo: not yet declared.
- No browser in this environment: verification is API-transport probes +
  static source checks (no screenshots, no console-error observation).
  Items needing a real browser pass are marked **not yet verified** in the log.

## How to resume

1. Read `AGENTS.md`, this file, then the latest `state/logs/` entry.
2. Check `git status`; backends via `curl -m 5 -X POST
   http://127.0.0.1:3101/api/meta -H 'content-type: application/json' -d '{}'`
   (and `:3102`); frontends `:5176` / `:5177`.
3. Restarting a backend? Relaunch with the env above (misskey needs Node
   v24.22.0 first on PATH — the system node v22 cannot load its `re2.node`).
