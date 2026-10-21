# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: V2_FUNCTIONAL nearly closed 2026-10-21 — E1–E5 + E8–E10
MERGED on `main` (trio 145/1727 green; Helium + Akkoma `:4000` proofs in
`state/logs/2026-10-21-pf-{links,drive,unfurl,emoji,bio,detail,navigate}.md`).
OPEN: E6 translation (owner's live Misskey provides it — origin + auth
needed; stale "no server" commit held off main) and E7 live round-trip
(page reachable since E7-nav; needs a live Misskey host).
FULL suite green: 141 suites / 1665 tests; tsc ios+android+web
clean; eslint + oxlint clean.
Latest logs: `state/logs/2026-10-21-ws{A,B,C,D,E,F,G}-*.md` (agents;
Helium/live evidence in `assets-ws{A,B,D,F}/`, Akkoma probes for
C/F/G with writes cleaned). Coordinator re-verified the trio on
`main` after every merge (B needed conflict resolution: duplicate
`quoteStatus` dropped, locale union re-extracted).
Register: `docs/parity-gaps.md` V2 rows closed (S4, F5/F6/F7, F10,
F11, F14, MK6/MK8/MK13/MK14/MK16/MK17, MD1/MD3(+notes)/MD4/MD10,
N14/N18, F20/F21 notes, C16 note); `docs/V2_GAPS.md` all WS boxes
ticked; `docs/DECISIONS.md` +23 lines this program.
Earlier: contrast sweep + UI batch 2 + W1–W8 done on `main`
(see logs); G1–G4 reviews open.

## Next 3 steps

1. All `pf-*` workstreams complete and merged; lanes free. `pf-bio` E6
   commit (3052f59) deliberately HELD OFF main (stale premise).
2. To close E6 + E7-live: owner's live Misskey origin + auth (probe writes
   OK? with cleanup).
3. Owner reviews stay open (G1–G4 visual/parity); Oppo `3B15A500TQD00000`
   device pass still never attempted.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey `:3101` / Sharkey `:3102` refused; Pinetree `:3000`
  root 404 (authed-Pinetree probes blocked); akk1 inbox empty.
- iOS device run not attempted; TalkBack pass not done.
- Old sessions predate W5 umbrella scopes: `scopeHealth` now surfaces
  `needsUpgrade` — re-auth still the only upgrade path.

## Links

- Gap register: `docs/parity-gaps.md` (V2 rows closed; §9 deferred untouched)
- Build list: `docs/V2_GAPS.md` (COMPLETE — all WS-A…WS-G ticked)
- Active handoff: `docs/V2_FUNCTIONAL.md` (E1–E5 + E8–E10 done; E6/E7 open)
- Gap program: `docs/tasks/gap-closure.md` (W1–W8 COMPLETE)
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w8/` (akk1 home phone + rail)
