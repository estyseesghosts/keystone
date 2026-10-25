# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **275 suites / 3944 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 7 done (X7.1–X7.4 committed green; 275 suites / 3944 tests;
   batch-2 fallout: explicit-cancel signal, FormData ref spies, expo-image
   sourced-match discipline, querySignal section headers — see coord log).
2. Wave 8: X8.1 (boundaries/logger) + X8.2 (screens) + X8.3 (cache) + X8.4
   (hooks) in file-disjoint parallel batches.
3. Signing/App Links skipped (owner); no non-English translations
   (English catalog only).

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
