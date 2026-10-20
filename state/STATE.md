# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: Phase 3 COMPLETE (slices 3.1–3.10 on `main`, 5 commits).
Gate G3: owner review (read-only parity tick open — no end-to-end cell
green yet; device runs not verified). Gate G2 still pending alongside.
Branch: `main`.
Plan: `rn-rebuild-plan.md` (proposal, 2026-10-20).
Reference: Bluesky `social-app` @ `cf16c1d` (patterns only, ADR-0001).

## Next 3 steps

1. Owner G3 review: read path on phone + desktop browser vs rig
   (Pinetree :3000, Akkoma :4000 live; :3101/:3102 down, not verified).
2. Owner G1/G2 reviews still open; §7 D1–D8 sign-off (esp. D3 identity).
3. Unify `HomeFeed` stub onto canonical `usePostFeedQuery` + one key
   shape (`feedQueryKey` vs `postFeedQueryKey`); then Phase 4 kickoff
   only after STATE.md says G3 passed.

## Blockers

- Owner G1 + G2 + G3 reviews (owner).
- Pinetree rig seed: documented `ks1`/`password123` gets 401 (owner).
- Device runs (`android`/`ios`) never attempted — no harness yet.

## Links

- Tasks: `docs/tasks/` (p1.1–p3.10 done; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`
- Logs: `state/logs/2026-10-20-p3.{1,2,3.3,4,8}-*.md` (trio green:
  typecheck + lint clean, 48 suites / 724 tests)
