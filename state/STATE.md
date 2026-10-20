# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 4 COMPLETE in code (4.1–4.5 + 4.6 integration, on `main`).
Gate G4: owner review — write actions NOT verified live on the rig, none on
device/web. Optimistic Jest tests green (60 suites / 816 tests).
Gate G3: owner override recorded 2026-10-20 (see DECISIONS); parity tick open.
Branch: `main`.
Plan: `rn-rebuild-plan.md`. Reference: Bluesky `social-app` @ `cf16c1d` (ADR-0001).

## Next 3 steps

1. Owner G4 review: run `pnpm web`; `pnpm ios` / `pnpm android` (dev-client
   rebuild needed: expo-image-picker + expo-clipboard are native). Exercise
   like/react/boost/bookmark/delete, compose (reply/quote/poll/media), follow/
   mute/block against Pinetree :3000 and Akkoma :4000.
2. Close known gaps: composer edit mode; boosts-only mute; scheduling backend
   for Mastodon; Misskey bookmark capability detection; Misskey `users/lists/*`
   endpoint names (and `lists/list`) check; Clip/Report UI.
3. Owner G1/G2 reviews and §7 D1–D8 sign-off still open; then Phase 5 (deck).

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Pinetree rig seed: `ks1`/`password123` gets 401 (owner). Misskey :3101 /
  Sharkey :3102 down.
- Device runs never attempted — not verified.

## Links

- Tasks: `docs/tasks/` (p1.1–p4.6 done; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p3.11-*`, `p4.{1,2,3,4,5,6}-*`
