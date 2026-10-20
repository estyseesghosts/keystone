# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 2 DONE (slices 2.1–2.6 on `main`). Gate G2: owner
review (all ported tests green + smoke table) before Phase 3.
Gate G1 (shell review) still open alongside.
Branch: `main`.
Plan: `rn-rebuild-plan.md` (proposal, 2026-10-20).
Reference: Bluesky `social-app` @ `cf16c1d` (patterns only, ADR-0001).

## Next 3 steps

1. Owner G2 review: ported tests (35 suites / 553 green) + smoke table
   (Pinetree :3000 ok, Akkoma :4000 ok, :3101/:3102 not verified).
2. Owner G1 review (shell on phone + desktop browser) + §7 D1–D8 sign-off.
3. Phase 3 kickoff only after STATE.md says G2 passed (plan gate).

## Blockers

- Owner G1 review + §7 sign-off (owner, esp. D3 app identity).
- Owner G2 review: Phase 3 blocked until G2 passes (owner).
- Device runs (`android`/`ios`) never attempted — no harness yet.

## Links

- Tasks: `docs/tasks/` (p1.1–p1.5 + p2.1–p2.6 done)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p2.6-smoke.md` (trio green + smoke tables)
