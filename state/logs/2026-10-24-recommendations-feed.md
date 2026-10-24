# 2026-10-24 — Recommendations feed port (dvd-sharkey fork) — agent

Branch: `main` (direct, per owner request; slice-local, no plan slice).
Goal: port the Sharkey recommendations feed client-side from
`~/Local Documents/fedifedifedi/dvd-sharkey/sharkey` (plan
`~/.opencode/plan/recommendations-client-port.md`): feed + settings +
enable/disable + single Home-tab entry, endpoint detection with the tab
on by default where the server provides it.

## Did

- **Fedi (`packages/fedi`, pure TS):**
  - `core/recommendations.ts` (new): `RecFactorKey` x11, `RecEngagementKey`
    x5, breakdown rows/engagements, `RecommendationSettings`, 24 topic
    slugs, `REC_LANGUAGES`, `defaultRecLanguage`/`recLangForLocale`
    (`ja*`→ja, `zh*`/`yue*`→zh, else en), `recommendationsEnabled`
    (`!== false` defaults true), `recommendationSettingsOf` (reads
    `me.ext.me`), offset cursor codec `rec:<n>`.
  - `PostExt.recommendation` (transient breakdown; never forwarded);
    `RecommendationsApi` + `recommendations?` on `Backend` (feed/dwell/
    notInterested/interests/updateSettings/isSupported);
    `FeedDescriptor` += `"recommendations"` (parse/format round-trip).
  - `misskey/recommendations.ts` (new): wire calls with per-origin support
    cache (`like.ts` pattern — no static flavor seed; only a real 404/405
    or `UNKNOWN_API_ENDPOINT` caches absence; dwell chunked 50/call,
    failures swallowed). `misskey/backend.ts` wires the module on every
    Misskey-family flavor (Mastodon leaves it undefined). No construction-
    time probe (an early fire-and-forget broke exact-call assertions in
    `misskey-w4-rows.test.ts` — probing is lazy via the UI).
- **App:**
  - `Home.tsx`: `Home | Recommendations` tab bar (shared `Tabs`) ABOVE the
    inline composer (composer is `scrollHeader` on both tabs); tab persists
    per session (`keystone.homeTab:<id>`); active-tab re-press scrolls to
    top + reloads; `Configure recommendations` button on the rec tab opens
    the overlay; falls back to home when unavailable/disabled.
  - `RecommendationsFeed`: offset feed (`limit: 10`, `offset = items`),
    params from locale + `recommendNsfw` (`withRenotes: true` — no Keystone
    pref exists yet), pull-to-refresh, infinite scroll, honest
    not-on-this-server vs retry states, FlatList-viewability dwell hook,
    thread links via `computeFeedThreadLinks`.
  - `RecommendationsSettingsOverlay`: popup (not a route) with master
    switch, save top+bottom, language chips (min 1), followed-ratio +
    11 factor + 5 engagement steppers, NSFW switch, topic chip groups with
    one-time `i/recommendation-interests` overlay; backdrop/X/Escape with
    edits → save-or-discard confirm (save / discard / keep editing).
  - `RecommendationReasonDialog`: summary + additive table + recency
    multiplier + learned-ranker section, no API call.
  - `menuModel`: `recommendation` input prepends Why/Not-interested above
    everything else (absent elsewhere); `PostCard` supplies it from the
    OUTER wrapper's `ext.recommendation` and uses the appeared id for the
    API; not-interested toasts + removes both ids from all session caches.
    Hooks-before-early-return preserved (a `useState`-after-`isDeleted`
    placement broke `postactions.test.tsx` until moved).
- **ADR 0006** (`docs/adr/0006-recommendations-feed.md`) + index rows
  (also backfilled 0004/0005 titles).

## Decided (→ ADR 0006)

- Detection is a live probe, never a flavor label; optimistic tab + 404
  hides. Settings is an overlay, never a route. Offset paging with opaque
  `rec:<n>` cursors; `_recommendationFactors_` → `Post.ext`.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean (hardcoded
  colors → theme.palette/overlayChrome; removed eager probe).
- `pnpm test` → **196 suites / 2480 tests green** (was 193/2437: +15 fedi
  `recommendations.test.ts`, +13 app `Recommendations.test.tsx`,
  +feedDescriptor `recommendations` row; `misskey-w4-rows` fixed by
  dropping the constructor probe; `postactions` fixed by hook order).
- Deltas justified; no ported-test count regressions.
- Device/web runs: `not verified` (owner live-tests externally against the
  fork server that provides these endpoints).

## Deviations (all within the plan doc's scope)

- `Home.tsx`, `PostCard.tsx`, `menuModel.ts`, `usePostFeedQuery.ts`
  (rec params + honest 404), `keys.ts`/`index.ts` (probe/interests keys),
  `feedDescriptor.test.ts` (+1 VALID row) — required by §§1–5,8.
- New files: listed above + `src/state/queries/recommendations.ts`,
  `src/lib/recommendationDwell.ts`, `src/components/Recommendations/*`.

## Sharkey reference paths consulted (log only, never code comments)

- `packages/frontend/src/pages/explore.recommendations.vue`
- `packages/frontend/src/pages/settings/recommendations.vue`
- `packages/frontend/src/components/MkRecommendationReason.vue`
- `packages/frontend/src/utility/recommendation-reason.ts`
- `packages/frontend/src/utility/use-recommendation-dwell.ts`
- `packages/frontend/src/utility/get-note-menu.ts` (rec block)
- `packages/frontend/src/pages/timeline.vue` (rec tab)
- `packages/backend/src/server/api/endpoints/notes/recommendations.ts`,
  `.../recommendations/dwell.ts`, `.../recommendations/not-interested.ts`
- `sharkey-locales/en-US.yml` (`_recommendations`)

## Next

- Owner: live-test against the fork server (feed load/offset, dwell,
  not-interested, settings save, disabled-hides-tab); push `main`.
- Wave 3.3 user moderation (per STATE.md) — untouched by this slice.
