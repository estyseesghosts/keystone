# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W7 Settings/appearance/i18n DONE 2026-10-21 on `main`
(P1 scale, P2 reactive prefs, P3 schema v2 + content-mode, P4 deferred
reaffirmed, C17 undo, P5 8 locales + 527-message macro pass, P6 identity,
P7 hover card, P8 web keyboard, Q9 doc carry).
Tests green (117+ suites / 1316 tests); tsc ios+android+web clean;
oxlint + eslint clean. Web-visual: en→fr switch proven live as akk1 in
`state/logs/assets-w7/` (Helium CDP :9222 vs expo web :8088).
Logs: `state/logs/2026-10-21-w7-settings.md` (W7),
`state/logs/2026-10-21-w6-mobile.md`.
Register: `docs/parity-gaps.md` W7 rows done (P4 deferred, P5 tail
logged; §9 deferred untouched).
Earlier: W6/W5/W4/W3/W2/W1 done on `main`; repo on one `main`;
v1-parity register + closure program own the backlog; G1–G4 reviews open.

## Next 3 steps

1. Start **W8 Data correctness & docs** (`docs/tasks/gap-closure.md`):
   MD5 boot re-verify, MD6–MD9, MD10/S4 streaming, MD11–MD14, MK7,
   MK10–MK12, F21 polish, Q1–Q8.
2. P5 tail (management-screen English, W7 log inventory) can ride any
   session — mechanical, no new deps.
3. Owner reviews stay open (G1–G4). Device: Oppo `3B15A500TQD00000`
   still unreachable; hover needs a real-pointer pass; iOS not attempted.

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

- Gap register: `docs/parity-gaps.md` (W2–W7 rows done; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1–W7 checked, W8 next)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w7/` (en home, fr home, language
  switch, hover attempt)
