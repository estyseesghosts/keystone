# Keystone — Pinetree web client (SolidJS)

Minimalist, light-mode-only first-party web client for
[estyseesghosts/pinetree](https://github.com/estyseesghosts/pinetree),
a Misskey-compatible social server written in Rust.

Status: **init** — project scaffolding and agent workflow only.
No `frontend/` code exists yet. See `state/STATE.md` for the resume pointer.

## Source briefs (read first)

- `keystone.md` — product/visual brief, bootstrap, API wiring, scope limits, verification.
- `solidjs.md` — SolidJS 1.x mental model and React-to-Solid rules.
- `pinetree/` — cloned backend reference (read-only, git-ignored).
  Frozen API contract: `pinetree/docs/endpoint-manifest.md`.
  Backend state: `pinetree/docs/wiki/Current-State.md`.
  Backend rules: `pinetree/AGENTS.md`.

## Quickstart

Backend (from `pinetree/`, one terminal, same `--data-dir` for both commands):

```bash
cargo build
target/debug/pinetree create-account --username=alice --password='change-this-password' --data-dir=./data
target/debug/pinetree --public-url=http://127.0.0.1:3000 --data-dir=./data --listen=127.0.0.1:3000
```

Frontend (not scaffolded yet — next step per `keystone.md` §3):

```bash
npm init solid@latest frontend
# SolidStart: No / Template: ts / TypeScript: Yes
cd frontend
npm install
npm add @solidjs/router mfm-js
npm run dev
```

Vite proxy (`/api`, `/files` → `http://127.0.0.1:3000`) is defined in
`keystone.md` §6. API auth uses the JSON body `i` field consistently.

## Layout

```text
README.md            this file
AGENTS.md            rules for agents (stack, workflow, state logging)
keystone.md          frontend quick-start brief (source of truth for scope)
solidjs.md           SolidJS guide for implementers (source of truth for UI model)
pinetree/            backend reference checkout (read-only, git-ignored)
docs/                living frontend docs (plan, API surface) + index
state/               resume pointer (STATE.md) + append-only session logs
frontend/            SolidJS SPA — does not exist yet
```

## Workflow (summary)

1. Before starting: read `AGENTS.md`, then `state/STATE.md`, then the latest
   `state/logs/` entry.
2. While working: keep slices small; update `state/STATE.md`.
3. When finishing or interrupted: update `state/STATE.md`, append one dated
   log to `state/logs/`. Never rewrite past logs.

Full rules: `AGENTS.md`. Docs index: `docs/README.md`.

## Verification (when frontend exists)

`npm run build` succeeds; sign in / session restore / sign-out; home + local
timelines with manual refresh and cursor paging; create / reply / react /
unreact / open note / view profile / follow / unfollow / notifications;
loading, empty, auth-expired, API-error, and 204 no-content cases; no console
errors, no unsupported endpoints, no inert controls. See `keystone.md` §12.

## License

Not yet declared — no `LICENSE` file.
