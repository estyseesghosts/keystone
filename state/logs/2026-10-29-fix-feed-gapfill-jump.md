# 2026-10-29 — feed gap-fill jump repair — agent

Branch: `fix/feed-gapfill-jump` (cut from `polish/8-media-caps` dirty tree)
Goal: stop reconnect gap-fill from collapsing the scrolled feed (soft-reload + fade + jump on web/Misskey-Sharkey).

Did:

- `src/state/streaming.ts` — `gapFillSessionFirstPages(client, sessionId, opts?)`:
  reads the cache active set once (`findAll({queryKey: [sessionId], type: 'active'})`,
  fail-open toward keep-pages) and skips trimming any mounted query's
  `pages`/`pageParams`; invalidates still run for all, so active lists
  refetch all pages in place and inactive ones refetch one page on next
  mount. `GapFillOpts.isActiveKey` seam for tests.
- `src/state/streaming.ts` — `watchStreamGapFill`: was-away flag replaces
  the single `reconnecting -> connected` match. Any observed
  `connected -> non-connected` arms; the return to `connected` fills.
  Fresh mounts never fill (flag starts false); Misskey error-path and
  Mastodon stopped-path redials now fill (audit 2026-10-26 M2, second half).
- `src/state/streaming-lifecycle.test.ts` — 4 new tests (active keeps
  pages + invalidates; default path trims unmounted; outage-after-connected
  fills; error→connecting→connected fills; fresh-mount connect never
  fills); header comment updated.
- `docs/adr/0015-gapfill-keeps-mounted-pages.md` (accepted) + README row +
  `docs/DECISIONS.md` line + task `docs/tasks/fix-feed-gapfill-jump.md`.

Decided (→ ADR 0015):

- Invalidate-active / trim-inactive over the alternatives; N-request
  reconnect refetch accepted (reconnects infrequent). No debounce yet.
- Single gap-fill wiring stays (NotificationsBadgeHost); not duplicated
  into `useFeedLive` — the host already covers every screen.
- Out of scope (recorded): anchor-based scroll restore for web,
  Mastodon `meta.original` dimensions, gap-fill debounce.

Tests / verification (paste commands + results):

- `NODE_ENV=test npx jest src/state/streaming-lifecycle.test.ts --forceExit --silent --maxWorkers=2` → 25/25 pass.
- `NODE_ENV=test npx jest src/state/streaming.test.ts src/state/queries/usePagedLoad.test.tsx src/screens/HomeFeed.test.tsx src/screens/HomeFeed.live.test.tsx --forceExit --silent --maxWorkers=2` → 59/59 pass.
- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` → clean, no output.
- `pnpm test` (full) → not run this session (first jest invocation hung on watchman crawl; targeted suites green). Must run before merge — task step 6.
- Web/device runs → `not verified` (owner repro: page deep, kill socket ~3 s, confirm no collapse).

Deviations (files touched outside the slice + why):

- None beyond the slice: `src/state/streaming.ts` + its test, ADR/task/log/STATE/README/DECISIONS docs only. Branch carries the unmerged `polish/*` dirty tree underneath — untouched.

Next:

- Owner runs the web repro check (task step 5).
- Run full `pnpm test`, confirm flat at pre-existing 90, then merge decision stays with owner.
