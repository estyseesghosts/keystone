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
