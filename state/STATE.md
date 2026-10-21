# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W6 Mobile platform DONE 2026-10-21 on `main`
(N21 safe-area, C2/C3 sheet + keyboard, P9 motion, P10 targets, P11
system-UI, F24 FlatList; splash plugin rides a rebuild).
Tests green (110 suites / 1270 tests); tsc ios+android+web clean; oxlint +
eslint clean. Web-visual: signed-in phone/rail/full + Note + composer
sheet as akk1 in `state/logs/assets-w6/` (Helium CDP :9222 vs expo web
:8088, persisted W5 umbrella session).
Logs: `state/logs/2026-10-21-w6-mobile.md` (W6),
`state/logs/2026-10-21-w5-screens.md`, `state/logs/2026-10-21-w4-social.md`.
Register: `docs/parity-gaps.md` W6 rows done (N22 splash-plugin deferred
to a dev-client rebuild; §9 deferred untouched).
Earlier: W5/W4/W3/W2/W1 done on `main`; repo on one `main`; v1-parity
register + closure program own the backlog; G1–G4 owner reviews open.

## Next 3 steps

1. Start **W7 Settings/appearance/i18n** (`docs/tasks/gap-closure.md`):
   P1 text scale, P2 reactive prefs, P3 theme/schema migration, P4
   transfers, C17 undo, P5 locales, P6 identity, P7/P8 hover+keyboard,
   Q9 doc carry.
2. Owner reviews stay open (G1–G4). Device: Oppo `3B15A500TQD00000`
   still unreachable; needs sign-in + write-action + keyboard/back pass.
3. Native splash (`expo-splash-screen` install + plugin + rebuild) when
   the native rig exists.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey `:3101` / Sharkey `:3102` refused; Pinetree `:3000`
  root 404 (MK14 blocked); akk1 inbox empty (notification rows with data
  not live-verified).
- iOS device run not attempted; TalkBack pass not done.
- Existing sessions predate the W5 umbrella scopes (and the W4 granular
  set): re-auth needed for suggestions + lists/bookmarks/mutes/blocks/
  filters grants (auto-upgrade rides W8/MD5).

## Links

- Gap register: `docs/parity-gaps.md` (W2–W6 rows done; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1–W6 checked, W7 next)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w6/` (signed-in phone/rail/full,
  Note thread, composer sheet)
