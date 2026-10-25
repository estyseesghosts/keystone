# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25** (`docs/audit_20261025/repair.md`,
59 slices, Waves 0–12). Prior programs closed; old changelog archived in
`state/logs/2026-10-25-repair25-x0.3.md`.
Active branch: `main` (agents work in the shared tree; coordinator
commits per green slice — no slice branches, per owner order).
Gate baseline (last green on main): **254 suites / 3520 tests**,
typecheck (ios+android+web) + lint clean.

Next 3 steps:
1. Waves 0–3 done (X3.2 + X3.4 committed). (Coordinator fallout in
   those commits: netinfo jest mock, budget seeding at wiring,
   evidence casts, pooled socket token, mock-hoist cast, debug-mark
   cleanup.)
2. Wave 4 (X4.1–X4.5): mastodon backend chain — X4.1, then X4.2,
   X4.3, X4.4 sequentially (shared files), X4.5 per D8=yes after X4.1.
3. Waves 5+ in order; signing/App Links skipped (owner); no
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
