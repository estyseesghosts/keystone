# Misskey / Sharkey audit (2026-10-25)

Scope: `packages/fedi/src/misskey/*`, Misskey-related parts of `core/{detect,sessions,models}`, MFM parser, and the UI call sites that consume them. Read-only; no source modified. Only issues confirmed by reading code are listed as findings. Where a finding depends on upstream server behavior that is not in this repo, that is stated.

## Summary

- M5 (`notes/edit` wrong param) and M7 (revoke) were confirmed against local Sharkey source at /Users/terezi/Local Documents/fedifedifedi/. M1 also confirmed: `users/followers.ts` packs via `packMany(... populateFollower)` and `mute/list.ts` via `mutingEntityService.packMany`.
- Highest-impact bug: the four account-list endpoints (`users/followers`, `users/following`, `mute/list`, `blocking/list`) are adapted as if they return bare `UserLite[]`. Upstream returns wrapper rows (`Following{follower|followee}`, `Muting{mutee}`, `Blocking{blockee}`). `renote-mute/list` in the same package already unwraps correctly and its comment says as much. Tests only use bare users, so nothing caught it.
- `users/search` accounts paging emits a cursor the request never consumes (repeat-page loop).
- `reactions.entries[].url` is looked up by exact reaction key although this repo's own docs say packed maps are keyed by bare `name@host`; UI shadow logic then treats real custom reactions as "unknown emoji".
- Capabilities: stock Misskey flavor claims `status_editing: supported`, contradicted by the repo's own task doc (upstream has no `notes/edit`).
- Auth: MiAuth session ids fall back to `Math.random`; sign-out token revocation sends no `token`/`tokenId`.
- Streaming, transport (`i` in body, 204 handling, cross-origin guard), note body builders and MFM sanitising are in good shape.
- Fixtures are all `source: synthesised` (manifest) and encode the same assumptions the code makes, so they cannot catch wire-shape errors (findings 1, 3).

## Findings

### M1 (High) Follower/following/mute/block lists adapt wrapper rows as bare users
- `packages/fedi/src/misskey/backend.ts:557,561,660,664` -> `listAccounts` at `backend.ts:~985` calls `pageOf(rows, limit, adaptAccount)` on `UserLite[]`. Same in `misskey/mutes.ts:47-61` (`listBlocks`, `listMutes`, exported from `src/index.ts:43`).
- Description: Misskey/Sharkey `users/followers` and `users/following` return Following rows (`{id, createdAt, followerId, follower}` / `{followee}`), `mute/list` returns Muting rows (`mutee`), `blocking/list` Blocking rows (`blockee`). `adaptAccount(row)` reads `row.username`/`row.id` of the wrapper. `renoteMutes.ts:1-33` handles this correctly for `renote-mute/list`, which shows the authors knew the shape. `docs/api-surface.md:88,92` states `UserLite[]` (incorrect).
- Scenario: open Followers/Following/Muted/Blocked screens on a real Misskey/Sharkey server: `username` undefined -> `acct` "undefined", `displayName` undefined, `id` is the follow-row id (so follow/unfollow/mute actions on the row target a nonexistent user id).
- Tests: `test/misskey-w8-modules.test.ts:560-567` only asserts the request params for `listBlocks/listMutes` with a stub returning `undefined`; no test feeds wrapper rows. `misskey-backend.test.ts` has no followers/following test.
- Fix: unwrap per endpoint (`follower`/`followee`/`mutee`/`blockee`), skip rows without a string-id user (same guard as `renoteMutes.ts`), keep the row id as the paging cursor (untilId is the row id, so `pageOf` on rows is correct; map after). Add wrapper-row tests and fix `docs/api-surface.md`. Delete or reuse the dead `mutes.ts` list helpers.

### M2 (Medium) Account search paging cursor is never consumed
- `backend.ts:755-767` (`search.accounts`) and `769-777` (`suggestAccounts`).
- Description: both call `users/search {query, limit}` ignoring `opts.cursor`, but `pageOf` returns a cursor (`untilId` of last row) and `end=false` when the page is full. `users/search` pages by `offset`, not `untilId`.
- Scenario: a search with >=20 hits; infinite scroll requests page 2 with the cursor, backend re-sends the identical first page; list shows duplicates or loops on `fetchNextPage`.
- Fix: use `offset` (encode offset in cursor) or return `end: true`/cursor null until offset paging is wired.

### M3 (Medium) Reaction emoji URL lookup uses exact key; docs say maps are keyed bare
- `misskey/adapt.ts:271` `url: urls[key] ?? null`, `adapt.ts:264`. Contrast `api/emoji.ts:121-170` ("packed maps are keyed by the BARE inner `name@host`... verified live on Sharkey") and its tolerant `lookupPackedEmojis`.
- Description: reaction keys are `:name@.:` / `:name@host:`; `reactionEmojis` per the repo's own live-verified comment is `name` / `name@host`. Fixtures (`test/fixtures/misskey/note.json:26`, `sharkey/note.json:28`) use colon-wrapped keys, which contradicts that comment and hides the miss (manifest says fixtures are synthesised, not recorded).
- Consumer impact: `ReactionChips` uses `lookupPackedEmojis` and recovers. But `src/state/cache/postActions.ts:150-156` and `:208-213` test `post.reactions.urls[v]` / `entries.find(e => e.key===v)?.url` exactly, so a custom reaction coming back from the server is treated as unresolved (`pendingEmoji` set) after a like/react round trip.
- Fix: resolve `url` in `adaptReactions` via `lookupPackedEmojis(urls, key)` (core-side helper) and make `postActions` use the same lookup. Record a real fixture to replace the synthesised one.

### M4 (Medium) Stock Misskey flagged `status_editing: supported`
- `core/detect.ts:~313-316` (misskey row). `docs/tasks/p6.1-history-redraft-media.md:30` says "upstream has no `notes/edit.ts`", Sharkey does.
- Scenario: on stock Misskey the Edit menu is offered; `notes/edit` 404s. `editNote` documents the 404 -> redraft path, so it degrades, but capability gating is meant to hide unsupported actions (AGENTS.md section 6), not rely on a failing call. Same question for `scheduled_posts`/`server_drafts` on the plain `misskey` row (verify against the targeted upstream version).
- Fix: mark `unknown` for flavor `misskey`, raise via evidence (e.g. version/endpoint probe) or keep `supported` only for sharkey/catodon.

### M5 (High, CONFIRMED against local Sharkey source) `notes/edit` uses `editId` and returns `{createdNote}`
- `misskey/noteEdit.ts:44-46`, `noteBody.ts:createEditNoteBody`.
- Description: edit sends `{noteId, ...}` and adapts the response as a bare `Note`, whereas `notes/create` is `{createdNote}` (backend.ts createPost). Tests stub a bare note (`misskey-backend.test.ts:185-215`, `misskey-w8-modules.test.ts:616-640`), so they cannot detect a mismatch. Verified in `/Users/terezi/Local Documents/fedifedifedi/Sharkey/packages/backend/src/server/api/endpoints/notes/edit.ts` (lines 138, 208, 406, 430): the param is `editId` (error 'You need to specify `editId`'), `noteId` is not a param, and the response is `{createdNote}`. So every edit sends the wrong field and would adapt `{createdNote}` as a Note (crash at `adaptAccount(note.user)`). Same checkout exists for catodon and dvd-sharkey.
- Fix: verify against a live Sharkey (scripts/fedi-smoke) and record a fixture; tolerate both `{createdNote}` and bare note.

### M6 (Medium) Edit cannot remove all attachments or clear a poll
- `misskey/noteBody.ts:createEditNoteBody` (the `fileIds` and `poll` spreads).
- Description: text/cw clear via explicit null, but `fileIds` is omitted when empty and `poll` omitted when absent. If the server treats omission as "unchanged", removing the last attachment (or a poll) in an edit is silently ignored. Inconsistent with the "explicit null clears" rule used for text/cw.
- Fix: confirm server semantics; send `fileIds: []`/`null` as the edit endpoint requires when the original had files.

### M7 (High, CONFIRMED against local Sharkey source) Sign-out token revocation is a no-op on Sharkey
- `core/sessions.ts:609-614`, `misskey/external.ts:390`.
- Description: both POST `i/revoke-token` with only the credential `i`. Sharkey `i/revoke-token.ts` (lines 27-33, 45, 58) requires `anyOf [tokenId | token]` and deletes only in those branches; `i` alone is rejected or does nothing. Failures and non-2xx are swallowed and the function returns `true` (`sessions.ts:~620`), so the UI and tests believe revocation was issued.
- Fix: send `{ token: session.token }` explicitly (plus `i`), check `response.ok`, return false otherwise.

### M8 (Medium) MiAuth session ids may come from `Math.random`
- `misskey/auth.ts:64-69` (`newSessionId`), `misskey/external.ts:126-131` (`newExternalSessionId`).
- Description: the MiAuth session id is the only secret between approval and `miauth/<id>/check`; whoever knows it can fetch the token once approved. Fallback is `Date.now()` + `Math.random()` when `crypto.randomUUID` is missing (Hermes/RN has no `crypto.randomUUID` without a polyfill, so the fallback may be the common path on device).
- Fix: use `expo-crypto` `randomUUID`/`getRandomBytes`, and fail rather than fall back to `Math.random`.

### M9 (Low) `http://` accepted for any external host
- `misskey/external.ts:82-100` (`normalizeHost`). Explicit `http://example.com` is honored, so tokens (`i` in body, `?i=` for streaming) travel in cleartext to a public host. Restrict `http` to localhost/RFC1918/`.local` or require explicit confirmation.

### M10 (Low) `isPureRenote` throws if `fileIds` is absent
- `misskey/wire.ts:426` `note.fileIds.length`, while `adapt.ts` itself uses `note.fileIds ?? []` (and the draft adapter passes `raw.fileIds` unguarded). `adaptNote` calls `isPureRenote` on every note, including streamed events (`stream.ts` `isNoteLike` only checks `id`). A fork/partial pack without `fileIds` crashes adaptation. Same family: `adaptNote(note.user)` with no `user`, `adaptNote(row.note)` for favorites (`favorites.ts:43`), `countServerDrafts` `res.count` on empty body (`serverDrafts.ts:45`).
- Fix: `(note.fileIds ?? []).length`; skip favorite rows without a note; guard `res?.count`.

### M11 (Low) Quote resolver: rejected lookups stick forever
- `misskey/quote.ts:355-375`. `adaptNote(raw)` runs inside the `.then` success handler; if it throws, the second `then` argument does not catch it, `inflightLookups.delete` is skipped, and the stored rejected promise is returned for every later `resolveQuoteUri(uri)` call (no TTL). `failedAt` is also unbounded (no `evictOldest`). Fix: use `.then(...).catch(...)`/try-finally; cap `failedAt`.

### M12 (Low) Stream handler exceptions abort other handlers
- `misskey/stream.ts` channel dispatch loop (`for (const h of sub.handlers) h.onEvent?.(...)`) has no try/catch (unlike `noteUpdated`, which does). `subscribeTimeline` calls `adaptNote(body)` on any object with a string `id`; a malformed event throws out of the WebSocket message listener. Wrap in try/catch and validate `user`.

### M13 (Low) Stream: unavailable subscriptions never recover; status reset oddities
- `stream.ts` `armAckTimeout` sets `unavailable` once and nothing retries; a later `connected` does flip it back, but a missed ack (dropped message) leaves the feed without a retry/connect resend. `release()` sets pool status to `connecting` with no socket, so a UI keyed on status shows "connecting" for an idle pool. No heartbeat/stale detection for half-open sockets (only close events).

### M14 (Low) `movedTo` never mapped
- `misskey/adapt.ts:115` hard-codes `movedTo: null`; the wire type has no `movedTo`, so account-migration banners never appear for Misskey accounts although the server packs `movedTo` (URI). Also `alsoKnownAs` is only in the `MeDetailed` ext bag.

### M15 (Low) Pagination `end` heuristic
- `adapt.ts:pageOf` marks `end = items.length < limit`. Endpoints that post-filter (Sharkey mutes/hidden, `notes/search` via Meilisearch, `users/notes` with filters) can legitimately return short pages while more exist, ending infinite scroll early. Consider treating only an empty page as `end`.

### M16 (Info) Poll `expired` is frozen at adapt time
- `adapt.ts:adaptPoll` (`now = Date.now()`); cached posts keep `expired: false` after the deadline until refetched. Compute at render or on shadow.

### M17 (Info) MFM `fn` coverage and `like` capability inconsistency
- `core/content/fromMfm.ts` `KNOWN_FN` omits several upstream functions (`ruby`, `unixtime`, `sparkle`, `jump`, `twitch`, `flip`, `fg`, `border`, `position`, `crop`, `mirror`); they degrade to children (safe, but `ruby`/`unixtime` lose information).
- `detect.ts` misskey row `like: "unsupported"` while `backend.like.isSupported()` probes lazily and the comment in `backend.ts` says flavor labels must not seed support. If the UI gates on the capability, a backported `notes/like` is never probed.

## Test and fixture gaps

- No test feeds wrapper rows for followers/following/mutes/blocks (M1).
- No test for `users/search` paging with a cursor (M2).
- All misskey/sharkey fixtures are `source: synthesised` (`test/fixtures/manifest.json`); reaction-key shapes and `notes/edit` response are unverified (M3, M5).
- No unit test for `signinFlow`/`mintAppToken` error branches beyond the happy path in `misskey-w8-modules.test.ts`; none for `normalizeHost` http handling of public hosts; none for revoke body contents against the server contract (the test pins `{i}` only, which encodes the questionable behavior, M7).
- No stream test for malformed `note` events (M12) or ack-timeout recovery (M13).
- Quote resolver: no test for adapt failure inside `ap/show` (M11).

## Things that looked solid

- Transport (`misskey/client.ts`): session-bound; origin guard before I/O; `i` only added for body-i flavors; caller-supplied `i` wins (gen-token); 204/empty tolerated via text-first parse in `core/http.ts:300`; multipart upload omits null/empty `folderId`; permission-denied observer is guarded and ignores unauthenticated calls.
- Omit-but-never-null body builders (`noteBody.ts`, `antennas.ts`, `drive.ts`, `updateProfile`) are consistent and tested; `createNoteBody` pins visibility `raw` round-trip and `specified` + `visibleUserIds`.
- Visibility mapping never rounds unknown values up to `public` (`core/models.ts:visibilityKindOf`); `localOnly` kept separate.
- Pure-renote vs quote logic is consistent between wire and core; `quote.ts` textual `RE:` fallback is narrow and structured-wins; resolver caches are per-backend (no cross-session leak).
- Thread ancestor walk is cycle/offset-ignoring safe and bounded (`backend.ts thread`, `thread.ts`).
- Streaming: correct channel names and params (`homeTimeline`, `hybridTimeline`, `antenna{antennaId}`, `userList{listId}`, `channel{channelId}`, `hashtag{q:[[tag]]}`, `main`, `chatRoom{roomId}`, `chatUser{otherId}`), per-session pool and origin-derived ws/wss URL, backoff + quick-close fast-fail, refcounted `subNote`, resubscribe on reconnect.
- `votePoll` reports partial multi-choice failures honestly; `noteReactions` and `renoteMutes` skip rows with deleted users.
- MFM -> AST: allow-listed, `safeUrl` on links, hashtag/matrix/mention link-label hardening, remote emoji codes split, never throws; `fnStyle.ts` allow-lists colors (`#hex` only) and fonts, clamps numerics.
- Notification type mapping is explicit with a safe `unknown` fallback; `scheduledNoteFailed` spelling alias handled; includeTypes mapping handles `achievement`.
- Translator/like/remote-post caches are instance-owned with TTL on failures.
