# Feed gap-fill scroll jump

Plan ref: ADR `docs/adr/0015-gapfill-keeps-mounted-pages.md`
Status: done, merged (`main` as `6f49197`; owner repros open)
Branch: `main` (was `fix/feed-gapfill-jump`, pruned 2026-10-30)

## Goal

A live-socket reconnect while scrolled must not collapse the visible feed (soft-reload + fade + jump). One sentence: gap-fill invalidates, never rewrites, a mounted list.

## Read first

- `src/state/streaming.ts` (`gapFillSessionFirstPages`, `watchStreamGapFill`)
- `src/state/streaming-lifecycle.test.ts` (gap-fill + trigger suites)
- `docs/audit_20261026/results/networking.md` §M2 (half-wired gap-fill)

## Steps

- [x] 1. `gapFillSessionFirstPages`: trim inactive queries only; active (mounted) queries keep pages, still invalidate. `GapFillOpts.isActiveKey` seam; default reads `findAll({type: 'active'})`, fail-open toward keep-pages.
- [x] 2. `watchStreamGapFill`: was-away flag replaces the single `reconnecting -> connected` match, so error/stopped redial paths fill too; fresh mounts never fill.
- [x] 3. Tests: active query keeps pages + invalidates; default path trims when unmounted; outage-after-connected fills; error-path sequence fills; fresh-mount connect never fills.
- [x] 4. ADR 0015 + DECISIONS line.
- [x] 5. Ranked-feed amendment (same branch): `isRecommendationsFeedKey`
  exempts the rec feed from gap-fill (no trim, no invalidate) and from the
  foreground refetch — Sharkey re-scores every request, so a background
  fill is a reroll + jump, not a refresh. Owner saw hands-off blink +
  reposition on the rec feed after steps 1–4.
- [x] 6. Owner verification on web (Misskey/Sharkey): page deep, kill socket ~3 s, confirm no collapse/jump; sit on rec feed through a reconnect, confirm no hands-off blink. → owner-open (not verified)
- [x] 7. Gate: `pnpm typecheck && pnpm lint` clean (both rounds); targeted suites green; full `pnpm test` flat at pre-existing 90 (verified pre-merge 2026-10-30: 303 suites / 4260 tests, 4170 pass, 90 fail — the known set).

## Acceptance

- [x] Reconnect cannot rewrite a mounted feed's `pages` (unit-pinned)
- [x] `pnpm typecheck` (ios+android+web) + `pnpm lint` clean
- [x] Targeted suites green — round 1 (streaming-lifecycle 25, streaming + usePagedLoad + HomeFeed + HomeFeed.live 59); round 2 (streaming-lifecycle + keys + lifecycle 45)
- [ ] Full `pnpm test`: no NEW failures vs 90 pre-existing → verified pre-merge (303/4260, 90 fail = known set)
- [ ] Owner repro checks on web pass (step 6) → owner-open

## Out of scope

- Anchor-based scroll restore for web; `meta.original` dimensions for Mastodon media; gap-fill debounce. All recorded as ADR 0015 follow-ups.

## Log

- `state/logs/2026-10-29-fix-feed-gapfill-jump.md`
