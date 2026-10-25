# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **231 suites / 3301 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Waves 0–1 done. Wave 2 batch 1 done: X2.1 (crypto seam +
   polyfill) + X2.4 (outbound URL policy) committed.
   (Coordinator fallout in those commits: random.ts lint-seam entry,
   db8 byte fix, un-awaited stream-cleanup fix.)
2. Wave 2 batch 2 done: X2.2 (transport) + X2.3 (auth/links +
   ADR 0012) + X2.5 (privacy) committed — **243 suites / 3397 tests**
   green. (Coordinator: PrivacySection mounted in Display screen;
   X2.2/X2.3 follow-ups sent back to slice agents and landed.)
3. Wave 3 (X3.1–X3.5) in conflict-table order next.

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
