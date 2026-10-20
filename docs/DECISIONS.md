# DECISIONS.md

One line per decision: date + what + one-line reason. Full context lives
in `adr/` when load-bearing.

| Date       | Decision                                                                                                                                        | Reason                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-10-20 | Repo initialized (`main`), long-horizon state protocol adopted (`AGENTS.md` §2, `state/`, `docs/tasks/`, `docs/adr/`)                           | Sessions have no shared memory; state on disk is the only continuity |
| 2026-10-20 | `rn-rebuild-plan.md` accepted as plan source of truth; Bluesky `cf16c1d` pinned as reference                                                    | Awaiting owner sign-off on plan §7 D1–D8 (Phase 0 gate)              |
| 2026-10-20 | P1.1 scaffold pins: expo 57.0.24, RN 0.86.3, react 19.2.3, rn-web 0.21.0, tanstack 5.96.2, nav 7, lingui 5.9.2, reanimated 4.7.1, MMKV 3, zod 3 | Mirror Bluesky build/target arch; no UI, no atproto, no Sentry/EAS   |
| 2026-10-20 | Placeholder identity `Keystone` / `keystone` / `app.keystone.dev`                                                                               | Pending owner D3; no store builds until signed                       |
| 2026-10-20 | No Bluesky `patches/` carried; `allowBuilds: {esbuild: true}` only                                                                              | Patches target modules we don't vendor; re-evaluate per slice        |
| 2026-10-20 | P2.1 core port done on `main`: `packages/fedi/src/core/*` (10 modules), 5 Jest suites / 109 tests, counts match originals                      | Phase 2 slice 1 of 6; trio green (11 suites / 137 tests)            |
| 2026-10-20 | Sync `KeyValueStore` seam in `core/sessions.ts` (+ `createMemoryStore()`); SecureStore token layer wraps above in 2.5                           | Matches old call sites 1:1; MMKV backing is sync                     |
| 2026-10-20 | Data layer returns `{code, params}` error codes (`FediError`: `HttpError`/`ApiError`); UI localizes                                           | Keeps `packages/fedi` Lingui-free per `no-ui-in-fedi`                |
| 2026-10-20 | `config`/`hosting`/`boot` take `origin`/`builtBase`/`devFlavorHint` params; no `location`/`import.meta` in `packages/fedi`                      | RN-safe; `no-ui-in-fedi` bans browser globals                        |
| 2026-10-20 | P2.2 Misskey adapter done: 25 modules, fixtures `misskey/`+`sharkey/`, 8 suites / 181 tests, new mock-WS `note`-event stream test               | Trio green (23 suites / 411 tests)                                    |
| 2026-10-20 | Solid signals → `eventemitter3` (`createCustomEmojiStore`/`createTranslator`/`createStreamPool`); stream URL from session origin                | RN has no Solid; per-session pools carry origin+token                 |
| 2026-10-20 | `importExport` DOM anchor-click → pure `serializeExport`; UI owns download/share                                                                | RN has no anchor download                                             |
| 2026-10-20 | `mfm-js@0.27.0` added (Misskey translate; 2.4 reuses for `fromMfm`); declared in root + `packages/fedi/package.json`                             | Old code parsed MFM via mfm-js                                        |
| 2026-10-20 | P2.3 Mastodon adapter done: 14 modules (`sanitize.ts` deferred to 2.4), fixtures `mastodon/`+`akkoma/`, new WS stream test                     | SSE→WebSocket `/api/v1/streaming`, polling fallback kept             |
| 2026-10-20 | Mastodon OAuth: callback URL is a parameter; token/app cache behind 2.1 `KeyValueStore`; no `window`/`document`/`../routes`                    | `no-ui-in-fedi` compliance                                            |
| 2026-10-20 | Fedi barrel: colliding adapter names explicitly aliased (`adaptMastodonAccount`, `createMastodonStreamHandle`, …)                               | `export *` from both adapters is ambiguous                            |
| 2026-10-20 | P2.4 content AST done: `core/content/{ast,fromMfm,fromHtml}`, XSS suite, Akkoma-MFM path, `api/{fold,tags,emoji,emojiAssets,linkpreview}`       | One allow-listed AST for MFM+HTML; trio green (28 suites / 487 tests) |
| 2026-10-20 | `htmlparser2@12.0.0` picked for HTML→AST (+ jest `transformIgnorePatterns` extension for its ESM chain)                                        | Works under jest-expo babel + RN Hermes; no WASM/node-only deps      |
| 2026-10-20 | `api/linkpreview` rewritten RN-safe (htmlparser2 + fetch seam, no `DOMParser`/streams)                                                        | `DOMParser` unavailable on native                                     |
| 2026-10-20 | Old `api/client`+`api/backend` facade + `client-routing` (23 tests) deferred to 2.5 (needs session store), not half-ported                     | Facade routes on sessions; store lands in 2.5                         |
| 2026-10-20 | P2.5 sessions+storage done: `src/storage/` (zod schema, MMKV KV, `TokenVault` `.web.ts` split) + `src/state/session/` + fedi `api/` facade      | Trio green (35 suites / 553 tests); cross-origin token test at store level |
| 2026-10-20 | `expo-secure-store@58.0.2` for tokens on native, MMKV on web (dev-grade); token keying per (sessionId, origin); vault wins over envelope copy  | Tokens never cross origins; sync seam kept for MMKV                   |
| 2026-10-20 | Session provider deliberately NOT mounted in `Root.tsx` (Phase 3 owns boot)                                                                    | Avoid half-wired auth state in the shell                              |
