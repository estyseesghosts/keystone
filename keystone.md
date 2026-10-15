# Pinetree Frontend Quick-Start (SolidJS)

**Purpose:** Give an implementation agent enough context to build a small, working first-party web client for Pinetree without guessing at backend capabilities or accidentally building it like React.

**Backend:** [`estyseesghosts/pinetree`](https://github.com/estyseesghosts/pinetree)  
**Source-of-truth API contract:** [`docs/endpoint-manifest.md`](https://github.com/estyseesghosts/pinetree/blob/master/docs/endpoint-manifest.md)  
**Current backend status (checked 2026-10-15):** Phase 2.5 cleanup is complete; Phase 3 (client compatibility and streaming) is next. The frontend must work without streaming.

## 1. Before coding

From the Pinetree repository root, read these files first:

1. [`AGENTS.md`](https://github.com/estyseesghosts/pinetree/blob/master/AGENTS.md) — repository rules and current phase.
2. [`docs/wiki/Current-State.md`](https://github.com/estyseesghosts/pinetree/blob/master/docs/wiki/Current-State.md) — implemented features and gaps.
3. [`docs/endpoint-manifest.md`](https://github.com/estyseesghosts/pinetree/blob/master/docs/endpoint-manifest.md) — exact endpoint parameters, response shapes, auth requirements, and errors.
4. [`docs/domain-types.md`](https://github.com/estyseesghosts/pinetree/blob/master/docs/domain-types.md) — domain fields and constraints.

Inspect the current working tree before making changes. If no frontend exists, create a `frontend/` directory alongside `src/`. Do not change backend contracts to accommodate frontend assumptions. Do not create placeholder features that imply unsupported server functionality works.

## 2. Product and visual brief

Build a **minimalist, light-mode-only social feed**. A familiar timeline layout is fine, but do not copy X/Twitter branding.

- White or near-white background, dark readable text, muted secondary text, thin separators, and one restrained pine-green accent.
- Flat surfaces; no gradients, glass effects, heavy shadows, decorative cards, or elaborate animation.
- Desktop: compact left navigation and a centered timeline column (roughly 600 px wide). An optional right rail is allowed only when it contains useful, real content; do not fill it with fake trends or suggestions.
- Tablet: keep the feed readable and reduce navigation width when needed.
- Mobile: single-column feed with a usable bottom navigation bar. Do not simply hide the only navigation.
- Notes should show avatar, display name, handle, timestamp, text, content warning when present, media when present, and reply/renote/reaction counts where provided.
- Provide clear loading, empty, and error states. Use small, consistent controls and visible keyboard focus.
- No dark mode, theme selector, or theme infrastructure in this phase.

Keep the first version focused: sign in, home timeline, local timeline, compose a text note, open a note, view a user, follow/unfollow, react/unreact, and notifications if the endpoint response is straightforward. Refresh manually; streaming is not available. A working small UI is better than a large mock UI.

## 3. Bootstrap

Use a recent stable Node.js LTS release, not a hard-coded Node 24 minimum. The Node 24 requirement mentioned in the Pinetree README is for its Misskey test tooling, not this browser client.

From the repository root, if `frontend/` does not already exist:

```bash
npm init solid@latest frontend
```

Choose:

- **SolidStart project:** No
- **Template:** `ts`
- **TypeScript:** Yes

Then:

```bash
cd frontend
npm install
npm add @solidjs/router mfm-js
npm run dev
```

Use the plain Solid + Vite SPA template. Do not add React, SolidStart/SSR, a global state framework, a CSS framework, or a component library for this MVP unless an existing project constraint requires it.

## 4. Start the backend

Run these commands from the Pinetree repository root. Create the account **before** starting the server, and use the same `--data-dir` for both commands:

```bash
cargo build
target/debug/pinetree create-account --username=alice --password='change-this-password' --data-dir=./data
target/debug/pinetree --public-url=http://127.0.0.1:3000 --data-dir=./data --listen=127.0.0.1:3000
```

Keep the server running in its own terminal. Do not run `create-account` concurrently against the same data store while the server is running. Replace the example credentials.

## 5. Suggested structure

Keep components small and focused; avoid giant components and generic abstraction layers that do not solve a current need.

```text
frontend/
  src/
    index.tsx
    App.tsx
    api/
      client.ts
      types.ts
    components/
      Layout.tsx
      NoteCard.tsx
      MfmRenderer.tsx
      Composer.tsx
      LoadingState.tsx
      ErrorState.tsx
    routes/
      Login.tsx
      Home.tsx
      Local.tsx
      Notifications.tsx
      Note.tsx
      Profile.tsx
    styles/
      global.css
  vite.config.ts
```

Adjust this layout if the generated template differs. Do not create a file solely to match this tree if its contents would be empty or trivial.

## 6. API wiring

Pinetree's Misskey-compatible API uses JSON `POST` requests at `/api/{endpoint}`. Authentication may be sent as the JSON body's `i` field or as `Authorization: Bearer`. For this client, use the `i` body field consistently. API errors use an envelope similar to `{ "error": { "message": "...", "code": "...", "kind": "..." } }`. Some successful write endpoints return **204 No Content**, so do not unconditionally call `response.json()`.

### Vite proxy

Use same-origin relative API paths in the browser. This avoids hard-coded backend URLs and local development CORS problems. Add the proxy entries to the generated `vite.config.ts`, preserving its Solid plugin setup:

```ts
server: {
  proxy: {
    "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    "/files": { target: "http://127.0.0.1:3000", changeOrigin: true },
  },
},
```

The frontend runs on Vite's default `http://localhost:5173`; API calls go through `/api/...`. The `/files` proxy is for Pinetree-served media paths. Use the actual URLs returned by the API for media; do not fabricate file URLs.

### Small API helper

Implement one typed request helper in `src/api/client.ts`. It should:

- POST JSON to `/api/${endpoint}`.
- Add `i` only when a token exists, without overwriting a caller-provided `i` unintentionally.
- Read the body as text first; treat an empty body/204 as `undefined`.
- Parse JSON safely and throw a useful error using `error.message`, falling back to the HTTP status.
- Preserve useful server error details in development without displaying raw stack traces to users.

Example shape (adapt types as needed):

```ts
const TOKEN_KEY = "pinetree_token";

type ApiErrorBody = { error?: { message?: string; code?: string; kind?: string } };

export async function apiCall<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const body = token ? { ...params, i: params.i ?? token } : params;
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = response.status === 204 ? "" : await response.text();
  let payload: unknown;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`API returned invalid JSON (HTTP ${response.status})`);
    }
  }

  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    throw new Error(apiError?.error?.message ?? `API error: HTTP ${response.status}`);
  }

  return payload as T; // Use T = undefined for successful 204 endpoints.
}
```

`localStorage` is acceptable as a simple development token store, but it is accessible to injected JavaScript. Do not store passwords. Token-storage hardening can be handled separately before production deployment.

For media upload, use a separate `FormData` request to `drive/files/create`; do not set the multipart `Content-Type` header manually. Media upload can be deferred from the first slice.

## 7. Implemented API surface and hard limits

Use the frozen manifest as the definitive contract. The important supported endpoints for the initial UI are:

| UI capability | Endpoint | Notes |
|---|---|---|
| Instance metadata | `meta` | Public; optional for a minimal UI. |
| Sign in | `signin` | Send `username` and `password`; response includes `token`, `i`, and `user`. Store the token; never store the password. |
| Current account | `i` | Authenticated; used to restore a signed-in session. |
| Notifications | `i/notifications` | Authenticated. Confirm response fields from the manifest/current implementation before rendering each notification kind. |
| Home timeline | `notes/timeline` | Authenticated. Returns `Note[]`; use cursor IDs for pagination. |
| Local timeline | `notes/local-timeline` | Public. Returns `Note[]`. |
| Hybrid timeline | `notes/hybrid-timeline` | Authenticated. Optional; no need to expose it in the first UI. |
| Create note/reply/renote | `notes/create` | Authenticated; success is `{ createdNote: Note }`. For a reply pass `replyId`; for a renote pass `renoteId`. Basic text notes are enough for the first slice. |
| Open a note | `notes/show` | Pass `noteId`; missing/invisible notes return an API error rather than a null note. |
| Delete own note | `notes/delete` | Authenticated; success may be 204. Show only when appropriate. |
| React/unreact | `notes/reactions/create`, `notes/reactions/delete` | Delete takes `noteId`; these write endpoints can return 204. Respect `myReaction` and `reactions` from the note. |
| View user | `users/show` | Pass exactly one of `userId`, `userIds`, or `username` (plus optional `host`). Do not combine these selectors. |
| Search users | `users/search` | User search only; do not present this as note search. |
| Follow/unfollow | `following/create`, `following/delete` | Pass `userId`; authenticated. |
| Edit basic profile | `i/update` | Only the documented subset is supported. Avoid building a full profile editor in the first slice. |

### Unsupported — do not depend on these

The current backend has **no streaming route**. `src/streaming` is stubbed and the streaming sink is a no-op. The UI must use explicit refresh and cursor pagination; do not create a fake live connection or poll aggressively.

The following API endpoints are not implemented: `users/notes`, `users/followers`, `users/following`, `notes/renotes`, `notes/replies`, `notes/global-timeline`, and `notes/search`. Lists, antennas, clips, channels, polls, quote metadata, custom-emoji endpoints, and the Mastodon REST API are also outside the current supported surface. Do not build profile timelines, follower/following lists, note-search pages, or a global timeline that rely on these endpoints. The ability to create a reply/renote does not imply there is a list endpoint for fetching replies/renotes.

Unknown endpoints return 404; unknown fields on a supported endpoint return 400. Send only documented fields. In particular, do not pass Misskey fields speculatively: unsupported fields are rejected, not silently ignored.

## 8. Routing and application state

Use `@solidjs/router` with `<Router root={App}>` and `<Route>` children. Suggested routes:

- `/login`
- `/` — home timeline (requires sign-in; make the logged-out state clear)
- `/local` — public local timeline
- `/notifications` — authenticated notifications
- `/notes/:id` — one note and whatever reply/renote context `notes/show` actually returns; do not claim to show a complete thread
- `/users/:id` — user details via `users/show` using `userId`

A small `App` root should provide the shared layout around route content. Use Solid Router's `<A>` for internal links so navigation stays client-side.

Keep auth state simple: a token signal and current-user signal/store are enough. On startup, if a token exists, call `i`; if it fails with an authentication error, clear the token and show the logged-out state. Implement explicit sign-out. Do not introduce Redux, Zustand, React Context, or another global state system.

## 9. SolidJS rules for implementers

Solid looks like JSX but **does not use React's render-and-diff model**. Follow Solid's reactive model:

- Use `createSignal` for scalar state and `createStore` only when its nested update ergonomics are useful. A simple array can be held in a signal.
- Read signals by calling the accessor, e.g. `notes()`. Update with the setter. Do not copy a signal's value once and expect it to stay reactive.
- Do not destructure reactive props at the top of a component (`const { note } = props` can lose reactivity). Read `props.note` where needed.
- Prefer `<For each={notes()}>` for reactive lists and `<Show when={...}>` for conditional UI. Use Solid event handlers such as `onClick`; use `class`, not React's `className`.
- Do not use React hooks or assume components rerender when local variables change. Components execute to establish reactive bindings; signals drive subsequent updates.
- Avoid effect-driven state synchronization when a derived accessor is sufficient. Keep async requests in explicit loaders/event handlers, and expose loading/error state.
- Do not use `innerHTML` to render note content. Render text as text and build MFM output from parser nodes.

Reference: [SolidJS Quick Start](https://docs.solidjs.com/quick-start), [Solid Router setup](https://docs.solidjs.com/solid-router/getting-started/installation-and-setup).

## 10. Note and MFM rendering

Pinetree note text can contain Misskey Markup (MFM). Install `mfm-js`, the TypeScript MFM parser maintained by the Misskey project. Parse note text and render an allow-listed subset of its AST as Solid elements.

Start with plain text and common formatting: bold, italic, strike, code, quotes, links, mentions, and hashtags. Expand only after inspecting the installed package's actual TypeScript declarations and AST shapes. Do **not** copy type names or property paths from an unverified example; validate them against `mfm-js`'s installed definitions. Unknown nodes must degrade safely (render their text/children where possible, otherwise a harmless fallback), never disappear silently or be interpreted as HTML/JavaScript.

Use safe external links (`target="_blank"` with `rel="noopener noreferrer"`) and validate link URLs. Do not assume custom emoji names can be resolved to image URLs: custom-emoji lookup endpoints are not implemented. Use packed note/user emoji data only where its actual response shape provides the needed URL.

Reference: [mfm.js repository and parser usage](https://github.com/misskey-dev/mfm.js/).

## 11. Timeline and interaction details

- Fetch timeline data from the API; never hard-code sample notes as if they were real. If demo data is used during styling, clearly isolate it and remove it before handoff.
- Model wire types from `docs/domain-types.md` and `docs/endpoint-manifest.md`; use the API's camelCase fields (`createdAt`, `avatarUrl`, `repliesCount`, etc.), not internal Rust/domain field names.
- Timeline endpoints accept `limit` and cursor filters such as `sinceId`/`untilId`. Start with a modest limit (for example, 20) and a “Load older” control using the last note ID. Handle an empty list distinctly from a failed request.
- Include a manual refresh control because streaming is unavailable. Prevent overlapping requests and show failures without wiping a previously loaded timeline unnecessarily.
- For a reply, pass `replyId` to `notes/create`. For reaction toggles, use `myReaction`, `notes/reactions/create` and `notes/reactions/delete`. Do not leave buttons inert: either wire a button to a supported action or omit it / mark it disabled with a reason.
- The first composer can be plain text with a 3,000-character limit and a public-visibility default. If visibility controls are added, use only documented values (`public`, `home`, `followers`, `specified`) and require `visibleUserIds` for `specified`.
- Render content warnings, note visibility, missing avatars, media URLs, and deleted/unavailable note errors defensively. Never show private or specified content just because a linked note exists; the API's visibility policy is authoritative.

## 12. Verification and handoff

Before reporting completion:

1. `npm run build` succeeds.
2. `npm run dev` starts and the UI is usable on desktop and mobile widths.
3. Sign in with the local test account; reload and confirm session restoration; sign out.
4. Load home and local timelines; manually refresh; load older notes.
5. Create a note, reply to a note, react and unreact, open a note, view a profile, follow and unfollow, and load notifications where supported by the current API.
6. Exercise loading, empty, authentication-expired, API-error, and no-content (204) cases.
7. Confirm no browser console errors, no unsupported API calls, no inert controls, and no React dependencies.

Do not claim tests passed unless they were run. Keep the implementation small and leave a concise summary of what works, what remains intentionally out of scope, and any backend gaps encountered.

## References

- [Pinetree repository](https://github.com/estyseesghosts/pinetree)
- [Agent rules](https://github.com/estyseesghosts/pinetree/blob/master/AGENTS.md)
- [Current backend state](https://github.com/estyseesghosts/pinetree/blob/master/docs/wiki/Current-State.md)
- [Frozen endpoint manifest](https://github.com/estyseesghosts/pinetree/blob/master/docs/endpoint-manifest.md)
- [Core domain types](https://github.com/estyseesghosts/pinetree/blob/master/docs/domain-types.md)
- [SolidJS Quick Start](https://docs.solidjs.com/quick-start)
- [Solid Router setup](https://docs.solidjs.com/solid-router/getting-started/installation-and-setup)
- [MFM parser](https://github.com/misskey-dev/mfm.js/)
