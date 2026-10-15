# AGENTS.md — Keystone (Pinetree web client)

Source of truth order: this file → `keystone.md` (scope/brief) →
`solidjs.md` (UI model) → `pinetree/docs/endpoint-manifest.md` (frozen API
contract). If they disagree, the earlier file wins for frontend decisions;
the backend contract is never overridden — adapt the frontend instead.

## 1. Stack — SolidJS only

- UI framework is **SolidJS exclusively**. Do not introduce React, React DOM,
  React hooks, or React-oriented libraries (no Redux, Zustand-as-React,
  `create-react-app`, React Context).
- Do not introduce SolidStart/SSR, a global state framework, a CSS framework,
  or a component library for the MVP unless the user explicitly asks.
- **Vite note:** the standard Solid template (`npm init solid@latest`) is a
  Solid + Vite SPA using `vite-plugin-solid`, and `keystone.md` §§3,6 use
  Vite as the dev server/build tool plus the `/api` + `/files` proxy. Vite is
  permitted **only** in that build-tooling role. It is not a UI framework:
  no React-flavored Vite template, no React plugin, no SSR adapter.
- If a task seems to require React or a different framework, stop and ask
  instead of adding it.

## 2. Layout

- `keystone.md` — frontend brief: product, bootstrap, API wiring, scope, verification.
- `solidjs.md` — SolidJS 1.x guide: signals, stores, effects, props, lists, checklist.
- `pinetree/` — backend reference checkout. **Read-only: never edit.**
  Refresh with `git pull` inside it; record the commit hash in the session log.
  Key files: `docs/endpoint-manifest.md` (frozen), `docs/domain-types.md`,
  `docs/wiki/Current-State.md`, `AGENTS.md`.
- `docs/` — living frontend docs. See `docs/README.md` for the index.
- `state/` — resume pointer plus append-only logs. See `state/README.md`.
- `frontend/` — the SolidJS SPA (does not exist yet; scaffold per `keystone.md` §3).

## 3. Current phase

Phase 0 — init (2026-10-15): scaffolding and workflow only. Next: scaffold
`frontend/` per `keystone.md` §3, wire the typed `apiCall` helper (§6), then
build the smallest working slice (login → timelines → note detail) before
adding interactions. No streaming anywhere: the backend has no streaming
route (`src/streaming` is a stub); use manual refresh + cursor pagination.

## 4. State maintenance (required every session — this is the interruption protocol)

Agents get interrupted. Every session must leave the next agent able to resume
in under five minutes.

1. **Before starting:** read this file, then `state/STATE.md`, then the latest
   entry in `state/logs/`. Inspect the working tree (`frontend/` if present,
   `pinetree/` commit hash) before changing anything.
2. **While working:** keep slices small and landable. Keep `state/STATE.md`
   accurate (current task, next actions, blockers). One task at a time.
3. **When finishing — or when interrupted, about to stop, or context is
   running low:** first update `state/STATE.md`, then append one dated log
   `state/logs/YYYY-MM-DD-<topic>.md` (goal, what changed, evidence with real
   command output or `not yet verified`, open questions, next step).
   Never rewrite or delete past logs; supersede by reference.
4. If you did not finish a checklist item in `keystone.md` §12 or
   `docs/frontend-plan.md`, say so explicitly. Do not claim verification that
   was not executed.

## 5. Backend contract rules

- The frozen manifest (`pinetree/docs/endpoint-manifest.md`) is definitive.
  Send only documented fields; unknown fields are rejected (400), unknown
  endpoints 404. Never change backend contracts to fit frontend assumptions.
- Transport: JSON `POST` to `/api/{endpoint}`; auth via the `i` body field
  consistently. Successful writes may return **204 No Content** — do not call
  `response.json()` unconditionally. See `keystone.md` §6 for the helper shape.
- Supported first slice: `meta`, `signin`, `i`, `i/notifications`,
  `notes/timeline`, `notes/local-timeline`, `notes/create`, `notes/show`,
  `notes/delete`, `notes/reactions/create`, `notes/reactions/delete`,
  `users/show`, `users/search`, `following/create`, `following/delete`,
  `i/update` (documented subset only). Details: `docs/api-surface.md`.
- **Do not build** on unsupported endpoints: `users/notes`, `users/followers`,
  `users/following`, `notes/renotes`, `notes/replies`, `notes/global-timeline`,
  `notes/search`, lists/antennas/clips/channels/polls/quotes/custom-emoji
  endpoints, Mastodon REST. No profile timelines, follower lists, note search,
  or global timeline. No fake live connection or aggressive polling.
- Wire types use the API's camelCase fields (`createdAt`, `avatarUrl`,
  `repliesCount`), not internal Rust names. See `pinetree/docs/domain-types.md`.
- Every button is either wired to a supported action or omitted/disabled with
  a reason. No inert controls, no hard-coded sample notes presented as real,
  no fabricated file URLs (use API-returned media URLs only).

## 6. SolidJS rules (summary — `solidjs.md` is authoritative)

- Components run once per instance (setup code); signals drive updates.
  Read signals via accessors (`notes()`), update via setters. Never expect a
  plain local copy of signal/props to stay reactive — derive in JSX or use
  `createMemo`.
- Read `props.foo` where used. Do not destructure reactive props into plain
  locals; use `splitProps`/`mergeProps` when partitioning/defaulting.
- Dynamic lists: `<For each={items()}>` (or `<Index>` when position identity
  is correct). Conditionals: JSX expressions or `<Show>`/`<Switch>`/`<Match>`;
  never setup-time `if`/early-return as a reactive branch.
- `createSignal` for scalar state; `createStore` only where nested-update
  ergonomics help. Update arrays/objects via setter, never silent in-place
  mutation. `class`, not `className`; `onClick` etc.; no React hooks.
- No React-style `createEffect` dependency arrays. Effects are for side
  effects; memos for derived values. Cleanup via `onCleanup`, not a returned
  function. Async data via `createResource` or explicit event-driven loading
  with error/cancellation handling — never bare `async` effects.
- No `innerHTML` for note content. Parse MFM with `mfm-js` and render an
  allow-listed AST subset as Solid elements; validate type/property names
  against the installed package declarations; unknown nodes degrade to safe
  text, never HTML/JS. Safe external links (`target="_blank"`,
  `rel="noopener noreferrer"`); custom emoji only from packed response URLs.
- Before returning Solid code, run the checklist in `solidjs.md` §10.

## 7. Product and scope guards

- Minimalist black/white/grey feed; no accent colors, no dark mode, no theme
  infrastructure. White or near-white background, black/dark readable text,
  grey secondary text and separators. No gradients, glass, heavy shadows,
  decorative cards, or elaborate animation. Desktop: compact left nav + ~600px
  timeline; mobile: single column + usable bottom nav (never hide the only nav).
- Notes show avatar, display name, handle, timestamp, text, CW, media, and
  counts where provided. Clear loading/empty/error states, visible focus.
- Routes: `/login`, `/` (home, auth-gated), `/local`, `/notifications`,
  `/notes/:id`, `/users/:id` (via `userId`). Router: `@solidjs/router`
  `<Router root={App}>`, internal links with `<A>`.
- Auth state: token + current-user signals only. Startup: if token exists call
  `i`; on auth failure clear token and show logged-out state. Explicit
  sign-out. `localStorage` token store is acceptable for development only
  (never passwords); hardening is a separate pre-production task.
- Composer v1: plain text, 3,000-char limit, `public` default. Visibility
  values limited to documented set; `specified` requires `visibleUserIds`.
- Keep `docs/frontend-plan.md` (scope checklist) accurate. Out-of-scope stays
  out until a new session explicitly moves it in.

## 8. Verification

- Verify by execution. `npm run build` green; exercise `keystone.md` §12
  end-to-end against a local backend; paste or reference real output in the
  state log. `not yet verified` when it was not run — never imply otherwise.
- Confirm: no console errors, no unsupported API calls, no inert controls,
  no React dependencies, desktop + mobile widths usable.
