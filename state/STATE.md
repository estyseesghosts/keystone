# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: v1-parity sweep COMMITTED as `ffffe08d` on
`p3.1-signin-functional`: profile v1 restyle, persistent v1 tab bar,
avatar/name/handle -> profile, post -> detail, Settings-trap fixed,
reply threadlines, OpenMoji default + 9-section Settings tree (greyed
placeholders for unwired rows, per owner), post detail thread view,
popup caret + entrance motion, unlike queue-seed fix.
Trio green (75 suites / 940 tests). Helium visual check pending
(isolated CDP unresponsive; retry before merge-review).
Gate G4: owner review — write actions NOT verified live on the rig, none on
device/web. Optimistic Jest tests green.
Gate G3: owner override recorded 2026-10-20 (see DECISIONS); parity tick open.
Branch: `p3.1-signin-functional`.
Plan: `rn-rebuild-plan.md`. Reference: Bluesky `social-app` @ `cf16c1d` (ADR-0001).

## Next 3 steps

1. Owner: merge-review `p3.1-signin-functional` (everything above), then
   device runs — sign in on `pnpm web` (both families) and `pnpm ios` /
   `pnpm android` incl. `keystone:` deep link + MFA. Exercise like/react/
   boost/bookmark/delete, composer, follow/mute/block, settings sections
   against Pinetree :3000 and Akkoma :4000.
2. Helium visual pass vs v1 (profile, settings tree, tabs, threadlines,
   detail, popup caret) once CDP responds; screenshot evidence into log.
3. Remaining butterfly gaps: notifications, explore, feed chrome polish
   (skeletons, "N new posts", safe-area insets), composer edit mode,
   boosts-only mute, scheduling backend, Clip/Report UI.
3. Owner G1/G2 reviews and §7 D1–D8 sign-off still open; then Phase 5 (deck).

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Pinetree rig seed: `ks1`/`password123` gets 401 (owner). Pinetree sends no
  CORS headers (preflight 405) — web-direct login blocked server-side.
  Misskey :3101 / Sharkey :3102 down.
- Device runs: android debug build fixed + verified locally 2026-10-21
  (APK `app-debug.apk`, minSdk 31); install/launch on Oppo pending
  owner-side adb reconnect (stale mDNS serial) — see latest log.

## Links

- Tasks: `docs/tasks/` (p1.1–p4.6 done + p3.1-signin-functional, butterfly, p4.7-likes, p5.1-settings-tree done; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p3.11-*`, `p4.{1,2,3,4,5,6}-*`, `2026-10-20-p3.1-signin-functional.md`, `2026-10-20-butterfly-shell.md`, `2026-10-20-butterfly-feed.md`, `2026-10-20-butterfly-composer.md`, `2026-10-20-likes-popups.md`, `2026-10-20-navigation-fixes.md`, `2026-10-20-p5.1-settings-tree.md`, `2026-10-21-android-build-fix.md`, `2026-10-20-parity-sweep.md`
