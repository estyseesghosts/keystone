# Keystone v2 architecture — one page

Status pointer: `state/STATE.md` (repair program 2026-10-25 complete:
292 suites / 4123 tests; owner device + live checks pending). This file
describes how the thing works, not what to do next.

## Data flow

```
servers                          data layer (pure TS)              app (RN + web)
Misskey-family :3101/:3102 ──┐
                 ├─ packages/fedi ──► src/
                  │   misskey/adapter     state/session ──► state/queries ──► state/cache ──► UI
                 │   (client, backend,    store, Session-   keys (sessionId    post-shadow,
Mastodon-family ──┘   stream, adapt)       Provider)         FIRST)            gates
                    mastodon/adapter                                │              │
                    (backend, stream,                            storage        components/
                    instance caps)                         MMKV + SecureStore   screens
                    core/models                               (vault.ts,
                    (Post, Account,                       tokens.ts/.web.ts)
                    Notification)
                    core/detect (Capabilities)
                    core/feedDescriptor
                    core/content (allow-listed AST)
```

Reading downwards in code:

1. **Wire → domain** — `packages/fedi/src/misskey/backend.ts` and
   `packages/fedi/src/mastodon/backend.ts` implement one `Backend`
   interface (`packages/fedi/src/core/backend.ts`). Wire types never
   cross into `src/` (lint rule `no-wire-in-app`); the public surface
   is `packages/fedi/src/index.ts` (domain models, detection, backend,
   sessions, error codes).
2. **Sessions** — `packages/fedi/src/core/sessions.ts` (`Session`,
   `sessionId(origin, accountId)`). Tokens are per origin; request
   building for session A never carries session B's token or origin.
   Unknown server fields are dropped before send (strict servers answer
   400), 204s
   handled, MiAuth token flow, Mastodon streaming over WebSocket (not
   SSE).
3. **Queries** — `src/state/queries/keys.ts`: every key starts with the
   sessionId (`createQueryKey` throws on empty). Feeds page through
   `usePostFeedQuery.ts` / `feeds.ts`, addressed by `FeedDescriptor`
   strings (`packages/fedi/src/core/feedDescriptor.ts` — deck columns
   are `{descriptor, sessionId, options}`).
4. **Cache** — `src/state/cache/post-shadow.ts` (optimistic post state),
   `patch.ts`, and `gates.ts`: every write action is gated on a
   `Capabilities` flag (`core/detect.ts`, built per flavor in each
   backend). Unsupported renders hidden or disabled **with a reason**
   (`gateAction` → `reason`/`reasonCode` → `disabledReason` on
   `src/components/Button.tsx`). No inert controls, no fake data.
5. **Content** — MFM via `core/content/fromMfm.ts` (mfm-js), HTML via
   `core/content/fromHtml.ts` (htmlparser2), field values via
   `core/content/fields.ts` — all parse to the one allow-listed AST in
   `core/content/ast.ts` (`ContentNode`). One `RichText` renders it
   everywhere (`src/components/RichText.tsx`). No `innerHTML`, no
   WebView.
6. **Storage** — `src/storage/mmkv.ts` (shared MMKV instance id
   `keystone` behind the core `KeyValueStore` seam; web runs the same
   seam on the MMKV web shim). Native bearer tokens and OAuth app
   secrets live only in the OS vault (`src/storage/vault.ts`,
   `tokens.ts`) with an in-memory overlay, per ADR
   `docs/adr/0011-token-storage.md`; the persisted envelope is
   tokenless. Web is `localStorage`-backed and dev-grade
   (`tokens.web.ts`) — a documented release blocker, see
   `docs/web-hosting.md`.
7. **Streaming** — `packages/fedi/src/misskey/stream.ts`
   (`createStreamPool`, `createStreamHandle`, `streamUrlFor`) and the
   Mastodon counterpart. Misskey-family auth rides same-origin `?i=`;
   Mastodon-family rides `Sec-WebSocket-Protocol` (no token in URL).
   The smoke probe builds a handle but opens no socket without
   `FEDI_SMOKE_TOKEN` (`scripts/fedi-smoke.ts`).

Purity boundaries (lint-enforced): `packages/fedi` imports no
`react`/`react-native`/`expo*`, no `#/` alias, no `window`/`document`
(`no-ui-in-fedi`); `src/` sees only domain models
(`Post`, `Account`, `Notification`, `Capabilities`).
