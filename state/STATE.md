# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W5 Screens & routing DONE 2026-10-21 on `main`
(N3–N17, N22, F19-corrected, F20-in-clips done; F20 live-capture rides S4).
Tests green (106 suites / 1251 tests); tsc ios+android+web clean; oxlint +
eslint clean. Web-visual: signed-in phone/rail/full as akk1 in
`state/logs/assets-w5/` (Helium CDP :9222 vs expo web :8088, fresh
umbrella-scoped token). Authed rig probe `scripts/fedi-w5-probe.ts` green
on Akkoma `:4000` (search/suggest/followers/bookmarks live; trends 404 →
honest unavailable). Rig left clean (bookmark removed).
Logs: `state/logs/2026-10-21-w5-screens.md` (W5),
`state/logs/2026-10-21-w4-social.md`, `state/logs/2026-10-21-w3-composer.md`.
Register: `docs/parity-gaps.md` W5 rows done (N19 planned, §9 deferred
untouched); F20 partial (live capture rides S4).
Earlier: W4/W3/W2/W1 done on `main`; repo on one `main`; v1-parity register +
closure program own the backlog; G1–G4 owner reviews open.

## Next 3 steps

1. Start **W6 Mobile platform** (`docs/tasks/gap-closure.md`): N21
   safe-area, composer sheet + keyboard (C2/C3 remainder), P9 reduced
   motion, P10 touch targets, P11 status-bar/system-UI (+ splash plugin).
2. Then W7 Settings/appearance/i18n (P1 text scale, P5 locales, Q9 specs).
3. Owner reviews stay open (G1–G4). Device: Oppo `3B15A500TQD00000`
   still unreachable; needs sign-in + write-action + keyboard/back pass.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey `:3101` / Sharkey `:3102` refused (Misskey-family clips/
  antennas/drive live unverified); Pinetree `:3000` root 404 today
  (MK14 blocked); akk1 inbox empty (notification rows with data not
  live-verified).
- iOS device run not attempted.
- Existing sessions predate the W5 umbrella scopes (and the W4 granular
  set): re-auth needed for suggestions + lists/bookmarks/mutes/blocks/
  filters grants (auto-upgrade rides W8/MD5).

## Links

- Gap register: `docs/parity-gaps.md` (W2–W5 rows done; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1–W5 checked, W6 next)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w5/` (signed-in phone/rail/full)
