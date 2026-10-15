# AGENTS.md — Keystone (Misskey-family web client)

Source of truth order: this file → `keystone.md` (original Pinetree brief,
historical) → `solidjs.md` (UI model) → `docs/api-surface.md` (verified
endpoint matrix for Misskey/Sharkey/Pinetree). If they disagree, the earlier
file wins for frontend decisions — except that `docs/api-surface.md` wins
over `keystone.md` on backend capabilities: the Pinetree brief's unsupported
list does not apply to Misskey/Sharkey.

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
- `docs/` — living frontend docs: `api-surface.md` (verified matrix),
  `frontend-plan.md` (scope checklist), `stonekey_ui.md` + `stonekey_backend.md`
  (review findings — note corrected endpoints in `api-surface.md`), `mfm.md`,
  `router.md`. See `docs/README.md` for the index.
- Backend checkouts live outside this repo (`/root/fedifedifedi/misskey`,
  `/root/fedifedifedi/sharkey`): both carry the `KEYSTONE_BACKEND_ONLY` patch
  in `packages/backend/src/server/ServerService.ts` (+ built output).
- `state/` — resume pointer plus append-only logs. See `state/README.md`.
- `frontend/` — the SolidJS SPA (slices 0–3 built; see `docs/frontend-plan.md`).

## 3. Current phase

Phase 2 — Misskey/Sharkey targets live (2026-10-15): Keystone runs against
local Misskey (`:3101`) and Sharkey (`:3102`) backends in `KEYSTONE_BACKEND_ONLY=1`
mode, plus Pinetree default. Auth is Keystone-owned (no instance redirects).
Slices 0–3 built and smoke-verified on both servers; see `docs/frontend-plan.md`
and `state/logs/2026-10-15-stonekey.md`. Next: streaming, media upload UI,
broader feature support — each as an explicitly scoped slice.

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

- Targets: local Misskey (`127.0.0.1:3101`) and Sharkey (`127.0.0.1:3102`),
  both in `KEYSTONE_BACKEND_ONLY=1` mode (web UI disabled; API/files/streaming
  live); Pinetree (`127.0.0.1:3000`) remains the default target. The same
  frontend switches via Vite mode (`--mode misskey` / `--mode sharkey`).
  Authoritative matrix: `docs/api-surface.md` (verified 2026-10-15).
- Transport (all three): JSON `POST` to `/api/{endpoint}`; auth via the `i`
  body field consistently. Successful writes may return **204 No Content** —
  do not call `response.json()` unconditionally. Misskey-family unknown POST
  paths answer 404 non-JSON: keep the HTTP status on the thrown error.
- Login: Pinetree `signin`; Misskey/Sharkey `POST /api/signin-flow`
  (`/api/signin` does NOT exist there) → Keystone permission screen →
  `miauth/gen-token` + `POST /api/miauth/:session/check` → scoped app token
  (`read:account`, `write:notes`, `write:reactions`, `write:following`,
  `read:notifications`). Never navigate to instance-hosted pages
  (`/miauth/*`, authorize); never persist the temporary native credential.
  Tokens are stored per-backend — a Misskey token is never sent to Sharkey.
- Cross-backend params: send only `{limit, sinceId, untilId}` (+ ids/text like
  `noteId`, `userId`, `replyId`, `renoteId`, `reaction`). Never send
  `includeMyRenotes`/`includeRenotedMyNotes`/`includeLocalRenotes`
  (Misskey-only; Sharkey 400s unknown fields). `i/notifications` has **no
  `isRead`**; `following/create|delete` return `UserLite`; `users/notes`,
  `notes/replies`, `notes/conversation`, `notes/global-timeline` exist on
  both — profile timelines, reply threads, and global feed are supported.
- Every button is either wired to a supported action or omitted/disabled with
  a reason. No inert controls, no hard-coded sample notes presented as real,
  no fabricated file URLs (use API-returned media URLs only). Composer is
  text-only: no upload button until upload is implemented end-to-end
  (`drive/files/create` is multipart `FormData`, not JSON).

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
- Routes: `/login`, `/` (home, auth-gated), `/local`, `/global`,
  `/notifications`, `/notes/:id`, `/users/:id` (via `userId`). Router:
  `@solidjs/router` `<Router root={App}>`, internal links with `<A>`.
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
