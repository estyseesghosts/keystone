# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **217 suites / 2967 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 0 done (X0.1–X0.4 committed). Wave 1 batch 1 done: X1.1
   (vault + ADR 0011), X1.4 (cache policy), X1.6 (platform config)
   committed — **222 suites / 3113 tests** green.
2. Wave 1 batch 2: X1.2 (purge) then X1.3 (storage resilience —
   renames a key X1.2 owns), then X1.5 (401 handling).
3. Waves 2+ in order; D8=yes (build X4.5); signing/App Links skipped
   (owner); no non-English translations (English catalog only).

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
