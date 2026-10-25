# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **217 suites / 2967 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 0: land X0.1 (lint gaps) + X0.4 (native dirs, D1=commit both)
   + X0.2 (i18n ratchet, after X0.1).
2. Wave 1: X1.1 (vault + ADR 0011) first, then X1.2–X1.6 per the
   conflict table (`store.ts`: X1.1→X1.2→X1.5).
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
