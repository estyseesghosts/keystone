# Audit: sessions, query cache, post shadow (2026-10-25)

Scope: `src/state/session`, `src/state/queries`, `src/state/cache`, `src/state/streaming.ts`, the AGENTS.md architecture rules, and `lint-rules/`.
Source files were not modified. Every finding below was verified by reading the code. Nothing was executed except `eslint packages/fedi src --quiet`, which printed no violations.

## Summary

The basics are solid. Every query key I found starts with the session id. Per-session patching, per-session toggle queues and the `signed-out` key scope are all consistent. The fedi package is pure and the wire boundary holds.

The weaknesses are lifecycle gaps:
- Sign-out never clears the client data caches.
- A dead token mid-session is never detected after boot.
- Two optimistic-update paths can leave wrong UI state: concurrent post toggles, and live chat merges.

| # | Severity | Title |
|---|----------|-------|
| 1 | High | Sign-out and remove-account leave account data in memory and in the persisted query cache |
| 2 | Medium | `settleInto` applies the whole shadow, so a later failed toggle can never roll back in the UI |
| 3 | Medium | `mergeChatMessage` drops every page except the first |
| 4 | Medium | No runtime 401 handling; a dead token is only caught at boot |
| 5 | Medium | The token is stored in plaintext MMKV next to the vault copy |
| 6 | Low | `hydrate()` can resurrect a session removed during its awaits |
| 7 | Low | Removing the active account leaves the app signed out while other accounts exist |
| 8 | Low | The persisted cache includes DMs, chat and admin data, with no `dehydrate` filter |
| 9 | Low | Optimistic cache writes never cancel in-flight fetches |
| 10 | Low | `patchPost` leaves a deleted child in its wrapper posts |
| 11 | Low | `setListMember` is not serialized |
| 12 | Low | Lint-rule gaps |

## Findings

### 1. High: sign-out and remove leave data behind
Files: `src/state/session/store.ts:453-483` (`remove`, `signOutEverywhere`), `src/state/queries/Provider.tsx:60-76`, `src/state/cache/post-shadow.ts:112`.

`remove`, `signOut` and `signOutEverywhere` only touch the session envelope, the vault and the device mirror. The following are never cleared:
- The TanStack cache. There is no `removeQueries` or `clear` on sign-out anywhere in `src/`; the only `removeQueries` call is the post-delete one in `patch.ts:106`.
- `postShadowStore.clearSession`. It is defined but has zero non-test callers.
- The persisted cache, `keystone-query-cache` in MMKV. It is written by `persistQueryClient` with a 24h max age and the default dehydrate of everything.

Scenarios:
- After "Sign out everywhere", the timelines, notifications, DMs and profile data of every removed account stay in unencrypted MMKV for up to 24h. They are also restored on the next launch.
- The session id is `origin + accountId`, so signing back in to the same account within the cache lifetime shows the old cached feeds and notifications straight away.
- The cache is only a leak, not a cross-account display bug. Keys are session-scoped, and nothing reads a removed session's keys while another account is active.

Fix:
- Add an `onRemoved(id)` hook or subscriber. For a removed session id, call `queryClient.removeQueries({predicate: q => q.queryKey[0] === id})` and `postShadowStore.clearSession(id)`. On sign-out-everywhere, call `queryClient.clear()` and remove the persister key.
- Also cancel in-flight queries for that session and stop its streaming.

### 2. Medium: `settleInto` applies the whole shadow
File: `src/state/cache/postActions.ts:116-128`.

`settleInto(sessionId, post, kind)` reads the entire shadow for the post. It patches every cached copy with `applyPostShadow(p, shadow)`, which includes fields of other toggles still in flight. It then clears only `FIELD[kind]`.

Scenario (Mastodon):
1. The user boosts and then bookmarks a post quickly.
2. The boost lands first. `settleInto('renote')` writes `bookmarked:true`, still unconfirmed, into the caches.
3. The bookmark request fails. `onRollback` sets the shadow to `bookmarked:false` with `base.bookmarked=false`.
4. `applyPostShadow` guards on `server === base`. The cache copy now says true and the base says false, so the shadow is ignored.
5. The UI keeps showing "bookmarked", and the entry sticks because `settleInto` patches 0 queries. The user must refetch to see the truth.

Reaction plus renote on Misskey-family servers, and favourite, behave the same way.

Fix: have `settleInto` apply only the fields of `kind` (project the shadow through `FIELD[kind]` before applying). Add a test for two concurrent kinds with the second one failing.

### 3. Medium: `mergeChatMessage` truncates the thread
File: `src/state/queries/chat.ts:~280-291`.

The code is `const [first, ...rest] = data.pages ... return {pages: [{...first, items: [message, ...first.items]}], pageParams: data.pageParams}`. `rest` is destructured but never used, so every older page is discarded. `pageParams` keeps its full length, so `pages` and `pageParams` no longer match.

Scenario: the user scrolls up through history, loading 3 pages. A live message arrives over the `chatRoom` or `chatUser` stream. Pages 2 and 3 vanish, the list jumps, and the later refetch and `fetchNextPage` bookkeeping is inconsistent.

Fix: return `pages: [{...first, items: [message, ...first.items]}, ...rest]`. The test at `chat.test.tsx:196` only covers a single page; add a multi-page case.

### 4. Medium: no runtime 401 handling
Files: `src/Root.tsx:60-70`, `src/state/session/store.ts:512-543`.

`verifyActive()` runs once at boot. After that nothing maps a 401 from a query or mutation to `dropLocal`/`verifySession`; there is no `QueryCache` `onError` and no 401 check outside `store.ts`. `refreshActive` is an honest no-op.

Scenario: a token is revoked server-side while the app is running. Every query fails with a non-retryable 401 (retry policy `retry.ts`). The user stays "signed in" with empty or errored columns until the next restart. Inactive sessions are never verified at all.

Fix: add a global `QueryCache`/`MutationCache` `onError` that, on `ApiError` status 401 with the session id from the key, calls `store.verifySession(id)`. This is debounced per session and drops the session only if `me()` also returns 401.

### 5. Medium: token stored in plaintext MMKV
Files: `src/state/session/store.ts:421-443`, `src/storage/mmkv.ts:51` (`new MMKV({id:'keystone'})`, no `encryptionKey`).

`add()` calls `saveSession(storage, session)` first. The session includes `token`, so the bearer token is written to the unencrypted MMKV envelope. The SecureStore/vault copy is written afterwards. `hydrate` only overlays the vault value and never scrubs the envelope. The header comment presents the vault as the "OS-secured" copy. In practice a rooted or backed-up device exposes the token regardless.

Fix: store the envelope without tokens on native, or encrypt MMKV with a key held in SecureStore. If a plaintext copy is kept deliberately on web, document it and scrub it on native.

### 6. Low: `hydrate()` race
File: `src/state/session/store.ts:485-495`.

`hydrate` iterates `readSessions()` as it was before the loop, awaits `vault.getToken` for each, then calls `saveSession(storage, {...session, token})`. If `remove(id)` or `dropLocal(id)` runs during an await, `saveSession` re-inserts the stale session record. `saveSession` also moves it to the front of the list. A deleted account reappears with its old token.

The window is narrow and mostly at boot: `Root` awaits hydrate before `verifyActive`. `SessionProvider` also calls `hydrate()` in an effect, so it can run twice concurrently.

Fix: re-read the session right before each write and skip it if it is gone. Better, serialize hydrate and remove through a promise chain.

### 7. Low: no fallback after removing the active account
File: `src/state/session/store.ts:453-462`.

`removeSession` sets `active=null` when the removed id is active, and the mirror is nulled. `resolveActiveId` then returns null even though other sessions are stored. The app drops to signed-out and the user must pick another account. This is plausibly a product choice, but it is inconsistent with the "multi-account" intent.

Fix: on removing the active session, switch to the next stored session, or confirm that signed-out is intended and record it in DECISIONS.

### 8. Low: persisted cache is unfiltered
File: `src/state/queries/Provider.tsx:64-71`.

`persistQueryClient` is called with no `dehydrateOptions.shouldDehydrateQuery`. Conversations, chat messages, admin reports and insight are therefore serialized in plaintext to MMKV. `QUERY_BUSTER` is static (`keystone-queries-v1`), so a change in the shape of `Post` or `Account` can restore old-shape objects after an update.

Fix: persist only an allow-list of keys (feeds, `me`). Tie the buster to the app version or a schema constant.

### 9. Low: optimistic writes never cancel in-flight fetches
Files: `src/state/queries/graph.ts:107,143-148` (`setRel`), `src/state/streaming.ts:321,373`, `src/state/queries/composer.ts:71`. There is no `cancelQueries` anywhere.

A relationship fetch in flight when the user taps Follow or Mute overwrites the optimistic value with the pre-mutation server value. The UI flickers back until the settle-time `invalidate`. Post toggles avoid this because of the shadow store. The feed and notification live prepends have the same weakness, but the next fetch covers them.

Fix: `await qc.cancelQueries({queryKey: relationshipQueryKey(...)})` before `setRel`.

### 10. Low: delete leaves the post inside wrappers
File: `src/state/cache/patch.ts:26-35`.

When `fn` returns null for a nested `renote`, `quote` or `reply` child, the check `res !== null` skips the update. A pure boost row wrapping a deleted original remains in feeds until refetch. Own-post delete and a live `deleted` event both go through this path.

Fix: drop the row when a pure renote's original is removed. Show a "deleted" placeholder for quotes.

### 11. Low: `setListMember` is not serialized
File: `src/state/queries/graph.ts:222-250`.

It has no queue, unlike follow, mute and block. Two quick toggles of the same list capture `before` independently. If the first fails, it restores a stale `before` over the second's optimistic state.

### 12. Low: lint-rule gaps
Files: `lint-rules/no-ui-in-fedi.js:~38`, `lint-rules/no-wire-in-app.js:~16`, `eslint.config.mjs:24`.

- `BANNED_IMPORT` is `react-native($|/)`. I confirmed in node that `react-native-mmkv`, `@react-native-async-storage/*`, `@expo/*` and `@tanstack/react-query` all pass. Anything starting `react-native-` or `@expo/` is allowed into `packages/fedi`.
- `eslint.config.mjs:24` lints `packages/fedi/**/*.ts` only, so `.tsx` files are not covered.
- `no-wire-in-app` only matches a literal `wire` path segment. The deep-import `@keystone/fedi/mastodon/client` or `.../adapt` would pass. Today `src/` has no `@keystone/fedi/<subpath>` imports, so this is a latent gap.
- The barrel `packages/fedi/src/index.ts` exports `MastoClient`, `MastoHttpError` and `adaptStatus`-style adapters. These are not wire types, but a restricted-imports list for `src/` would stop them being used there. `src/` does not use them now.
- `eslint packages/fedi src --quiet` produced no output (no violations).

## Looked solid

- **Query keys.** `createQueryKey` throws on an empty session id. Every key I inspected starts with the session id: feed, post, thread, account, notifications, me, chat, conversations, composer, graph, moderation, recommendations and admin. Signed-out cases use the `signed-out` scope with `enabled:false`.
- **Cache patching.** `patchPostInCaches` requires a session id and skips any query where `queryKey[0] !== sessionId`. Streaming ingest, `insertCreatedPost`, `prependLivePosts` and the notification ingest all use the session-scoped key or prefix.
- **Post shadow.** Keys are `sessionId\0postId`. The base guard (server wins once fresh data differs) is sound for a single toggle, and `clearSession` exists. The only defect is item 2.
- **Toggle queues.**
  - Post-action queues are keyed per session, post and kind, and use the backend of their own session.
  - `createToggleQueue` coalesces, runs at most one request at a time, rolls back to the last confirmed value, and handles partial success via `PartialToggleError`.
  - Graph toggles derive their rollback from a confirmed relationship.
  - `refuse()` gates every action on capabilities.
- **Pagination dedupe.** `feedItems`, `notificationsItems`, `chatMessageItems`, `chatRoomItems` and `conversationItems` dedupe by id. The live prepends dedupe against the whole cached query.
- **Session store.**
  - Active-id resolution never produces a ghost session.
  - `switch` of an unknown id returns false.
  - A 401 clears the session, a 403 and network errors never do.
  - `notePermissionDenied` is idempotent and Mastodon-aware.
  - `scopeHealthSnapshot` is referentially stable between emits.
  - `revokeSessionToken` never throws.
  - Tokens are per origin, built from the session in `backendForSession`.
  - `refreshActive` is honestly unsupported.
- **Retry policy.** It does not retry 401, 403, 404, 410, 422 or 429.
- **Architecture rules.**
  - No `react`, `react-native`, `expo` or `#/` imports in `packages/fedi`.
  - No wire imports in `src/`.
  - The rule tests exist for all three rules, with evasion cases covered for wire path segments and for global-name false positives.
  - The browser-global seam allowlist is narrow.

## Notes

`packages/fedi/src/zz_audit_tmp.test.ts` is an untracked file, apparently another auditor's scratch file. It is not part of the repo and should be deleted before commit.
