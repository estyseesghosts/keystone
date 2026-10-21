# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W8 Data correctness & docs DONE 2026-10-21 on `main`
(MD5 boot re-verify + scope-health, MD6–MD9 live Akkoma round-trips,
MD10 pooled streaming + app capture, MD11 fork collapse, MD12/MD13
taxonomy + authority, MK7 boot migration, MK10 fixtures/manifest, MK11
smoke auth/stream, MK12 55 tests, Q1–Q8 + Q6 PostRow delete, 52nd error
code + catalog recompile).
Tests green (119 suites / 1425 tests); tsc ios+android+web clean;
oxlint + eslint clean. Web-visual: signed-in akk1 home phone/rail in
`state/logs/assets-w8/`. Authed probe `scripts/fedi-w8-probe.ts` 7/7
live-green (writes cleaned).
Logs: `state/logs/2026-10-21-w8-data.md` (W8),
`state/logs/2026-10-21-w7-settings.md` (W7).
Register: `docs/parity-gaps.md` all W8 rows done; program COMPLETE
(`docs/tasks/gap-closure.md` W1–W8 checked + acceptance).
Earlier: W7/W6/W5/W4/W3/W2/W1 done on `main`; repo on one `main`;
G1–G4 reviews open.

## Next 3 steps

1. Owner reviews stay open (G1–G4); P5 tail (management-screen
   English, W7-log inventory) can ride any session — mechanical.
2. Still blocked: Oppo `3B15A500TQD00000` pass, iOS anything,
   Misskey-family live probes (rig `:3101`/`:3102` down), live GTS,
   hover real-pointer, native splash rebuild, TalkBack.
3. S4 owns streaming UI (status badge, live pill insert, notification
   channel); full drafts-module deletion needs `src/` edits (planned).

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey `:3101` / Sharkey `:3102` refused; Pinetree `:3000`
  root 404 (authed-Pinetree probes blocked); akk1 inbox empty.
- iOS device run not attempted; TalkBack pass not done.
- Old sessions predate W5 umbrella scopes: `scopeHealth` now surfaces
  `needsUpgrade` — re-auth still the only upgrade path.

## Links

- Gap register: `docs/parity-gaps.md` (W8 rows done; §9 deferred untouched)
- Gap program: `docs/tasks/gap-closure.md` (COMPLETE)
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w8/` (akk1 home phone + rail)
