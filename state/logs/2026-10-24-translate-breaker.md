# 2026-10-24 — Translate 403 circuit breaker — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner-supplied census showed bursts of `translate` calls
returning **403** (mixed with 200s = per-status refusal, not auth),
plus paging into 429s on an exhausted 300-bucket. Websocket theory
dead (all-REST evidence). Delegated to a subagent; integrated by lead.

## Did (subagent)

- New `src/components/Post/translationBreaker.ts`: per-session
  in-memory `{consecutive403, blocked}`. K=2 (one 403 can be a single
  opted-out post; two in a row is a refusing endpoint). Any non-403
  completion (success as null, 429/5xx/timeout/unknown via
  `httpStatusOf`) resets the streak; once tripped, the block is sticky
  for the session (no live signal exists to unblock on — the auto path
  stops fetching). Manual translate neither checks nor records.
- `PostCard.tsx` (+18/−2): breaker check at the top of the
  auto-fetch effect; outcome recording on success/failure;
  `sessionId` added to effect deps. Render discard, manual handler,
  and all other gates byte-identical.
- Tests: 9 breaker units + 4 PostCard integration (block on 2×403,
  429s never block, per-session isolation, blocked manual still
  fetches).

## Lead review

- Verified the error shape claim (`toApiError` mirrors `.status`;
  `httpStatusOf` reads both slots) and that 401-clearing is untouched.
- No overlap with pending hover work (disjoint files).

## Tests / verification

- Targeted at handoff: breaker 9/9, post-translation 13/13,
  neighbors 102/102.
- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- Full `pnpm test` → green (tail after commit run).

## Next

- Owner: confirm translate bursts stop on mstdn.ca (filter
  devtools/console `[fedi-api]`); push `main`.
