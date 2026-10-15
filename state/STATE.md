# STATE — resume pointer (mutable, keep current)

**Phase:** 1 — build (2026-10-15; init complete)
**Backend ref:** `pinetree/` @ `ff651d6` — binary built OK (`cargo build` green,
warnings only; `CARGO_TARGET_DIR=.build/pinetree-target` due to tracked
`.cargo/config.toml` pointing at `/root`, read-only on this machine)
**Last session:** 2026-10-15 icons/git — vector icons, repost action, docs pins filled; committed + pushed (see logs)

## Decisions since init

- Vite accepted as build/dev tooling only (owner); AGENTS.md §1 stands.
- Palette: black/white/grey only, no accent colors (owner; supersedes
  `keystone.md` §2 pine-green brief — AGENTS.md §7 wins per source order).
- Feeds: Home + Local fully; **Global route with honest fallback** (owner):
  `/global` probes `notes/global-timeline` and shows a clear
  "not supported by this server" state (backend 404s it) instead of fake data.

## Current task

Quotes wired and clickable (see `logs/2026-10-15-quotes.md`). Browser-visual
pass still open; user re-testing after refresh.

## Next actions

## Next actions

- [x] Backend binary built (`cargo build` green)
- [x] `frontend/` scaffolded (create-solid `-v --ts -t bare`; Solid 1.x; +router, mfm-js, @types/node)
- [x] Vite proxy `/api` + `/files`, monochrome `global.css`, `apiCall` helper
- [x] Slices 1–3 built: auth shell, Home/Local/Global(honest 404 fallback),
      note detail, profile, notifications, composer, reactions, follow
- [x] `npx tsc --noEmit` clean, `npm run build` green
- [x] Backend round-trip 24/24 green (see `logs/2026-10-15-build.md`);
      dev servers running (below)
- [ ] Browser pass: sign-in → timelines → post/reply/react → profile →
      notifications on desktop + mobile widths; console-error check

## Servers running (background, dev only)

- Pinetree: `.build/pinetree-target/debug/pinetree --public-url=http://127.0.0.1:3000 --data-dir=./.data --listen=127.0.0.1:3000`
- Frontend: `npm run dev` in `frontend/` → http://localhost:5173
- Test accounts: alice / `alice-dev-password`, bob / `bob-dev-password`

## Blockers / open questions

- License for this repo: not yet declared.

## How to resume

1. Read `AGENTS.md`, this file, then the latest `state/logs/` entry.
2. Check `git status` and whether `frontend/` exists; backend binary is at
   `.build/pinetree-target/debug/pinetree` (run with `--data-dir=./data`).
3. Pick the top unchecked box above; update this file as you go.

## Current task

Docs slice (2026-10-15): version-matched router + mfm-js notes drafted as
version-pending (`docs/router.md`, `docs/mfm.md`); pin versions after Slice 0.

## Next actions

- [ ] Confirm Vite-as-build-tool-only is acceptable (see AGENTS.md §1), or direct otherwise
- [ ] Scaffold `frontend/` per `keystone.md` §3 (`npm init solid@latest`, router + mfm-js)
- [ ] Pin versions in `docs/router.md` + `docs/mfm.md` from installed `package.json` / `*.d.ts` (see each file's Version pin section)
- [ ] Wire `apiCall` helper + Vite proxy per `keystone.md` §6
- [ ] Thinnest slice: login → home/local timelines → note detail (`docs/frontend-plan.md`)

## Blockers / open questions

- Router/MFM docs drafted version-pending per owner choice (two files, pin
  later); filling Version pin sections is blocked on Slice 0 scaffold.
- License for this repo: not yet declared.

## How to resume

1. Read `AGENTS.md`, this file, then the latest `state/logs/` entry.
2. Check `git status` and whether `frontend/` exists; verify backend ref with
   `git -C pinetree rev-parse --short HEAD`.
3. Pick the top unchecked box above; update this file as you go.
