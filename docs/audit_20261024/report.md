# Keystone codebase health audit — 2026-10-24

Date: 2026-10-24. Scope: everything — `packages/fedi/src`, `src`, `lint-rules`, `scripts`.
Method: 10 parallel deep audits, each with full file reads + `wc -l` / `grep` verification.
Corpus: **453 files / 97,333 LOC** (`08`).

Results (per-area detail):

- `results/01-misskey-adapter.md` — Misskey adapter (31 files, 8053 LOC)
- `results/02-mastodon-adapter.md` — Mastodon adapter (80/80 tests re-run green)
- `results/03-content-parsing.md` — MFM / HTML / AST / RichText
- `results/04-core-infra.md` — core fedi + query/cache/streaming plumbing
- `results/05-home-explore-profile.md` — Home / Explore / Profile surfaces
- `results/06-exclusive-features.md` — Misskey-only + Mastodon-only features
- `results/07-settings-nav-session.md` — Settings / Nav / Session / Auth
- `results/08-crosscutting-health.md` — quantitative backbone (sizes, params, banned patterns, coverage)
- `results/09-react-correctness.md` — how React is used (hooks, memo, races, lists, a11y)
- `results/10-expo-native-web.md` — Expo SDK / native / web parity, media, hosting/OAuth, build hygiene

## Executive verdict

**Healthy foundation, real but bounded bug list, one P0 data-corruption fix.**

- Architecture boundaries hold: 0 `window`/`document` in `packages/fedi`, 0 `#/` imports in fedi, 0 `react`/`react-native`/`expo` in fedi, 0 `innerHTML`/`dangerouslySetInnerHTML`/`WebView` anywhere, 0 `@ts-ignore`, 1 intentional `@ts-expect-error`, 0 bare `console.log`, **zero TODO/FIXME/HACK/XXX** (`08`). Token/origin isolation verified on both families (`02`, `04`). Every query key is `sessionId`-first with throw-on-empty (`04`, `05`, `07`).
- Options-bag discipline is good repo-wide: **no function takes >4 required positional params** outside 4 internal `state/` queue helpers. Prop sprawl (15–20 props on PostCard/RichText/PostFeed) is the real variant.
- The bug list is genuine but not structural: **1 P0** (wrong-account filter writes), ~15 P1 user-visible/crash/security-adjacent bugs, ~25 P2 polish/robustness items. No evidence of systemic rot, fake data (one sanctioned exception below), or inert-control violations at scale.
- Biggest risks are concentration + performance, not correctness: three `backend.ts` files = 5,118 LOC; `Navigation` (1413) + `PostCard` (1215) + `RichText` (1062) are unmemoized render hot paths with zero `memo()` in `src` and zero `FlatList` tuning anywhere; media paths have no client size cap (OOM vector).

## Files >650 LOC — consolidated (25 files)

From `08` (exact `wc -l`; 3 are tests):

| LOC | File | Split? |
|---|---|---|
| 1861 | `packages/fedi/src/core/backend.ts` | Yes — god-interface, extract `notifications.ts`/`trending.ts`/`reportsQueue.ts` first (`04`, `08`) |
| 1687 | `packages/fedi/src/mastodon/backend.ts` | Extract filter-mapping + list-CRUD only; do not split by feature (`02`, `08`) |
| 1570 | `packages/fedi/src/misskey/backend.ts` | Extract `noteBody.ts` + `drive.ts` + `antennas.ts`; 4× body copies live here (`01`) |
| 1413 | `src/Navigation.tsx` | Yes — extract `shell/linking.ts`, `Sidebar`, `TabBar`, `AccountMenu` (`07`, `08`) |
| 1329 | `packages/fedi/src/mastodon/endpoints.ts` | No — one fn per endpoint, cohesive; needs tests not splitting (`02`, `08`) |
| 1215 | `src/components/Post/PostCard.tsx` | Extract `useQuoteTarget` + `useAutoTranslation` hooks (`05`) |
| 1062 | `src/components/RichText.tsx` | Extract Matrix hover + mention routing + style helpers; add renderer tests (`03`, `08`, `09`) |
| 1000 | `src/screens/Drive.tsx` | Split at next feature (`Drive/` dir) (`06`) |
| 983 | `packages/fedi/src/core/models.ts` | No — central by design (`03`, `08`) |
| 884 | `packages/fedi/src/core/detect.ts` | No — cohesive (`04`) |
| 829 | `packages/fedi/src/mastodon/oauth.ts` | No — large for defensible reasons (scope-history comment + vendored SHA-256) (`02`) |
| 825 | `packages/fedi/src/core/content/ast.ts` | Extract `fromTranslated.ts` scanner (`03`) |
| 812 | `packages/fedi/src/mastodon/adapt.ts` | Mastodon v1+v2 notification weight; acceptable (`02`) |
| 802 | `src/screens/Explore.tsx` | Extract `NewsTab`, `UsersTab` (`05`) |
| 787 | `packages/fedi/src/misskey/stream.ts` | No — clean pool/handle split (`01`) |
| 758 | `src/components/Composer/Composer.tsx` | Shares controller with Compact — managed condensation; delete dead `POLL_DURATIONS` copy (`06`) |
| 730 | `src/screens/AdminReports.tsx` | Split list vs detail; 7 `ConfirmShell` branches table-drive (`07`) |
| 725 | `src/screens/Login.tsx` | Extract `usePasswordSignin`; dedupe iOS-inline vs link-path completion (`07`) |
| 718 | `src/components/Settings/MutesSection.tsx` | Split `WordFields` / `MuteBlockSearch` / `DomainBlocks` (`07`) |
| 698 | `packages/fedi/src/mastodon/stream.ts` | No |
| 689 | `src/components/Composer/ComposerSections.tsx` | See Composer |
| 672 | `packages/fedi/src/mastodon/wire.ts` | No — pure types |
| 771/678/668 | `store.test.ts`, `post.test.tsx`, `postactions.test.tsx` | Tests — not a smell |

Watch list just under the bar: `HoverPreview` 641, `misskey/wire` 631, `streaming` 624, `Note` 613, `core/sessions` 613, `session/store` 588, `AdminInsight` 586 (`08`).

## Long parameters — consolidated

- **True positional offenders: 4**, all internal non-exported `state/` queue helpers with 8 params each — the single best options-bag refactor target (`08`): `boolToggle` (`postActions.ts:287`), `infinitePages` (`usePostThread.ts:146`), `toggle` (`graph.ts:115`), `queueFor` (`postActions.ts:77`). Everything else ≤6 and trailing-optional.
- Adapters are clean: no Misskey fn >4 positional (`01`); no Mastodon fn >4 (`02`); core max is 4 (`FiltersApi.update`, `04`).
- **Prop sprawl is the real issue:** `PostFeedProps` 16, `RichTextProps` 16, `PostCardProps` 15–20, `PostQuote` 13, `ChatThread` 12, `InternalForm` (Login) 15, `ConfirmShell` 8, `UploadPanel` 11 (`05`, `06`, `07`, `08`, `09`). Direction: group test/seam overrides into sub-objects; replace `quote+unavailable` bool pairs with discriminated unions (`09`).

## Condensed responsibility (god files)

1. `core/backend.ts` — ~30 domains, 112 exports (`04`, `08`).
2. `misskey/backend.ts` — ~30 API groups + body-building + paging in one closure (`01`).
3. `mastodon/backend.ts` + `endpoints.ts` — big but single-job; extract helpers only (`02`).
4. `Navigation.tsx` — routing + shell chrome + account menu + badges in one file (`07`).
5. `RichText.tsx` — parsing-adjacent + rendering + routing + Matrix hover + fn styling; also the most branch-dense file in repo (105 branches, `08`).
6. `PostCard.tsx` — render + quote resolution + auto-translate + media/poll/link-card/reactions/menus in one ~690-line view fn (`05`).
7. `Drive.tsx`, `Login.tsx`, `MutesSection.tsx`, `AdminReports.tsx`, Composer controller (1447 LOC behind one type) — each documented with seams (`06`, `07`).

## Bugs — by severity

### P0 — fix before anything else

- **Word-mute fields write the previous account's filters onto the new account** (`MutesSection.tsx:75-83`). `WordField` seeds once via ref, never resets on account switch (`07`). One-line fix: `key={session.id}` + regression test.

### P1 — user-visible / crash / security-adjacent

Adapters/data layer:
- `users/relation` wrong param `{userIds}` vs `{userId}` on the main path — Sharkey 400 / stock silent mis-filter, zero test coverage (`misskey/backend.ts:1104`, `01-B1`).
- Module-global caches leak across accounts: translate `completed/inflight/failedAt/outcomes/retries` (`misskey/translate.ts:201-208,407-408`) and quote `seenByUri/seenById` (`misskey/quote.ts:273-274`) — the latter is a **visibility bypass** (followers-only note resolved by A served to B) (`01-B3`).
- `noteReactions` + renote-mute crash on missing user packs (`misskey/backend.ts:926`, `renoteMutes.ts:28`, `01-B2/B14`).
- Bookmarks ignore caller limit — pagination stalls at `limit:50`, over-fetches at `limit:5` (`misskey/backend.ts:760-769`, `01-B7`).
- Dead ~47-line quote-resolution copy with **divergent matcher semantics** (`mastodon/endpoints.ts:598-646` vs `backend.ts:1635-1687`, `02-1`).
- Fabricated `new Date()` notification timestamps — violates never-fake-data, sorts dateless rows first (`mastodon/adapt.ts:675,731-733`, `02-2`). Fix by widening `Notification.createdAt` to `string|null`.
- Mastodon external logout never revokes server-side (silent no-op via storeless `cachedAppFor`, `04-1`).
- `uploadDriveFile` lacks the family guard `apiCall` has — sends Misskey multipart w/ token-in-body at Mastodon origins (`04-2`).
- `instanceof DOMException` in catch blocks crashes on Hermes where the global is absent (`core/http.ts:257`, `misskey/external.ts:171`, `04`).
- Translators/scanners shred dotted/bridged handles (`@foxtails.me@bsky.brid.gy` → `@foxtails`), in translated-text + field scanners + `plainFromMfm` (`03-B2/B4`).
- Bare-link unfurl gap: server-shortened Mastodon links never trigger `UnfurledLinkCard` — two bare-link predicates disagree (`03-B1`).

App:
- `PostCardView` drops `sessionId` to `ReactionChips`/`PostQuote` — multi-account deck columns resolve remote emoji via the wrong session (`05-B1`).
- **Conditional `useMemo` after early return in `RichText`** — rules-of-hooks violation in the universal renderer (`RichText.tsx:1031/1045`, `09-1`).
- Composer double-submit race — no `busy` guard at `submit` entry, only button `disabled` (`Composer.tsx:352`, `09-2`).
- Nested `KeyboardAvoidingView`s double-offset on iOS/Android (`Compose.tsx:116` + `CompactComposer.tsx:177`, `10-D1`).
- Media OOM: `quality:1` + whole-file `fetch→blob` with no size cap; the "10 MB guard" comment describes code that doesn't exist (`10-M2/M3`).
- Every video owns a player; feed gifvs all autoplay including off-screen; Lightbox starts N audio tracks at once (`10-M4`).
- Chat file attachments render as empty rows — file-only messages show author + nothing (`ChatThread.tsx:50-53`, `06-1`).
- Misskey multi-choice poll vote non-atomic — partial votes + retry re-submits counted choices (`misskey/backend.ts:1023`, `06-2`).
- `PostPoll` selection never resyncs to new poll props (`PostPoll.tsx:67-69`, `06-3`/`09-3`).
- `errors.unsupported.avatar` is dead copy asserting a falsehood (Mastodon avatar upload ships, `mastodon/backend.ts:829`) (`07-2`).
- Unvalidated `backgroundUrl` → `Image` source with no `safeHttpUrl` gate (`05-B7`).
- `NoteScreen` renders all errors incl. 429 as "deleted" (`05-B4`); profile tab sticks across profiles (`05-B5`); NewsTab load-more dupes + swallowed errors (`05-B2`); favourite-shadow dropped when `favourite==null` (dead-tap until round-trip) + deleted posts survive in single-post queries (`04-3/4`).

### P2 — robustness / honesty / small fixes (batch)

- Scope-fallback retries on any 4xx incl. 403 (`mastodon/oauth.ts:392-404`); empty admin PATCH (`mastodon/admin.ts:455-473`); three divergent absence predicates; shape-error `[]` swallowing; `conversation` stream events dropped (DM inbox poll-only); Link-header comma edge; `updateProfile` verbatim-`ext` + `antennaBody` null-field Sharkey-400 risks; stream per-call `token` param thrash; `account()` `{}` 400; legacy-migration shape mismatch; chat plain-`Error`s; fabricated server-info `0`s; upload timeouts; `explore.users` `Promise.all` fail-whole-page (`01`, `02`).
- `Tag` descriptor unsanitized (`05-B3`); root-reply `keyExtractor` missing `sessionId` (`05-B8`/`09`); Followers/Following error-clear-on-more + 304-line duplication (`05-B10`); `RecommendationsFeed` capabilities from injected backend only (`05-Q5`); clip `isPublic` create-only (`06-6`); antenna notify/list-source deferral unrecorded (`06-7`); conversation mark-read swallows failure, history ignores `incomplete`, O(n) inbox scan documented (`06-8/9/10`); Drive delete double-tap (`06-5`); `linkingPrefixesForBase` bare-path prefix (`07-4`); internal server ID shown to users (`07-5`); OAuth completion logic duplicated in two call sites (`07-8`); `SectionShell` Back pushes duplicate Settings (`07`); Matrix-chip copy native-only (`10-D2`); `AuthCallback` conditional-hook shape (`10-D3`); iOS MiAuth drops session result URL (polling-only, `10-H3`); `pickMedia` skips permission flow (`10-M1`); reanimated/worklets/screens overridden past SDK 57 pins — top future native-crash suspect (`10-F1`); dead `react-responsive` dep, Watchman footgun, StatusBar web nit, `MediaGrid` vs `PostMediaGrid` duplication, feed `Image` vs `expo-image` split (`10`).

## Quality

- **`any`: 249 hits, mostly tests.** Prod leaders: `notifications.ts` (6), `Navigation` (5), `mastodon/adapt` (5), `core/backend` (5) (`08`). `as any`: 6 prod (all Mastodon adapt boundary — type the envelope once) + 12 test fakes (`02`, `08`). Misskey side uses `unknown`-narrowing throughout — exemplary (`01`).
- **Duplication (deliberate vs real):** 9 shared basenames across families are parallel wire impls by design, not pastes (`08`). Real extractions: shared inline-token scanner (`ast.ts` + `fields.ts`, `03-1`), `decideTranslation` family (fedi vs app copies drifting, `03-2`), `adaptClipSummary` reuse, emoji-entry validator ×3, `pickDefined()` for the ~40 hand-rolled omit-null Sharkey-discipline sites (`01`), PostCard quote-block (~60 lines branchy JSX), `exec/execConfirm/execReport` triple, Followers/Following 304-line dup, settings radio/switch/text-save row primitives ×4/×3/×5, admin section-state machine ×2 (`05`, `06`, `07`).
- **Dead code:** `endpoints.ts:598-646` quote copy, `accountLookupFailure`, `translate.ts:220 isTranslateResult`, `external.ts:55 ACTIVE_KEY`, `createLiveRegistry` (no prod caller), dead `POLL_DURATIONS` in `Composer.tsx:70`, `ExploreSearchBar busy` prop never passed, `recommendations.ts` unreferenced by tests, `MediaGrid.tsx` effectively dead (`01`, `02`, `04`, `05`, `06`, `10`).
- **Tests:** 205 suites via `--listTests` (vs STATE.md's 199 — drift from unpushed slices + lint suites, `08`). 129 sources lack name-matched tests; 19 >300 LOC. Highest-value gaps: `mastodon/endpoints.ts` (1329), `RichText.tsx` (1062), `Navigation.tsx` (1413), `external.ts` (522, security-adjacent), `fromHtml.ts` (468), `postActions.ts` (396), `quoteMarker.ts` (312), `presentation.ts` (425), `Relationships()` zero coverage (`01`, `08`). `wire.ts` files untested — low risk, fine.
- **Perf:** zero `memo()` in `src`; `usePostActions` returns fresh closures every render; `buildPostMenu` + PostCard link handlers invalidate RichText's `ctx` memo every render; `StyleSheet.create` in render on composer keystroke path; no `getItemLayout`/`windowSize`/`maxToRenderPerBatch`/`removeClippedSubviews` on any list; per-mount unfurl fan-out + per-tile video players (`05-Q3`, `09`). Measure a 200-post timeline before/after.
- **a11y:** labeling consistently good; touch-target gaps below 44pt (hovercard follow, Discussions pill, Caption taps, menu/poll/suggest rows) with only Button/PopupRow test-asserted (`05-Q4`, `09`). Contrast routed via theme with dedicated tests — ratios not computed from code, left as verification item.
- **i18n:** mechanics sound; **8 error keys English-only in all 7 non-en locales** (`savePending`, `badPath`, `unreachableBare`, `profileField`, `likeUnsupported`, `invalidDescriptor`, `createdList`, `updatedList`, `07-3`).
- **Lint rules exist, pass, have tests — with gaps:** `no-wire-in-app` misses `/wire/*` subpaths; `no-ui-in-fedi` misses `globalThis`/`navigator`/`self`/`fetch` (`07`).
- **No fake data** (transfer rows honest-disabled with reasons, exclusive screens honest signed-out states, `fetchServerInfo` `0`-fallback is the one exception, `06`, `07`, `01-B11`). **No unsupported-means-hidden violations** (one inconsistency: `RecommendationsFeed` capabilities, `05-Q5`).

## Verified sound (do not re-litigate)

WebSocket-not-SSE both families; per-origin token isolation; 204 handling; OAuth triple + admin scopes + 422/502 history; reblog mapping; pagination end rule; thread rebuild + cycle guards; no wire leakage; query-key scoping; 429 never retried; 403 breaker; streaming backoff (1s→30s + jitter / 2s^n→30s + 5-fast-close); Matrix-shredding + Bridgy tap-time + translation-skip + XSS/entity/folding defenses; schedule timezone; transfer honesty (4 import + 8 export = 12 rows, brief's "5 vs 12" off by one); antenna-rename allow-list; clip-privacy scoping; composer autogrow fix; hovercard ghost/drift/revive; gesture-handler posture; SafeArea; prober + OAuth callback hygiene; deep-link table; keystore exclusion (`01`–`10` passim).

## Fix roadmap

**Now (P0+P1 crash/data-loss, ~1 slice):** WordField reseed; `users/relation` param + test; scope translate/quote caches per session (+TTL/retry); guard missing-user adapts; RichText hook hoist; composer `busy` guard; PostCard `sessionId` threading (4 lines); nested-KAV removal; DOMException guards; external-revoke + `uploadDriveFile` family guard; favourite-shadow + delete-settle; chat attachment render.

**Next (P1 correctness batch):** notification `createdAt` nullability; quote-copy deletion + matcher unification; scope-fallback narrowing; `conversation` stream routing; dotted-handle widening + bare-link unification; unfurl predicate reuse; 429 honesty in Note; backgroundUrl validation; poll atomicity/resync; clip `isPublic` editing; media permission + size guard + `quality`; visible-only video playback; SDK-57 reconciliation.

**Then (P2 maintainability):** backend.ts splits (`noteBody`, notifications/trending, filter/list extracts); Navigation/Sidebar/TabBar/AccountMenu + MutesSection + AdminReports splits; shared scanner + `decideTranslation` + row primitives; lint-rule tightening + `SysDebug` `__DEV__` gate; i18n 8-key sweep + dead-copy removal; `memo()` + FlatList tuning with profiling; coverage for endpoints/RichText/Navigation/external/fromHtml/postActions.

*Per-area Top-5 lists with exact `file:line` are in `results/01`–`10`; this report prioritizes across them. Disagreements with prior STATE/docs (transfer 4+8=12 not 5-vs-12; suites 205 vs 199 from unpushed slices) are noted above.*
