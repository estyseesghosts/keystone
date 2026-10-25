# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **267 suites / 3814 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Wave 6 done (X6.1–X6.5 committed; X6.2 step 6 attemptKey
   blocked → tracked follow-up). (Coordinator fallout: missing
   import, plural two-arg, TTL fixtures, ol-node pin, mount-fetch
   wait, literal-label msg routing.)
2. Wave 7 batch 1: X7.1 (lightbox) + X7.2 (players) in parallel
   (file-disjoint); then X7.3+X7.4 in parallel.
3. Wave 8 next; signing/App Links skipped (owner); no
   non-English translations (English catalog only).

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
