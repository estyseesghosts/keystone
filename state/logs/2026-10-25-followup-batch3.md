# 2026-10-25 — followup-batch3 — coordinator

Branch: `main`
Goal: Land repair follow-up Batch 3 (screens/minors: D3.7 leftovers, avatar URL gates, softMute cap).

Did:

- (i-1) `usePasswordSignin` extraction with grouped params: new `src/screens/PasswordSignin.ts` (`completePasswordSignin(req: PasswordSigninRequest)` union bag + `completeMfaSignin`; plain functions, not a hook — a hook would recapture component state and defeat the grouping). All 5 `Login.tsx` submits are thin bag-building wrappers; busy/error/MFA mapping untouched. `AuthCallback.tsx` needed no change (zero password call sites — OAuth/MiAuth only).
- (i-2) `SectionShell` Back: WON'T-DO with evidence. `Settings.tsx` renders index vs section from the route param on a single `Stack.Screen name="Settings"` — index→section is a same-route param update, so no second Settings route ever exists to pop; `goBack()` would skip the index to Main, contradicting the pinned `Settings.test.tsx` "deep-linked sections render directly with a working Back" (expects `navigate('Settings', {})`). File untouched.
- (i-3) Deleted `src/screens/AdminReports.tsx` shim: `Navigation.tsx` + `AdminReports.test.tsx` import direct from `AdminReportDetail` / `AdminReportsList`; stale shim pointer trimmed in `AdminReportsList.tsx` header; grep confirms zero remaining shim importers.
- (i-4) Dropped the `Navigation.tsx` feedMemory re-export block (7 fns + `FeedTabKey`, which had no `#/Navigation` importers): `shell-chrome.test.tsx` imports feedMemory symbols from `#/state/feedMemory` (the real module); `notifications-badge.test.tsx` needed no change (only uses `NotificationsUnreadBadge`, still re-exported).
- (j) Avatar/banner URL gates at the ADAPTER layer (broader than the three named sites, same R2.4 pattern): `misskey/adapt.ts` + `mastodon/adapt.ts` `adaptAccount` gate `avatarUrl`/`headerUrl` via `safeHttpUrl`; `mastodon/endpoints.ts` `fetchTrendingLinks` gates `image`. Covers ExploreAvatar, ProfileBanner/Avatar, NewsCard plus every other consumer (PostQuote, follower rows, mention chips) with zero render changes; fallbacks pre-existing. `backgroundUrl` verified already-sound (R2.4 gate + tests). Tests: scheme tests in both adapt suites + news-image test in `mastodon-backend.test.ts`, all in place.
- (k) softMute `regexCache` LRU cap: `REGEX_CACHE_MAX = 300` (matches `translate.ts` precedent order), FIFO oldest-evict mirroring `remotepost.ts` `remember()` shape, keys stay filter-text (pure memo, no per-account data). Read-only `regexCacheSizeForTests()` hook (boundedness otherwise unobservable — zero existing cache-size pins repo-wide). Test in the existing softMute suite: N > cap inserts → bounded; evicted filter recompiles identically; evicted invalid still never matches.

Decided (→ ADR or DECISIONS entry if load-bearing):

- SectionShell Back switch closed as won't-do (premise incorrect for same-route `navigate`; pinned test contradicts). No code change, no ADR — handoff item resolved with evidence here.
- Adapter-level URL gating over per-site render gates (covers all consumers, no render churn).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2913 tests passed (pre-batch: 217 / 2907; +6).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- New file `src/screens/PasswordSignin.ts` (the extraction target itself — inside the slice's Login file list by precedent of `MastodonCallback.ts`).
- (j) touched `adaptAccount` in both families, gating avatar/header for ALL consumers — wider than the three named sites but the same adapter-level pattern R2.4 prescribed; no render files touched.

Next:

- Batch 4 (locale): `pnpm intl:extract && pnpm intl:compile` for R2.2 poll-partial copy; confirm the 8 English-only keys queued for the fr+7 sweep, not machine-translated.
