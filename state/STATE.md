# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 2 IN PROGRESS (2.1–2.4 done on `main`; 2.5 sessions/storage + 2.6 smoke queued).
Gate G1: owner review of the shell on a phone + desktop browser (still open).
Branch: `main`.
Plan: `rn-rebuild-plan.md` (proposal, 2026-10-20).
Reference: Bluesky `social-app` @ `cf16c1d` (patterns only, ADR-0001).

## Next 3 steps

1. Phase 2 slice 2.5: sessions + storage seam (`src/storage/`, `src/state/session/`, `expo-secure-store`, api facade + `client-routing`).
2. Phase 2 slice 2.6: contract smoke (`scripts/fedi-smoke.ts`); then Gate G2 owner review.

## Blockers

- Owner G1 review + §7 sign-off (owner, esp. D3 app identity).
- Device runs (`android`/`ios`) never attempted — no harness yet.

## Links

- Tasks: `docs/tasks/` (p1.1–p1.5 done)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p1.5-shell.md` (trio green + web export)
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
