# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **281 suites / 4015 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 9 batch 1 done (X9.1–X9.4 committed green; 281 suites / 4015 tests;
   baseline 620 → 0; coord: useI18n fallback hook + fr-test locale params —
   see coord log).
2. Wave 9 remainder SEQUENTIALLY (each tree-wide): X9.5 formatters, then
   X9.6 RTL, then X9.7 error codes, then X9.8 close-out.
3. Signing/App Links skipped (owner); no non-English translations.

Blockers / owner-open:
- Rig `:3101`/`:3102` refused; device not run by agents — all live
  checks `not verified (owner live-tests externally)`, collected in X12.1.
- D1 answered (commit both); D2–D10 defaults apply unless owner says otherwise.

Links:
- Plan: `docs/audit_20261025/repair.md` (status lines flipped per commit)
- Report: `docs/audit_20261025/report.md`; results: `docs/audit_20261025/results/`
- Latest logs: `state/logs/2026-10-25-repair25-*`
- ADRs: `docs/adr/` (next free: 0011); decisions: `docs/DECISIONS.md`

Parked work: P6 Wave 3.3 user moderation (old pointer; not in this
program — do not start from here).
