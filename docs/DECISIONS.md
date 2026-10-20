# DECISIONS.md

One line per decision: date + what + one-line reason. Full context lives
in `adr/` when load-bearing.

| Date       | Decision                                                                                                              | Reason                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-10-20 | Repo initialized (`main`), long-horizon state protocol adopted (`AGENTS.md` §2, `state/`, `docs/tasks/`, `docs/adr/`) | Sessions have no shared memory; state on disk is the only continuity |
| 2026-10-20 | `rn-rebuild-plan.md` accepted as plan source of truth; Bluesky `cf16c1d` pinned as reference                          | Awaiting owner sign-off on plan §7 D1–D8 (Phase 0 gate)              |
| 2026-10-20 | P1.1 scaffold pins: expo 57.0.24, RN 0.86.3, react 19.2.3, rn-web 0.21.0, tanstack 5.96.2, nav 7, lingui 5.9.2, reanimated 4.7.1, MMKV 3, zod 3 | Mirror Bluesky build/target arch; no UI, no atproto, no Sentry/EAS   |
| 2026-10-20 | Placeholder identity `Keystone` / `keystone` / `app.keystone.dev`                                                     | Pending owner D3; no store builds until signed                       |
| 2026-10-20 | No Bluesky `patches/` carried; `allowBuilds: {esbuild: true}` only                                                    | Patches target modules we don't vendor; re-evaluate per slice        |
