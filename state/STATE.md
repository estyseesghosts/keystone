# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: **P6 Wave 3.2 + mobile bring-up MERGED on `main`
(2026-10-22)** — one repo (`~/keystone2`); reports queue + device
bundling/signing/iOS-OAuth all on main. Next: 3.3 user moderation,
then 3.4 federation+emoji (sequential — shared Backend
interface/admin modules rule out true file-disjoint parallelism).
Program source of truth: `docs/clickstone.md` +
`docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`. The old V2
E6/E7 program is closed; do not reopen it from `docs/parity-gaps.md`.

## What landed (27 slices merged; Wave 0+1+2 closed earlier)

Wave 0 correctness + Wave 1 daily-driver: see prior revision (22 slices).
Wave 2: 2.1 Mastodon conversations/DM inbox (`ConversationsApi`,
`write:conversations` → `SCOPES_NOW`, inbox+thread screens;
`direct_messages` on mastodon+akkoma), 2.3 transfer UI (ADR 0004
`expo-document-picker`, 5 Misskey families real, 12 Mastodon rows
honest-disabled), 2.2 Misskey chat (`ChatApi`, rooms+stream, Misskey
`direct_messages` flipped). Login fixes: `read:conversations` dropped
(not a real Mastodon scope — 422); per-flavor scopes (ADR 0005,
Mastodon triple `read write follow` — logged-in authorize 502'd over
~512-char URLs, verified live 200 after fix).

Verification on `main`: **187 suites / 2368 tests green**;
`typecheck` (ios+android+web) + `lint` clean. Per-slice logs:
`state/logs/2026-10-22-p6.*.md`; task index `docs/tasks/README.md`.
Wave 3.1: admin seam + read-only insight both families.
Wave 3.2: `ReportsQueueApi` + `AdminReports` screen (confirm-gated
mutations, 403 disables, no faked history).
Mobile bring-up (merged from `mobile-bringup`): worklets `bundleMode`
off + Watchman on (Metro bundling), expo/gesture-handler SDK 57
alignment, debug keystore + AppleWWDRCAG3 (signing), scene manifest +
`withSceneLifecycle`/`withAppleTeamId` plugins (iOS 27), native hosting
fail-closed prober (iOS white-screen fix), iOS-inline OAuth completion
(live-verified iPhone Mastodon sign-in). Log:
`state/logs/2026-10-22-mobile-bringup.md`.

## Next 3 steps

0. P6.4 sidebar reshuffle (branch `p6.4-sidebar-reshuffle`, pre-Wave-3):
   code + tests green (187/2368), pending owner desktop-large visual
   pass, then merge to `main`. Task `docs/tasks/p6.4-sidebar-reshuffle.md`.
1. Wave 3.3: user moderation (Misskey show-users/suspend/unsuspend/
   user-note/modlog/reset-password; Mastodon account_actions
   warn/suspend/silence + notes; NO delete-account). Single agent,
   working in `~/keystone2` (this repo — the only checkout).
2. Wave 3.4 federation+emoji after 3.3, then 3.5 announce/invite/roles.
   Wave 4 out of scope.
3. End of program: intl extract/compile + deferred locale sweep
   (fr+7 catalogs, `errors.unsupported.avatar` cleanup).

## Blockers / debts

- Rig Misskey `:3101` / Sharkey `:3102` refused; owner live-tests
  externally — do not spend a workstream on a rig. All live runs
  `not verified (owner live-tests externally)`.
- Device pass DONE 2026-10-22 (Oppo feed live, iPhone sign-in + Mastodon
  login live; log `state/logs/2026-10-22-mobile-bringup.md`). iPhone is on
  the second Apple ID's free provisioning (rebuild after 7-day expiry;
  first team still at Apple's 3-device cap). No TalkBack pass.
- Owner G1–G4 visual/parity reviews still open.
- `fr`+7 catalogs still have untranslated management-screen tail; new
  Wave 0/1/2 strings English-only until the planned i18n sweep.
- `errors.unsupported.avatar` text is now false (avatar upload ships);
  remove/repurpose it in the i18n sweep.

## Links

- Program brief: `docs/clickstone.md`
- Audit: `docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`
- Tasks: `docs/tasks/README.md` (p6.0.* / p6.1.* / p6.2-conv+transfer done)
- ADRs: `docs/adr/0003-oauth-scopes-now-vs-later.md`, `0004-document-picker.md`
- Decisions: `docs/DECISIONS.md` (2026-10-22 P6 lines)
- Register: `docs/parity-gaps.md` (stale rows corrected 2026-10-22)
