# 2026-10-29 — feed gap-fill jump, round 2 (ranked-feed reroll) — agent

Branch: `fix/feed-gapfill-jump` (same branch, continued)
Goal: kill the hands-off blink + reposition the owner saw on the recommendations feed after the round-1 fix.

What the owner saw:

- Recommendations feed open, no input at all — the list "blinked" and
  landed at a totally different position.

Why (second mechanism — round 1 did not cover it):

- `RecommendationsFeed` mounts no live channel and no scroll handler, so
  nothing scroll-driven is involved. But its query key
  (`[session, 'post-feed', 'recommendations|[...]']`) matches every
  background invalidator: gap-fill (`watchStreamGapFill` on any socket
  reconnect — silent, needs no input) and the foreground refetch.
- Sharkey's `notes/recommendations` re-scores on every request
  (`packages/fedi/src/misskey/recommendations.ts`: offset paging, no
  stability token; the app never sends `refresh`). A background refetch
  is therefore a REROLL, not a refresh: all rows remount (blurhash
  cross-fades = the "blink") and the saved pixel offset lands on
  different posts (the "totally different position").
- Round 1 kept the invalidate for active queries (correct for timelines,
  whose cursor windows re-read stably) — which preserved exactly this
  reroll on the rec feed. Ruled out: dwell timer (POST-only, no cache
  touch), settings/key change (`recSuffix` JSON is value-stable across
  `me` refetches), composer inserts (user-initiated, home/profile only).

Did:

- `src/state/queries/keys.ts` — new pure `isRecommendationsFeedKey(key)`:
  `post-feed` kind + descriptor `recommendations` with/without the
  `|rec-params` suffix. Rejects `search|recommendations`,
  `tag|recommendations`, probe/interest keys, malformed keys (pinned).
- `src/state/streaming.ts` — `gapFillSessionFirstPages` skips rec keys
  entirely (no trim, no invalidate); the trailing prefix invalidate
  carries a `predicate` so it stays clear too. Comment cites ADR-0015.
  No live channel exists for this feed, so skipping loses nothing —
  explicit refresh / fresh mount owns rerolls.
- `src/state/queries/lifecycle.ts` — `isForegroundRefetchKey` returns
  false for rec keys: returning to the tab must not reroll the list.
- Tests: `keys.test.ts` (+2: match shapes, reject lookalikes);
  `lifecycle.test.tsx` (+1: rec excluded); `streaming-lifecycle.test.ts`
  (+1: gap-fill leaves rec pages intact AND uninvalidated while home
  still fills).
- ADR 0015 amendment section + `docs/DECISIONS.md` line; task file steps
  5–7 updated.

Decided (→ ADR 0015 amendment):

- Ranked feeds never background-refetch, both paths, one predicate.
  Timelines untouched.

Tests / verification (paste commands + results):

- `NODE_ENV=test npx jest src/state/streaming-lifecycle.test.ts src/state/queries/keys.test.ts src/state/queries/lifecycle.test.tsx --forceExit --silent --maxWorkers=2` → 3 suites, 45/45 pass.
- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` → clean, no output.
- `pnpm test` (full) → not run this session; must confirm flat at pre-existing 90 before merge.
- Web/device runs → `not verified` (owner: sit on rec feed through a reconnect; deep-scroll + socket-kill on Home).

Deviations (files touched outside the slice + why):

- `src/state/queries/keys.ts` + `lifecycle.ts` (beyond the streaming-only
  round-1 scope): the same background-refetch rule has two call sites;
  fixing one leaves the tab-return reroll. Recorded as the amendment.

Next:

- Owner round-2 verification (task step 6).
- Full `pnpm test`, then merge decision stays with owner.
- Remaining follow-ups (unchanged): web scroll anchoring, Mastodon
  `meta.original` dimensions, gap-fill debounce.
