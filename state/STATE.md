# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 1, slice P1.2 done. Next: P1.3 ALF + themes.
Branch: `main` (owner waived per-slice branches for Phase 1).
Plan: `rn-rebuild-plan.md` (proposal, 2026-10-20).
Reference: Bluesky `social-app` @ `cf16c1d` (surveyed at `1.136.0`).

## Next 3 steps

1. Owner reviews scaffold + signs plan §7 D1–D8 (esp. D3 app identity).
2. Merge `p1.1-expo-skeleton` → `main` after approval.
3. Slice 1.2 (repo rules + lint gates: `no-ui-in-fedi`, `no-wire-in-app`).

## Blockers

- Owner sign-off on §7 D1–D8 (owner); merge blocked until approved.
- `pnpm android` / `pnpm ios` device runs not yet attempted.

## Links

- Tasks: `docs/tasks/p1.1-expo-skeleton.md` (done, 2 manual checks open)
- ADRs: `docs/adr/README.md` (template only; none needed for P1.1)
- Logs: `state/logs/2026-10-20-p1.1-scaffold.md` (trio green + web export)
