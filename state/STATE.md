# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **278 suites / 3987 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 8 batch 1 done (X8.1–X8.3 committed green; 278 suites / 3987 tests;
   coord remainder: streaming live-prepend cancels; Note/Toast/test-typing
   fallout fixed in-batch — see coord log).
2. X8.4 (hooks cleanup + exhaustive-deps → error) alone next — touches
   every warning file, runs after batch-1 lands.
3. Then Wave 9 i18n; signing/App Links skipped (owner); no non-English
   translations (English catalog only).

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
