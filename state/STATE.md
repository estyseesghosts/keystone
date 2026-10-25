# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **258 suites / 3597 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 4 in progress: X4.1–X4.4 committed (X4.4 step 7 revocation
   blocked → tracked follow-up). (Coordinator fallout in those
   commits: async stub, poll-meta regex, dual-class auth check,
   markers-first order pins, sensitivity contract, db8 bytes,
   un-awaited cleanup, evidence casts, socket token, mock-hoist
   cast, FormData assertion.)
2. Wave 4 last: X4.5 notification requests/policy (D8=yes).
3. Wave 5 (X5.1–X5.6, misskey backend in order) next.

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
