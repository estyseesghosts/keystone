# Router notes (`@solidjs/router`)

**Status:** Validated 2026-10-15 (`solid-js` 1.9.17, `@solidjs/router` 1.0.0; API confirmed by use + working app)

This is the UI routing reference for Keystone. `keystone.md` §8 and
`AGENTS.md` §7 define the routes; `solidjs.md` defines the UI model.
On conflict, `AGENTS.md` wins for frontend decisions.

## Version pin (filled 2026-10-15, from installed packages)

- `solid-js`: `1.9.17`
- `@solidjs/router`: `1.0.0` (peer `solid-js ^1.8.6` — compatible)
- Docs matched to: installed `*.d.ts` + working app (all patterns below in use)

Confirmed by implementation: `<Router root={Root}>` with `<Route>` children;
`<A href>` internal links; `useParams` (reactive, read in loader/loaders);
`useNavigate` + `<Navigate>` (login flow). No version upgrade/downgrade to
match docs — adapt code to installed behavior.

## Routes (fixed scope)

From `keystone.md` §8 / `AGENTS.md` §7:

| Path | File (suggested) | Auth | Data |
|---|---|---|---|
| `/login` | `routes/Login.tsx` | public | `signin` |
| `/` | `routes/Home.tsx` | gated (logged-out state clear) | `notes/timeline` |
| `/local` | `routes/Local.tsx` | public | `notes/local-timeline` |
| `/global` | `routes/Global.tsx` | public | `notes/global-timeline`, honest 404 fallback (owner decision 2026-10-15 — exception to the no-global-timeline rule; no fake data) |
| `/notifications` | `routes/Notifications.tsx` | gated | `i/notifications` (confirm fields vs manifest before rendering each kind) |
| `/notes/:id` | `routes/Note.tsx` | public fetch, auth for actions | `notes/show` (`noteId` from `:id`); reply/renote context as returned only |
| `/users/:id` | `routes/Profile.tsx` | public fetch | `users/show` with `userId` = `:id` (exactly one selector) |

No other routes in v1. Do not build profile timelines, follower lists,
note search, or global timeline — backend has no support
(`docs/api-surface.md`).

## Setup pattern (to verify against installed version)

Expected shape per `keystone.md` §8 — confirm prop names and exports
in the installed `*.d.ts` before coding:

- Root: `<Router root={App}>` with `<Route>` children (`App` provides shared layout).
- Internal navigation: `<A href="...">` so navigation stays client-side. No plain `<a>` for internal routes.
- Param routes (`/notes/:id`, `/users/:id`): read params reactively in JSX / memo (params object is reactive — do not snapshot once in setup and expect updates). Confirm accessor shape (`useParams`) in installed version.
- Redirects / post-login navigation (e.g. `useNavigate`, `<Navigate>`): confirm export exists in installed version before using; otherwise use `<Show>` gated UI + `<A>`.

If the installed version renames or restructures any of these, adapt the
frontend — do not upgrade/downgrade the router to match this doc.

## Auth gating

- Keep auth state minimal: token signal + current-user signal (`keystone.md` §8).
- Startup: if token exists call `i`; on auth failure clear token, show logged-out state. Explicit sign-out.
- Gate with reactive JSX (`<Show when={user()} fallback={...}>`), never setup-time `if`/early-return as a reactive branch (`solidjs.md` §3).
- `/` and `/notifications` show a clear logged-out state with a link to `/login`, not a silent redirect loop.

## Layout

- `App` root + `Layout`: desktop compact left nav + ~600px timeline column; mobile single column + usable bottom nav (never hide the only nav).
- Visual: follow `AGENTS.md` §7 (black/white/grey, light-mode-only, no accent/theme infrastructure). `keystone.md` §2 still mentions a pine-green accent — `AGENTS.md` wins until reconciled.
- Loading / empty / error / logged-out states on every route; visible keyboard focus.

## Anti-patterns

- No React, React DOM, React hooks, React Context, Redux/Zustand.
- No SolidStart/SSR, no global state framework, no CSS framework/component library for MVP (`AGENTS.md` §1).
- No `className`, no React-style `createEffect` dependency arrays, no `innerHTML` (see `mfm.md`).
- Dynamic lists: `<For each={items()}>`; conditionals: JSX expressions or `<Show>`/`<Switch>`/`<Match>` (`solidjs.md` §§3–4).

## Verification (per route, with real backend)

- [ ] Version pin section filled with executed output (not guessed).
- [ ] `npm run build` green; dev usable at desktop + mobile widths.
- [ ] All internal links use `<A>`; back/forward + direct URL load work for each route.
- [ ] Logged-out visit to `/`, `/notifications` shows logged-out state; sign-in → session restore on reload → sign-out works.
- [ ] `/notes/:id` with bad/invisible id follows API error path (no crash, no fake thread).
- [ ] `/users/:id` calls `users/show` with `userId` only.
- [ ] No console errors, no unsupported API calls, no inert controls, no React deps (`keystone.md` §12).
