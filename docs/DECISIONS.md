# DECISIONS.md

One line per decision: date + what + one-line reason. Full context lives
in `adr/` when load-bearing.

| Date | Decision | Reason |
|------|----------|--------|
| 2026-10-20 | Repo initialized (`main`), long-horizon state protocol adopted (`AGENTS.md` §2, `state/`, `docs/tasks/`, `docs/adr/`) | Sessions have no shared memory; state on disk is the only continuity |
| 2026-10-20 | `rn-rebuild-plan.md` accepted as plan source of truth; Bluesky `cf16c1d` pinned as reference | Awaiting owner sign-off on plan §7 D1–D8 (Phase 0 gate) |
