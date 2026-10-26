# Core Infra Audit — Fedi Data Layer + Query/Cache/Streaming Plumbing

Scope: `packages/fedi/src/core/*`, `packages/fedi/src/api/*`, `packages/fedi/src/index.ts`,
`packages/fedi/src/misskey/external.ts`, `src/state/queries/{keys,retry,stale,feeds,usePostFeedQuery,usePostThread}.ts`,
`src/state/cache/*`, `src/state/streaming.ts`, `src/state/feedMemory.ts`, `src/state/feedPrefs.ts`.

Method: full reads of every in-scope file + `grep` for `sessionId`, `window`, `document`,
`react`, `expo`, `import.*#/`, `any`, `429`, `403`, `backoff`/`reconnect`, query-key builders.
(`src/state/session/store.ts`, `packages/fedi/src/misskey/{client,stream}.ts`,
`packages/fedi/src/mastodon/{client,stream}.ts`, `src/screens/HomeFeed.tsx` consulted as
boundary evidence only — findings there are flagged as boundary, not in-scope verdicts.)

## File sizes

Measured with `wc -l` (exact):

| File | LOC | >650? |
|---|---|---|
| `packages/fedi/src/core/backend.ts` | **1861** | YES |
| `packages/fedi/src/core/detect.ts` | **884** | YES |
| `packages/fedi/src/core/sessions.ts` | 613 | no (close) |
| `packages/fedi/src/core/http.ts` | 330 | no |
| `packages/fedi/src/core/recommendations.ts` | 237 | no |
| `packages/fedi/src/core/hosting.ts` | 208 | no |
| `packages/fedi/src/core/config.ts` | 208 | no |
| `packages/fedi/src/core/feedDescriptor.ts` | 159 | no |
| `packages/fedi/src/core/errors.ts` | 84 | no |
| `packages/fedi/src/core/boot.ts` | 41 | no |
| `packages/fedi/src/api/composer.ts` | 488 | no |
| `packages/fedi/src/api/client.ts` | 365 | no |
| `packages/fedi/src/api/emoji.ts` | 343 | no |
| `packages/fedi/src/api/linkpreview.ts` | 260 | no |
| `packages/fedi/src/api/tags.ts` | 159 | no |
| `packages/fedi/src/api/emojiAssets.ts` | 96 | no |
| `packages/fedi/src/api/fold.ts` | 89 | no |
| `packages/fedi/src/api/backend.ts` | 73 | no |
| `packages/fedi/src/index.ts` | 201 | no |
| `packages/fedi/src/misskey/external.ts` | 522 | no |
| `src/state/streaming.ts` | 624 | no (close) |
| `src/state/cache/postActions.ts` | 396 | no |
| `src/state/cache/post-shadow.ts` | 252 | no |
| `src/state/cache/patch.ts` | 103 | no |
| `src/state/cache/gates.ts` | 63 | no |
| `src/state/cache/index.ts` | 7 | no |
| `src/state/queries/usePostThread.ts` | 254 | no |
| `src/state/queries/usePostFeedQuery.ts` | 240 | no |
| `src/state/queries/keys.ts` | 116 | no |
| `src/state/feedPrefs.ts` | 104 | no |
| `src/state/queries/feeds.ts` | 77 | no |
| `src/state/feedMemory.ts` | 53 | no |
| `src/state/queries/stale.ts` | 31 | no |
| `src/state/queries/retry.ts` | 13 | no |

Only two files exceed 650 LOC: `core/backend.ts` (1861) and `core/detect.ts` (884).
Near-threshold watch list: `src/state/streaming.ts` (624), `core/sessions.ts` (613),
`misskey/external.ts` (522, out-of-scope-adjacent but read).

## Long-parameter functions

No function in scope takes 5+ positional parameters. The codebase consistently uses
opts-objects. Longest signatures found (all acceptable, listed for completeness):

- `packages/fedi/src/core/backend.ts:720` — `FiltersApi.create(phrase, context, opts?)` (3 params).
- `packages/fedi/src/core/backend.ts:724` — `FiltersApi.update(id, phrase, context, opts?)` (4 params, the longest in scope).
- `packages/fedi/src/core/backend.ts:1648` — `Backend.noteReactions(id, opts?: PageOpts & { reaction?: string })`.
- `packages/fedi/src/api/composer.ts:306` — `buildPostDraft(state, ctx: BuildContext)` — good: context object, not params.
- `src/state/cache/postActions.ts:51-56` — `setReaction(sessionId, backend, post, next, opts?)` (5 with optional opts; session-scoped by construction, see below).
- Query-key builders: **every** builder takes `sessionId` as the first parameter —
  `keys.ts` (all 17 builders), `usePostThread.ts:29,34,137,142,223`
  (`threadQueryKey`, `threadRepliesQueryKey`, `repostsQueryKey`, `noteReactionsQueryKey`,
  `editHistoryQueryKey`), `accounts.ts:14,47`, `adminInsight.ts:57`, `adminReports.ts:60,66`,
  `graph.ts:34,38`, `composer.ts:33,37,365,398` (`composeLimitsKey`, `customEmojisKey`,
  `scheduledPostsKey`, `serverDraftsKey`), `chat.ts` (via `keys.ts` builders).
  The only `*Key`/`*key` functions NOT taking `sessionId` are correctly not query keys:
  `streaming.ts:39` `feedSourceKey` (pure source stringifier), `usePostThread.ts:34`
  takes it (false positive in the grep — signature spans two lines),
  `notifications.ts:62` `notificationsFilterKey` (a key *segment*, always wrapped by
  `notificationsQueryKey(sessionId, …)` at `notifications.ts:101`), `feedMemory.ts:36`
  `feedScrollKey` (takes `sessionId: string | null`, scroll memory, not react-query).
  `createQueryKey` (`keys.ts:13`) throws on empty sessionId, so an unscoped key cannot
  be constructed through the helper. `keys.test.ts` pins sessionId-first for all helpers.
- Retry policy: `src/state/queries/retry.ts:7` `retryPolicy(attempts?)` — single optional
  arg; delegates to `isNonRetryableStatus` (`core/errors.ts:81`). Correctly excludes
  401/403/404/410/422/**429** from retries (no 429 retry amplification anywhere; every
  query hook in scope uses `retryPolicy`). Default is 2 retries (3 attempts total).
  No `Retry-After` header is honored anywhere — deliberate (no retry happens on 429 at
  all), not a bug.
- HTTP wrappers: `core/http.ts:173` `requestJson(origin, path, opts?)` — no token
  parameter by design (auth is session-bound at client construction). Origin guard
  (`http.ts:129-138` `resolveSameOriginUrl`) rejects cross-origin before I/O.

## Condensed responsibility

`core/backend.ts` (1861 LOC) is a god-*interface* (types only, no logic — the risk is
review/merge burden, not runtime coupling). It currently holds ~30 domain areas in one file:

1. Pagination primitives (`PageOpts`) + timeline kinds (`TimelineKind`).
2. Account-post listing opts (`AccountPostsOpts` with per-tab explicit-flag contract).
3. Compose vocabulary (`ReactionAcceptance` + labels/keys, `PollDraft`, `UploadMediaOpts`,
   `MediaUpdate`, `PostDraft`, `ProfileUpdate`, `ProfileImageKind`).
4. Search/explore (`SearchPostsOpts`, `ExploreUsers`, `TrendingTag`, `NewsLink`, `ExploreApi`).
5. Recommendations (`RecommendationFeedOpts/DwellItem/Interests/SettingsPatch`, `RecommendationsApi`).
6. Custom emoji, translation, notifications opts, follow requests, notification filter presets.
7. User/note reaction rows (`UserReaction`, `NoteReactionRow`).
8. Streaming vocabulary (`StreamState`, `FeedSource`, `FeedChannelState`, `FeedSubscription`,
   `PostUpdateEvent`, `ChatStreamHandlers`, `StreamHandle`).
9. Capability-gated sub-modules: drive (+folders), antennas, clips, lists (+membership,
   replies-policy, exclusive), scheduled, server drafts, bookmarks, filters, channels,
   announcements.
10. Admin insight (Mastodon measures/dimensions/peers/extended-description/activity +
    Misskey server-info/instance-meta/queue-stats/online-count).
11. Reports queue (`QueuedReport`, list/resolve/recategorize/note/forward opts + `ReportsQueueApi`).
12. Conversations (Mastodon DMs) + Misskey chat (`ChatMessage/Room/Membership`, `ChatApi`).
13. Tag follow/feature/mute + domain blocks + import/export (`TagsApi`, `DomainBlocksApi`, `TransferApi`).
14. Reports filing (`ReportCategory/Options/Result`, `normalizeReportOptions`, `InstanceRule`).
15. The `Backend` interface itself (~60 members) + `normalizeDomainBlock`.

`core/detect.ts` (884 LOC) holds three jobs that could split but are coherent:
flavor detection (NodeInfo/shape/version), the per-flavor capability table
(`FLAVOR_FEATURES`), and probe plumbing (`fetchInstance`, `fetchNodeinfo`, `detectServer`).
The capability table is the growth vector (8 flavors × 33 keys with per-cell prose
comments). Splitting is optional; no action recommended now.

`packages/fedi/src/index.ts` (201 LOC) is a barrel with per-symbol re-export lists —
correct for the `no-wire-in-app` boundary, but every new module requires a manual barrel
edit (already the documented convention; fine).

## Suspected bugs (file:line)

Severity key: **[high]** likely user-visible / security-adjacent · **[med]** real but
narrow/guarded · **[low]** edge-case or polish.

1. **[med] Mastodon-family external logout never revokes server-side.**
   `packages/fedi/src/misskey/external.ts:321-342` — the Mastodon branch of
   `revokeExternalToken` builds a throwaway session and calls `revokeSessionToken`
   with **no `store`**, so `cachedAppFor(undefined, …)` (`core/sessions.ts:555-566`)
   returns null and `revokeSessionToken` (`core/sessions.ts:592-593`,
   `if (!app?.client_id) return;`) exits silently. Every Mastodon external sign-out
   skips RFC 7009 revocation while the Misskey branch actually POSTs. Fix: thread the
   `KeyValueStore` through (or document intentional skip — currently silent).
2. **[med] `uploadDriveFile` lacks the family guard `apiCall` has.**
   `packages/fedi/src/api/client.ts:321-332` builds a *Misskey* client from the active
   session unconditionally, while `apiCall` (`client.ts:276-292`) throws
   `UNSUPPORTED_FAMILY` for Mastodon-family actives. With a Mastodon account active,
   this POSTs Misskey multipart (`i` field) at the Mastodon origin. Same-origin so no
   cross-account leak, and the server will 404 — but the Bearer-style token is sent in
   a body field to an endpoint that cannot use it, and the failure mode is a confusing
   server error instead of the typed refusal every other Misskey-only path gives.
   Fix: mirror the `apiCall` family check.
3. **[med] `applyPostShadow` silently drops favourite overrides when the post has no
   `favourite` object.** `src/state/cache/post-shadow.ts:178-184` requires
   `out.favourite` to be non-null before applying `shadow.favourited`. `Post.favourite`
   is `FavouriteState | null` (`core/models.ts:469`, null where favourites are
   reactions). The controller (`postActions.ts:240-244` `boolToggle`) seeds from
   `post.favourite?.mine ?? false` and writes the shadow regardless, so on a post with
   `favourite: null` the optimistic favourite is recorded but never rendered — a tap
   looks dead until the server round-trips. Fix: synthesize the object when the shadow
   says `true` (mirroring `withFavourite`'s count logic), or gate the control off when
   `favourite` is null.
4. **[med] Deleted posts survive in single-post queries.**
   `src/state/cache/patch.ts:73-77` — when `fn` returns null (delete), infinite lists
   drop the row but the single-post branch returns the *unchanged* `data`
   (`return res === null ? data : res`). `removeLivePost` (`streaming.ts:370`) and the
   delete-settle path (`postActions.ts:276`) therefore leave a deleted post renderable
   in any mounted detail query. The `usePostShadow` `isDeleted` flag masks it only
   where the shadow hook is used. Fix: invalidate (or tombstone) single-post queries
   on delete instead of keeping stale data.
5. **[low] Legacy migration keeps only the first internal token.**
   `packages/fedi/src/core/sessions.ts:401-414` — all four legacy internal keys map to
   the same `sessionId(origin, UNKNOWN_ACCOUNT_ID)` and `pushUnique` keeps the first.
   The comment claims "nothing lost" because legacy keys stay on disk, but only one
   token becomes a session; the others are unreachable until re-login (and
   `removeLegacyKeys` later deletes the evidence). Realistically one key was ever
   populated, but a user with tokens under two keys silently loses one. Fix or
   document: warn when >1 legacy token is found.
6. **[low] `saveExternalSession` is one-per-host: a second account on the same host
   evicts the first.** `packages/fedi/src/misskey/external.ts:410-421` (documented as
   legacy parity). This contradicts the unified store's per-(origin, accountId) model
   and blocks same-host multi-account. Not a regression (legacy behaved so), but it is
   the single biggest known multi-account gap in the audited surface; track explicitly.
7. **[low] `useFeedLive` resubscribes on `backend` object-identity change.**
   `src/state/streaming.ts:562` deps `[sessionId, descriptor, backend, capable, nonce,
   client]` — any non-memoized `backend` prop tears down and re-dials the socket.
   The sole caller (`src/screens/HomeFeed.tsx:157-199`) resolves via
   `useBackendForSessionId(sessionId)` (presumed stable) so no storm exists today,
   but the hook offers no protection (e.g. identity check / ref) against a future
   caller passing an inline `backendForSession(…)`. Consider stabilizing inside the
   hook or documenting the contract.
8. **[low] `createLiveRegistry` is dead code outside tests.**
   Only referenced in `src/state/streaming.test.ts:295-297`; no production caller.
   Either wire it in (it was built for multi-column deck mounts) or delete it before
   it rots. Same for `liveKey` (`streaming.ts:49-51`) — exported, untested outside?
   (verify before deleting; `feedSourceKey` IS used by the mount.)
9. **[low] `patchRow`'s Post-vs-notification heuristic can misfire.**
   `src/state/cache/patch.ts:41-51` treats any row with `author && content` as a Post
   and anything with `.post` as a notification. A future row shape carrying both
   (e.g. a conversation row with a preview post + author) would patch the wrong
   level. Works today because all paged row types are known; brittle, not broken.
10. **[low] `parseTagBlocks` reports `blockedTags` for blocks it failed to prune.**
    `packages/fedi/src/api/tags.ts:140-157` — when a block's serialized pieces can't
    be located (`ok === false`), its range is skipped but `blockedTags`
    (`tags.ts:157`, `dedupe(blocks.flat())`) still includes those tags, so the bubble
    can cover tags that remain inline — violating the file's own no-double-cover
    invariant. Rare (requires serialization/indexOf mismatch); fix by deriving
    `blockedTags` from successfully-mapped ranges only.
11. **[low] `normalizeDomainBlock` rejects single-label hosts.**
    `packages/fedi/src/core/backend.ts:1414` regex requires a dot, so `localhost` /
    intranet names return `""`. Only affects domain-block input on dev/local servers;
    acceptable if intentional, otherwise allow single-label hosts.
12. **[low] `feedDescriptor.ts:67-73` `arg()` carries a dead `kind` parameter**
    (`void kind`). Harmless; remove or use in the error params. Related edge cases
    verified OK: empty/blank/`|`-containing ids rejected, `search|a|b` (3-part)
    rejected, `format(parse(x)) === x` holds, case-sensitive namespaces. One residual:
    descriptors preserve surrounding whitespace verbatim (`tag| cats`), so a key built
    from untrimmed input never matches the trimmed one — trim at call sites that take
    user input (search).
13. **[low] Query functions can throw retryable errors for non-retryable states.**
    `usePostFeedQuery.ts:222` (`'no backend for session'`) and the `NO_SESSION`
    `ApiError(status 0)` from `activeSessionMastoClient` (`api/client.ts:224`) have no
    status, so `httpStatusOf` returns null and `retryPolicy` retries them (up to 3×).
    Unreachable in practice (`enabled` guards), no network I/O, just wasted cycles.
    Consider `retry: false`-equivalent throws or a non-retryable marker for
    programmer-error throws.
14. **[low, boundary] `ingestLiveNotification` invalidates every non-`all` filter view
    per arrival.** `src/state/streaming.ts:399-417` — active non-all views refetch
    *immediately* on each live notification. Correct (server is filter authority) but
    a high-volume notification stream causes repeated refetches; acceptable today,
    revisit if notification traffic grows (e.g. coalesce invalidations).

Deliberately NOT filed as bugs (verified correct):
- 429 handling: `NON_RETRYABLE_STATUSES` (`core/errors.ts:76`) includes 429 and every
  query hook uses `retryPolicy` — throttled requests never amplify. No `Retry-After`
  logic exists because no retry happens. `translationBreaker.ts:18-20` (out of scope,
  boundary-read) correctly treats 429 as streak-resetting transient.
- 403 circuit-breaker: `verifySession` (`src/state/session/store.ts:529-536`) clears
  only on 401, returns `forbidden` on 403 without clearing; `notePermissionDenied`
  is Misskey-only (Mastodon 403s can be per-action refusals). Matches the plan.
- Token/origin isolation: `createMisskeyClient` binds `session.origin + session.token`
  (`misskey/client.ts`, `authedParams`/`authHeaders`); Mastodon client attaches Bearer
  only to same-origin URLs (`mastodon/client.ts:300` + cross-origin rejection
  `:259-292`); `apiCallPublic` sends no credential (`callPublic … false`,
  `misskey/client.ts:232`); `externalApiCall`'s `params.i ?? token` override mirrors
  the internal client's gen-token override (internal callers only — note, not leak).
- Query-key scoping: every builder session-first (see table above); `patchPostInCaches`
  touches only `queryKey[0] === sessionId`; shadow store keys are `sessionId\0postId`;
  streaming registry/mount keyed by session; `feedScrollKey` session-scoped.
- `detectServer` never throws; NodeInfo-priority-over-shape is documented (MD13);
  `buildCapabilities` evidence is family-scoped (mastodon translation flag cannot raise
  misskey flavors and vice versa, `detect.ts:593-617`).
- No reconnect-storm vector in the ported handles: Misskey pool 1s→30s + jitter
  (`misskey/stream.ts:248-250`), Mastodon 2s^n→30s + 5-fast-close breaker
  (`mastodon/stream.ts:155-166`); app layer adds no timers.

## Quality issues (incl. purity violations)

**Purity (`no-ui-in-fedi` / `no-ui-in-fedi` equivalents): PASS.** No `react`,
`react-native`, `expo`, `window`, `document`, `localStorage`, `navigator`, or `#/`
imports in `packages/fedi` code. All grep hits for those tokens are comments
(`sessions.ts:15`, `stream.ts:12`, `api/emoji.ts:270`) or substring false positives
(`ServerFamily`, `FeatureSupport`). `any` counts are low and legitimate
(record bags, error bodies): backend.ts 5, client.ts 3, http.ts 2, emoji.ts 2,
detect.ts 1, linkpreview.ts 1, feedMemory.ts 1, zero elsewhere in scope.

RN-compat notes (not lint violations today, but load-bearing for the rebuild):
- `err instanceof DOMException` in `core/http.ts:257` and `misskey/external.ts:171`:
  if Hermes lacks a global `DOMException`, evaluating the constructor throws
  `ReferenceError` *inside the catch block*, converting a timeout/network failure
  into a crash. Guard with `typeof DOMException !== "undefined"` (or a
  name-based check `err?.name === "AbortError"`).
- `File` in public signatures (`core/backend.ts:1516,1741,1801`,
  `misskey/external.ts:263`, `api/client.ts:325`): no global `File` on native —
  uploads will need an Expo file-handle abstraction before this interface can be
  implemented on device. Track as a known port gap, not a bug.
- `URL`, `URLSearchParams`, `AbortController`, `FormData`, `Headers`, `fetch`,
  `crypto.randomUUID` (already `typeof`-guarded, `external.ts:117`) are otherwise
  fine on modern RN.
- `api/emojiAssets.ts` hardcodes CDN URLs (jsdelivr, version-pinned) — fine for
  purity, but remote-asset loading on native should get a caching story later.

Other quality notes:
- `misskey/external.ts:352` has a mid-file `import` (after ~350 lines of code).
  Valid ESM/TS (hoisted) but confusing; move to the top. The module-local
  `SESSIONS_KEY = "keystone_external_sessions"` (`external.ts:54`) also shadows
  core's `SESSIONS_KEY = "keystone_sessions"` by name — works, but rename to
  `LEGACY_EXTERNAL_SESSIONS_KEY` for clarity.
- `activeSessionMastoClient` (`api/client.ts:220-250`) exposes `get token()` returning
  the raw Bearer token to the UI layer. Small encapsulation leak; prefer keeping the
  token inside the closure (callers only need the request methods + origin).
- Module singletons with process-wide mutable state: `hosting.ts:172-173` (`current`
  + listeners), `config.ts:148-149` (`cached`/`inflight`), `linkpreview.ts:41,47`
  (`previewCache`/`inflight`, negative results cached with no TTL — a failed preview
  never retries until reload). All have test hooks except hosting (`setHosting(null)`
  suffices). Preview negative-cache TTL worth adding later.
- `config.ts:200-202` `runtimeConfig()` silently returns defaults before load —
  callers can't distinguish "loaded defaults" from "not loaded yet". Minor.
- `migrateLegacySessions` (`sessions.ts:394`) calls `readStore` twice on the early
  return; trivial.
- `UNICODE_EMOJI_GROUPS` (`api/emoji.ts:96-106`) is a multi-thousand-entry literal in
  a data-layer module — inflates the JS bundle parsed at startup. Consider lazy import
  or moving to an asset; not urgent.
- No circular imports detected in scope (`api/client` → `misskey/*` + `mastodon/*`
  is one-directional; `core/*` imports only `core/*`; `external.ts` → `core/sessions`
  one-directional). `state/*` correctly imports `@keystone/fedi` + `#/` only.

## Top 5 fix priorities

1. **Guard `DOMException` for native** (`core/http.ts:257`, `misskey/external.ts:171`) —
   cheapest fix with the worst failure mode (catch-block crash on every timeout where
   Hermes lacks the global). `typeof` guard + regression test with the global removed.
2. **Fix or document the Mastodon external-revocation no-op**
   (`misskey/external.ts:321-342` + `core/sessions.ts:592-593`) — silent security
   relevant skip: either pass the store through or log/record the skip explicitly.
3. **Add the missing family guard to `uploadDriveFile`** (`api/client.ts:321-332`) —
   one `if` mirroring `apiCall`, turning a confusing server 404-with-credential into
   the typed `UNSUPPORTED_FAMILY` refusal.
4. **Repair favourite-shadow and delete-settle cache paths**
   (`cache/post-shadow.ts:178-184`, `cache/patch.ts:73-77`) — two small, testable
   correctness fixes in the optimistic-update layer: synthesize `favourite` when the
   shadow demands it; invalidate single-post queries on delete instead of retaining
   stale data.
5. **Split or budget `core/backend.ts`** — no runtime action, but at 1861 LOC / ~30
   domains it is the file most likely to produce merge conflicts and drive-by scope
   creep. Cheapest effective step: extract the reports-queue, admin-insight, and
   transfer blocks into `core/{reportsQueue,adminInsight,transfer}.ts` (pure type
   moves, re-exported from `backend.ts` so no caller changes), with a LOC budget
   noted in the task file. In the same pass, delete or adopt `createLiveRegistry`
   (`streaming.ts:244-273`) and fix the `arg()` dead param / `external.ts` mid-file
   import.
