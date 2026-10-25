# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **263 suites / 3665 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 5 in progress: X5.1–X5.3 committed. (Coordinator fallout:
   dead-code placement move + brace repair, test-locator and
   contract updates for the new paging/end rules.)
2. Wave 5 batch 2: X5.4 (caps/edit) + X5.5 (auth/quote/fields) in
   parallel (file-disjoint).
3. X5.6 capture script last (no duplicate coverage); then Wave 6.

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
