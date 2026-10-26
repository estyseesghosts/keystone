# Sessions & cache audit — Keystone v2 (2026-10-26)

Scope: `src/state/session/*`, `src/state/queries/*` (query-key construction), `src/state/cache/*` (`post-shadow.ts`, `postActions.ts`, `patch.ts`, `graph.ts` read at `src/state/queries/graph.ts`), `src/state/streaming.ts` (`useFeedLive`, live prepends, gap fill), chat merge (`mergeChatMessage`), `hydrate()`, vault-vs-envelope precedence, `signOutEverywhere`, active-account-removal fallback, `setListMember`, optimistic-write vs in-flight fetch cancellation, `resolveSessionBackend` per-render cost.
Method: static code reading + grep. No source modified. Nothing executed.
Prior report (`docs/audit_20261025/results/sessions-cache.md`, 12 findings) used as the baseline; each item re-verified below.

## Summary

9 of the 12 prior findings are fixed, 2 are fixed-and-documented as decisions, 1 persists in narrowed form. One new live bug found (settings write path bypasses the token overlay on native), plus 5 low-severity residuals.

| # | Severity | Title | Status vs 2026-10-25 |
|---|----------|-------|----------------------|
| 1 | Medium | `saveRecommendationSettings` builds its backend from the raw envelope, bypassing the in-memory token overlay (broken on native) | New |
| 2 | Low | Post-toggle `settleInto` still does not cancel in-flight fetches (graph toggles do) | Narrowed remainder of old 9 |
| 3 | Low | `createToggleQueue` discards a mid-flight re-toggle when the in-flight request fails | New (adjacent to old 2) |
| 4 | Low | Mutation-401 half of the runtime-401 handler is dead: no production mutation sets `mutationKey` | Remainder of old 4 |
| 5 | Low | `sessionIdFromKey(['me','signed-out'])` returns `'me'`, contradicting its own doc comment | New (wart, guarded) |
| 6 | Low | `signOutEverywhere`'s `clearAllQueries` also wipes a concurrent survivor session's cache | Remainder of old 6/7 area |
| 7 | Low | `usePostFeedQuery` parses the session envelope on every render even with an injected backend | Remainder of per-render-cost scope |

Counts: 1 Medium, 6 Low. No High.

## Findings

### 1. Medium: `saveRecommendationSettings` bypasses the token overlay — unauthenticated on native

Files: `src/state/queries/recommendations.ts:157-163`, caller `src/components/Recommendations/RecommendationsSettingsOverlay.tsx:256`, `packages/fedi/src/core/sessions.ts:148-150`, `src/state/session/store.ts:821-844`.

```ts
const session = findSession(appStorage(), sessionId)   // raw envelope, no token overlay
if (!session) throw new Error('No session for recommendations settings.')
const backend = backendForSession(session)
```

On native the envelope is secret-free: `add()` persists `sessionWithoutToken(session)` (`token: ''`, `sessions.ts:148-150`, `store.ts:824`) and the live token lives only in the store's in-memory map plus SecureStore. `findSession(appStorage(), …)` returns the envelope row with `token: ''`, so `backendForSession` builds (and pools, `client.ts:260-267`) a tokenless backend — Mastodon `createClient(origin, token || null)` sends no auth, Misskey sends an empty credential. The `i/update` write then fails server-side and the overlay shows "Could not save recommendations settings." Every other write path resolves its backend from the session store snapshot (token overlaid via `attach`, `store.ts:459-463`); this is the only production write I found that reads the envelope directly (grep `findSession(appStorage` hits only this plus read-hook fallbacks). On web the envelope keeps the token (D2), so this reproduces on native only.

Fix: resolve the session through the session store (or accept a `Backend` parameter like every sibling hook, e.g. `useRecommendationInterests`), instead of `findSession(appStorage(), …)`.

### 2. Low: post-toggle settle still races in-flight fetches

File: `src/state/cache/postActions.ts:120-133`. There is no `cancelQueries` anywhere in `postActions.ts` (grep).

`settleInto` writes the confirmed field into every cached copy and clears the shadow field. A feed fetch that started before the toggle and resolves after the settle overwrites the confirmed value with pre-toggle server data — and the shadow is already cleared, so unlike the pre-settle window there is no guard left; the row stays stale until the next refetch. Graph toggles close the same window with cancel-before-write (`graph.ts:143,151,196,204,285,294`), as do the feed prepend (`streaming.ts:370`), notification ingest (`streaming.ts:424`), chat live merges (`chat.ts:333,339,369,376`), composer insert (`composer.ts:152`) and `resolveFollowRequest` (`graph.ts:285,294`). Post toggles are the only optimistic-write path without it. (Delete is covered: its settle keeps the `isDeleted` shadow, `postActions.ts:303-311`.)

Fix: `void queryClient.cancelQueries(...)` for the session's feed/post keys before the `patchPostInCaches` write in `settleInto`, mirroring the graph toggle pattern.

### 3. Low: queue failure discards a newer mid-flight intent

File: `src/lib/hooks/useToggleMutationQueue.ts:67-86`, esp. lines 73-77.

On `run` failure the drain loop sets `desired = confirmed` unconditionally, then throws. A `queueToggle(next)` that landed *during* the failed request — i.e. the user's newest intent — is overwritten and never executed; all attached callers reject with the stale failure. (On success the loop correctly continues to the newest `desired`.) Trigger shape: toggle on (in flight) → toggle off → toggle on again → request fails → UI shows off although the last press was on, with no retry of the final intent. Narrow window, user-visible only on flaky networks with rapid taps.

Fix: on failure, keep the newest `desired` when it differs from the value that failed (roll back the display but continue draining), or at minimum document that callers must re-issue after a rejection.

### 4. Low: mutation-401 routing is live-tested but unreachable in production

Files: `src/state/queries/Provider.tsx:94-105`, verified by grep `mutationKey:` across `src/` (hits only `runtime401.test.tsx:185,197`).

The `MutationCache.onError` only routes mutations carrying a sessionId-first `mutationKey`, and the file's own comment (`Provider.tsx:95-98`) admits no app mutation sets one. So a 401 that surfaces *only* through a mutation — token revoked while all queries are fresh, user reacts/posts — never triggers `verifySession`; the session lingers until a query 401s or reboot. The query half is fully wired (single-flight `pending` map, known-session guard, `verifySession` cooldown in the store).

Fix: either set sessionId-first `mutationKey`s on the session-scoped mutations (create-post, graph actions, chat sends) or remove the mutation-cache branch and record the decision. The current state (tested dead code implying coverage that does not exist) is the worst of both.

### 5. Low: `sessionIdFromKey` misreads kind-first signed-out keys

File: `src/state/queries/Provider.tsx:132-140`, pinned by `runtime401.test.tsx:84`.

`sessionIdFromKey(['me','signed-out'])` returns `'me'`, although the doc comment promises null for `signed-out` heads and the sibling `queryKindOfKey`/`sessionIdOfKey` pair in `persistPolicy.ts:113-135` handles both key shapes correctly. Harmless today only because `handleAuthFailure` (`Provider.tsx:64`) re-checks against `runtime401.list()` and no session is ever id'd `'me'` (covered by the test at `runtime401.test.tsx:145-158`). Any future caller trusting the name will mis-attribute.

Fix: return null when any of the first three elements is `'signed-out'` (the `sessionIdOfKey` rule), and update the pinning test.

### 6. Low: `signOutEverywhere` clears a concurrent survivor's cache

Files: `src/state/session/store.ts:906-947`, `src/state/session/purge.ts:231-234`.

The S6 race itself is fixed (serialized op chain, parallel revokes, per-id re-read at `store.ts:917-918`, active-pointer preservation at `936-943`). Residual: `clearAllQueries()` at line 932 unconditionally cancels and clears *every* query, including those of a session added mid-revoke that correctly survives with its active pointer. The survivor's data is wiped and refetches on mount — correct but wasteful, and a foreground feed visibly flashes to loading. Narrow (requires sign-in during the revoke window).

Fix: snapshot `getQueryCache` keys before clearing and skip keys whose head is not in `removedIds`, or accept and record.

### 7. Low: `usePostFeedQuery` re-parses the envelope every render

Files: `src/state/queries/usePostFeedQuery.ts:210-222`, contrast `src/state/queries/chat.ts:75-79`, `notifications.ts:93-98`, `conversations.ts:59-66`.

Line 211 runs `findSession(store, sessionId)` → `loadSessions` → `JSON.parse` of the envelope on *every* render, even when `options.backend` is injected (all production screens inject store-backed backends: `HomeFeed.tsx:160-169`, `RecommendationsFeed.tsx:42-52`, `Notifications.tsx:614-620`, `Conversations.tsx:119`, `ChatRoom.tsx:49-55`, `ChatUser.tsx:52-57`). The chat/notifications/conversations resolvers skip the storage read when a backend is provided; the feed hook does not. `backendForSession` itself is pool-cheap (`client.ts:260-267`), so this is one small parse per feed render — perf hygiene only, no correctness issue (backend identity stays pooled; session-key memo at lines 216-222 already prevents socket redial).

Fix: skip the `findSession` call when `options.backend !== undefined` (return the injected backend's session key or null), matching the sibling hooks.

## Looked solid

- **Query keys (sampled).** Session-first via `createQueryKey` everywhere it matters: `keys.ts` (feed, post, account, notifications, me, mutes/blocks/filters, conversations, chat ×4, report-rules, recommendations ×2), `graph.ts:35-41` (relationship, list-membership), `composer.ts:65-71,983-985,1016-1018` (compose-limits, custom-emojis, scheduled-posts, server-drafts), `usePostThread.ts:29-39` + thread-replies/reposts/reactions/history keys (session-first, `?? 'signed-out'`), `accounts.ts:29,63`, `ChatUser.tsx:64` (`accountQueryKey(session ?? 'signed-out', …)`). Signed-out fallbacks come in two shapes — session-first (`['signed-out', kind, …]`) and kind-first (`['me'|'moderation'|'recommendations'|'admin-*'|'report-rules', 'signed-out']`) — and every consumer handles both: `sessionIdFromKey` (modulo finding 5), `queryKindOfKey`/`sessionIdOfKey` (`persistPolicy.ts:113-135`), purge predicate (`purge.ts:220-224`, plus `clearAllQueries` for everywhere-sign-out), gap-fill prefix (`streaming.ts:873`), ingest prefix (`streaming.ts:409`). `createQueryKey` still throws on empty ids (`keys.ts:13-18`).
- **Old 1 (sign-out purge): fixed.** `remove`/`dropLocal`/`signOutEverywhere` run `removeSessionQueries` (cancel-then-remove, `purge.ts:225-230`) + `purgeSessionStorage` (scoped MMKV keys + per-session persist blob + manifest prune, `purge.ts:118-129`) + `purgeSessionMemory` (`postShadowStore.clearSession` now has a non-test caller + stream stops, `purge.ts:134-142`); everywhere-sign-out additionally `clearAllQueries` + `purgeAllPersistedSessions` (`store.ts:932-933`). Per-session persist blobs keyed `perSessionPersistKey(sessionId)` (`persistPolicy.ts:362-364`).
- **Old 2 (settleInto whole-shadow): fixed.** `settleInto` projects through `FIELD[kind]` via `projectShadowField` (`postActions.ts:120-133`, `post-shadow.ts:86-104`).
- **Old 3 (chat merge truncation): fixed.** `mergeChatMessage` spreads `...rest` (`chat.ts:291-296`); live handlers cancel before write (`chat.ts:333,339,369,376`).
- **Old 4 (no runtime 401): fixed for queries.** `QueryCache`/`MutationCache.onError` → per-session single-flight verify → `verifySession` 30 s token-qualified cooldown → second-401 `dropLocal` through the purge path (`Provider.tsx:44-115`, `store.ts:1059-1111`, `672-697`); 403/network/5xx/signed-out/unknown never route (pinned in `runtime401.test.tsx`). `refreshActive` remains an honest no-op (`store.ts:1132-1143`).
- **Old 5 (plaintext token): fixed on native, documented on web.** Secure path writes a secret-free envelope + OS vault + memory map (`store.ts:821-844`); `hydrateSecure` is vault-wins with verified migration and scrub (`store.ts:485-575`); envelope value is only the web/pre-migration fallback, stated in the layer header (`store.ts:51-67`). Web MMKV vault is the documented D2 dev-grade tradeoff (`tokens.web.ts`, store header).
- **Old 6 (hydrate resurrection): fixed.** All erase paths and both `hydrate` bodies run inside the `serialize` chain (`store.ts:364-373`, `673,869,907,955`); every envelope write is preceded by a re-read that skips removed/refreshed rows (`store.ts:488-498,566-572,981-999,1012-1031`); hydrate never reorders (`rewriteEnvelopeRows`, `store.ts:405-412`).
- **Old 7 (active-removal fallback): fixed (D3).** `fixActiveAfterRemoval` activates the most-recently-used survivor, else signs out (`store.ts:418-436`, `mostRecentlyUsed` `392-397`, usage marks on add/switch `383-386,853,863`).
- **Old 8 (unfiltered persist): fixed.** Default-deny `PERSIST_POLICY` allowlist (public timelines descriptor-gated, profiles, emoji, limits, report-rules, `me`; DMs/chat/notifications/drafts/admin/relationships/threads denied), first-page trim, private-row strip, 2 MB shrink-largest-first, per-session split blobs, mutations never persisted (`persistPolicy.ts:40-260,396-474`); `QUERY_BUSTER` derives from `SCHEMA_VERSION` + `MODEL_SHAPE_HASH` (`stale.ts:37-48`); a source-scanning test fails on unclassified kinds (`persistPolicy.test.ts:545-550`). 24 h `QUERY_PERSIST_MAX_AGE` retained (`stale.ts:28`) — acceptable given the allowlist.
- **Old 9 (no cancel on optimistic writes): fixed except finding 2.** Every other path cancels before writing (citations in finding 2).
- **Old 10 (delete leaves wrapper): fixed.** `patchPost` drops pure-renote wrappers, nulls quotes with `quoteUnavailable`, nulls replies (`patch.ts:26-54`); notification rows keep their shell (`patch.ts:62-66`); single-post queries are removed so remount refetches (`patch.ts:92-99`).
- **Old 11 (setListMember): fixed.** `toggleListMember` rides the same desired-value queue discipline per session+account+list with confirmed-derived rollback views (`graph.ts:170-215`, queue key `180`).
- **Toggle queues / shadow / patching.** Per-(session, post, kind) queues using their own session's backend (`postActions.ts:89,96-103`); `latest-backend` refresh on reuse (`92-93`); `PartialToggleError` partial-apply handling (`176-237` reaction path, `queue.ts` semantics); confirmed-derived rollback views in graph toggles (`graph.ts:130-159`); base-guard `applyPostShadow` (`post-shadow.ts:179-249`); `patchPostInCaches` session-scoped (`patch.ts:118-119`).
- **Streaming.** `useFeedLive`/`useLiveNotifications` gated on `streaming === 'supported'` + handle + channel, effect-owned with account-keyed disposal (`streaming.ts:498-611,659-706`); arrivals buffer behind pill, dedupe by id, deleted-while-buffered filtered (`342-376,540-551`); per-post update coalescer (250 ms trailing, one in flight, stale-response skip, `962-1045`); gap-fill trims to first page then invalidates on reconnect (`870-945`); background suspend/resume via `monitorStreamAppState` (`768-821`); feed-level Mastodon delete fan-out (`169-191,382-384`).
- **Session store.** `resolveActiveId` never yields ghosts (`store.ts:200-208`); unknown-switch returns false (`859-866`); 401-clears / 403-keeps / network-keeps (`1089-1102`); idempotent permission-denial notes, Mastodon-excluded (`1161-1171`); referentially stable health snapshots (`1149-1159`); `revokeSessionToken` failure contained per family (`646-666`); per-origin token construction (`backendForSession`); envelope/mirror discipline (`initialize` `1044-1053`, `writeMirror` on every switch/sign-out).
- **Backend memo discipline.** `backendForSession` pooled by `sessionBackendKey` (token/flavor/evidence-qualified, `client.ts:221-267`), so store-snapshot churn (permission notes, health refreshes) does not rebuild backends or redial sockets; hooks memo on session object or snapshot accordingly (`me.ts:21`, `graph.ts:327`, `moderation.ts:140`, `adminReports.ts:117-122`, `HomeFeed.tsx:53-70`).
