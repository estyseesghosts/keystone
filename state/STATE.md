# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 4 COMPLETE in code on `main` (4.1–4.6 + integration).
Butterfly composer + popups + motion verified on `p3.1-signin-functional`:
compact composer (inline + modal), anchored popups (audience/more/emoji/
note/boost/profile menus), instant motion — trio green (63 suites /
845 tests); Helium-proven in the live session + K1vK2 screenshots.
Shell entry points merged into same branch.
Gate G4: owner review — write actions NOT verified live on the rig, none on
device/web. Optimistic Jest tests green.
Gate G3: owner override recorded 2026-10-20 (see DECISIONS); parity tick open.
Branch: `p3.1-signin-functional`.
Plan: `rn-rebuild-plan.md`. Reference: Bluesky `social-app` @ `cf16c1d` (ADR-0001).

## Next 3 steps

1. Owner: merge-review `p3.1-signin-functional` (sign-in + butterfly shell
   + post cards + composer overlay), then device runs — sign in on
   `pnpm web` (both families: MiAuth approve, OAuth redirect) and on
   `pnpm ios` / `pnpm android` (dev-client rebuild needed for image-picker +
   clipboard + svg) incl. `keystone:` deep link + MFA. Exercise
   like/react/boost/bookmark/delete, composer (reply/quote/poll/media),
   follow/mute/block against Pinetree :3000 and Akkoma :4000.
2. Butterfly feed chrome slice: separators, thread connectors, empty/
   loading/error states, skeletons, "N new posts" pill decision, grammar
   ("1 boosts"), safe-area insets, mid-width centering check. Then popups,
   composer chrome, notifications, explore, settings pages.
3. Close known gaps: composer edit mode; boosts-only mute; scheduling backend
   for Mastodon; Misskey bookmark capability detection; Misskey `users/lists/*`
   endpoint names (and `lists/list`) check; Clip/Report UI.
3. Owner G1/G2 reviews and §7 D1–D8 sign-off still open; then Phase 5 (deck).

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Pinetree rig seed: `ks1`/`password123` gets 401 (owner). Pinetree sends no
  CORS headers (preflight 405) — web-direct login blocked server-side.
  Misskey :3101 / Sharkey :3102 down.
- Device runs never attempted — not verified.

## Links

- Tasks: `docs/tasks/` (p1.1–p4.6 done + p3.1-signin-functional in progress; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p3.11-*`, `p4.{1,2,3,4,5,6}-*`, `2026-10-20-p3.1-signin-functional.md`, `2026-10-20-butterfly-shell.md`, `2026-10-20-butterfly-feed.md`, `2026-10-20-butterfly-composer.md`
