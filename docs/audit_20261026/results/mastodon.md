# Mastodon adapter audit — Keystone v2 (2026-10-26)

Scope: ALL of `packages/fedi/src/mastodon/` — `backend.ts`, `endpoints.ts`, `adapt.ts`, `oauth.ts`, `stream.ts`, `pagination.ts`, `client.ts`, `compose.ts`, `wire.ts`, `instance.ts`, `admin.ts`, `auth.ts`, `conversations.ts`, `domainBlocks.ts`, `filters.ts`, `listMembership.ts`, `lists.ts`, `notificationRequests.ts`, `presentation.ts`, `quoteMarker.ts`, `statusActions.ts`, `tags.ts`, `thread.ts` — plus the capability rows in `packages/fedi/src/core/detect.ts` and the `PostDraft`/`UploadMediaOpts` shapes in `packages/fedi/src/core/backend.ts` where the adapter consumes them.

Method: static code reading, full file reads of every adapter module, verified with grep. No server, no device, no Mastodon/Misskey source checkout in the repo. Any claim about upstream Mastodon behavior is marked **recalled, needs live check**. Read-only audit: no source modified.

## Summary

The adapter is in strong shape. Of the 22 findings in the 2026-10-25 audit, roughly two-thirds are fixed and verified in code: `resolve=true` search wiring, pinned posts on vanilla Mastodon, `polls_multi`, hidden-total poll rendering, lists-timeline cursors, `instanceof DOMException`, secure-random plumbing, pagination comma-splitting, family detection without NodeInfo, poll-expiry clamp, poll-option emojis, stream delete fan-out, and notification read-state derivation are all landed. What remains is one genuine retry-safety gap (idempotency keys still minted per call with the stable-key helpers unwired), one batch of unguarded adapt calls on secondary listing paths, one recalled streaming-auth claim that still needs a live check, and a tail of low-severity hygiene issues.

| # | Severity | Finding |
|---|---|---|
| 1 | Medium | `createPost` / `scheduled.create` mint a fresh Idempotency-Key per call; the stable-key helpers exist but have no production caller, so retries can double-post. |
| 2 | Medium | One malformed row still fails the whole page on five paths: status context, trending statuses, all account lists, suggestions, and flat v1 notifications. |
| 3 | Medium (recalled, needs live check) | Streaming still offers `["Bearer", token]` as subprotocols; code unchanged since the 10-25 verified-reject claim. |
| 4 | Low | `dismissNotification` double-404 (already-gone vs unsupported) is indistinguishable by status alone. |
| 5 | Low | `quoteLookups` cache is unbounded, embeds the token in its key, and caches hits forever. |
| 6 | Low | Caller `signal` is silently dropped by conversations, domain blocks, and followed-tags reads. |
| 7 | Low | Token revocation can target the wrong app identity after a scope-change re-registration. |
| 8 | Low | `markerCoversId` same-length rule leaves old (shorter-id) rows permanently `read: null` under a newer marker. |
| 9 | Low | Remaining placeholder/silent-drop values: `scheduledAt: ""`, announcement `createdAt: ""`, dropped `isSensitive`, domain-block end on filtered length, silent poll-expiry extension. |
| 10 | Low | Unknown notification types and static-avatar preference are unchanged (by-design / needs-owner-decision). |

## Findings

### 1. Medium: Idempotency-Key is still per-call; the stable-key helpers are dead code in production

- Files: `packages/fedi/src/mastodon/backend.ts:609-615` (`createPost` calls `newIdempotencyKey()` on every invocation), `packages/fedi/src/mastodon/backend.ts:1656-1663` (`scheduled.create` does the same at `:1662`), `packages/fedi/src/mastodon/compose.ts:200-208` (`attemptKeyFor`), `packages/fedi/src/mastodon/compose.ts:224-235` (`stableIdempotencyKey`), `packages/fedi/src/mastodon/compose.ts:239-242` (`attemptKeyForBody`).
- The backend imports only `newIdempotencyKey` (`backend.ts:169`). A grep over `src/` confirms `stableIdempotencyKey` / `attemptKeyForBody` / `attemptKeyFor` have zero callers outside tests. The comment at `compose.ts:210-214` admits this ("The backend still mints per call today").
- Scenario: a post times out on a flaky connection; the user taps Post again. The server sees a new key and creates a duplicate. Same for a scheduled post.
- Sub-issue: the stable cache's bound is porous anyway — `compose.ts:227-231` purges only expired entries once `size > 500`, so a burst of 500+ unexpired fingerprints grows without bound.
- Fix: thread the key through `Backend.createPost` (optional key param or composer-owned `AttemptKey` via `attemptKeyForBody`), same for `scheduled.create`.

### 2. Medium: five listing/detail paths still fail the whole page on one malformed row

- Files: `packages/fedi/src/mastodon/endpoints.ts:392-395` (`getStatusContext` maps `adaptStatus` over ancestors/descendants with no `isStatusRow` guard), `packages/fedi/src/mastodon/endpoints.ts:588` (`fetchTrendingStatuses`: `res.data.map(adaptStatus)`), `packages/fedi/src/mastodon/endpoints.ts:796` (`accountListPage`: `res.data.map(adaptAccount)` — covers followers, following, mutes, blocks, follow requests, `reblogged_by`/`favourited_by`), `packages/fedi/src/mastodon/endpoints.ts:657-662` (`fetchSuggestions` checks `row.account` and `"id" in row.account` but not `acct`, which `adaptAccount` dereferences unconditionally at `packages/fedi/src/mastodon/adapt.ts:219`), `packages/fedi/src/mastodon/adapt.ts:860-883` (`adaptNotification` adapts `item.account` at `:862` and `item.status` at `:879` with no row guards — unlike the v2 path at `:752-758` — and the backend maps it directly at `packages/fedi/src/mastodon/backend.ts:1268`).
- The primary paths were fixed (timeline `endpoints.ts:140-147`, `statusPage` `:302-309`, search `:495-509`, lists/bookmarks `backend.ts:1566-1572,1627-1633`), which makes these five the remainder: one bad status/account from a fork fails a thread view, Explore posts, any account list, suggestions, or the whole flat notification page.
- Fix: apply the same skip-and-count (`isStatusRow`/`isAccountRow` + `noteSkippedRow`) discipline on all five paths.

### 3. Medium (recalled, needs live check): streaming auth still sends `["Bearer", token]`

- Files: `packages/fedi/src/mastodon/stream.ts:260-263` (`const protocols = token ? ["Bearer", token] : undefined`), header comment `:17-20` and factory comment `:54-56` claiming both Mastodon and Akkoma accept the pair.
- The 10-25 audit claimed a local Mastodon checkout reads the whole `sec-websocket-protocol` value as the token and rejects the handshake. That checkout is not in this repo, so this is **recalled, needs live check** — but the code is byte-identical to what was flagged, and no fallback (bare-token subprotocol or `?access_token=`) was added.
- If the recollection is right, every Mastodon session fails to stream, trips the 5-fast-close breaker (`stream.ts:401-409`), and shows "stopped" while feeds silently fall back to polling.
- Fix: confirm against a live server or checkout; if confirmed, send the bare token as the only subprotocol for Mastodon and keep the pair only where proven.

### 4. Low: dismiss fallthrough leaves "already gone" and "unsupported" indistinguishable

- Files: `packages/fedi/src/mastodon/backend.ts:1297-1312` (v1 dismiss, on 404/405-only fall through to v2 group DELETE; a 404 from both propagates), `packages/fedi/src/mastodon/client.ts:134-160` (`toApiError` maps both to `ApiError` status 404, code `errors.network.apiError`).
- The comment at `backend.ts:1302-1303` claims a double-404 is "the row already gone (surfaced, never unsupported)", but nothing distinguishes it from a genuinely unsupported route: same status, same code. Whether the Dismiss control wrongly hides itself now depends entirely on app-layer narrowing outside this scope.
- Fix: give the double-404 its own code (e.g. `errors.shape.noNotificationFound`) so callers can separate "gone" from "unsupported" without sniffing.

### 5. Low: `resolveQuoteUri` cache never evicts hits and retains tokens in memory

- Files: `packages/fedi/src/mastodon/backend.ts:1780-1814` — module-level `quoteLookups` map (`:1781`), key embeds origin + raw token + uri (`:1784`), hits (`missedAt === null`) return forever (`:1785-1788`), misses expire after 90 s (`:1805,1808`), entries are only ever `set` (`:1812`): no size bound, no TTL for hits, no test hook, no clearing on session revoke.
- Consequences: unbounded growth across a long session, a resolved-once quote never revalidates (edited/deleted target stays rendered), and live tokens sit in map keys until process death.
- Quote-resolution duplication was investigated and is NOT a finding: textual `RE:` resolution goes through this cache while shallow-nested `ext.quoteRef` (`adapt.ts:425-427,549`) resolves by id through the app's `resolveQuoteById` path — separate mechanisms, no double-fetch of the same target in the adapter.
- Fix: bound the map (LRU or cap + sweep), expire hits (e.g. 5 min), and hash or drop the token from the key.

### 6. Low: `signal` is accepted and then silently dropped on three reads

- Files: `packages/fedi/src/mastodon/conversations.ts:74-77` (`ConversationPageOptions` has no `signal`), `:89-101` (`fetchConversationsPage` calls `client.get` without one), `:124-150` (`fetchConversation` scan takes no signal at all); `packages/fedi/src/mastodon/domainBlocks.ts:32-50` (same: no `signal` field, `client.get` without); `packages/fedi/src/mastodon/tags.ts:42-45,129-150` (`TagPageOptions`/`tagListPage`, same).
- The backend passes `PageOpts` (which carries `signal`) straight into signatures that ignore it: `backend.ts:1196-1198` (conversations list via `pageOpts`), `:1199-1201` (`get`), `:926-936` (domain blocks), `:1075-1086` (followed tags). Contrast lists timeline and bookmarks, which forward `{ signal: opts.signal }` (`backend.ts:1562,1623`).
- Effect: unmount/account-switch cancellation never reaches these reads; they resolve late and can paint stale data. No crash, just wasted work and a staleness window.
- Fix: add `signal` to the three options types and forward it to `client.get`, as the sibling listings do.

### 7. Low: revocation may use the wrong app identity after a scope-change re-registration

- Files: `packages/fedi/src/mastodon/oauth.ts:286-311` (`getCachedApp` binds on exact scope string; `cacheApp` overwrites the single row per origin at `:307-311`), `:520-529` (re-registration after scope change replaces the cached `client_id`/`client_secret`), `:915-934` (`revokeToken` sends whatever app it is handed and swallows all failures), `packages/fedi/src/core/sessions.ts:811-817` (revocation reads the single current row).
- Unchanged since 10-25 (prior #19): a token minted under the old `client_id` is revoked with the new credentials, the server refuses, the `catch {}` eats it, and the old token stays valid server-side while local state clears.
- Fix: keep prior app credentials until their tokens are revoked, or surface revocation failure instead of swallowing when the credential identity changed.

### 8. Low: `markerCoversId` same-length rule strands old rows as unread forever

- Files: `packages/fedi/src/mastodon/adapt.ts:849-858` (returns `null` unless both ids are all-digit and equal length), consumed at `packages/fedi/src/mastodon/backend.ts:525-533` (`deriveNotificationRead` leaves `read` as-is on `null`).
- Mastodon snowflake ids grow in digit length over the years. Once the marker id is longer than an old row's id, the comparison answers "unknown" — so pre-growth rows keep `read: null`, the unread counter (`read === false`) never counts them, and "mark read" has no visible effect on them.
- Fix: treat a strictly-longer all-digit marker as covering shorter all-digit rows (length-major ordering is chronological for same-epoch snowflakes), or fall back to `createdAt` comparison when lengths differ.

### 9. Low: remaining placeholder values and silent drops

- `packages/fedi/src/mastodon/backend.ts:1670` — `scheduled.create` answers `scheduledAt: ... ?? draft.scheduledAt ?? ""`. When the server omits `scheduled_at`, the row carries `""`, a fabricated timestamp. Fix: type it `string | null` and pass `null` through.
- `packages/fedi/src/mastodon/adapt.ts:631` — announcements without `published_at` read `createdAt: ""` (comment at `:622-624` calls it deliberate). Same fabrication class; prefer `null` and let the list screen sort nulls last.
- `packages/fedi/src/mastodon/backend.ts:1337-1393` — `uploadMedia` never reads `opts.isSensitive` (only `opts.comment` at `:1361`) and adapts the result with `false` at `:1392`, while `UploadMediaOpts.isSensitive` (`core/backend.ts:136`) invites callers to set it. Status-level `sensitive` on the draft is the documented path, but the accepted-and-dropped flag is a silent lie. Fix: either honor it (fail loudly — the family has no per-file flag) or remove it from the accepted options on this family.
- `packages/fedi/src/mastodon/domainBlocks.ts:67-75` — `end` is computed from the *filtered* `domains.length`, so a page of only invalid entries ends the listing early despite a live next link. Fix: `end` on `res.data.length === 0`, as the sibling listings do.
- `packages/fedi/src/mastodon/compose.ts:162-167` — poll expiry clamps to a 300 s floor silently (`Math.max(300, raw)`). The server minimum is **recalled, needs live check**; if a caller asked for 60 s, the adapter ships 300 s without telling anyone. Prefer a typed validation error surfaced to the composer over a silent rewrite.

### 10. Low: unchanged by-design rows (no action, recorded for continuity)

- Unknown notification types (`status` → `note`, everything else → `unknown` with `rawType` kept, `packages/fedi/src/mastodon/adapt.ts:645-661`) still render as generic rows. Account-less types (`severed_relationships`, `moderation_warning`) yield `actors: []`. This matches the documented "no invented kind" rule; any widening belongs to `core/models.ts` (X4.2 owns it). Notification requests/policy are now probed and wired (`notificationRequests.ts`, `backend.ts:391-395,1324`), closing the visibility half of the old finding.
- Static avatar/header preference (`adapt.ts:242,244`: `avatar_static ?? avatar`) still means animated avatars never animate. Same as 10-25 #21: needs an owner decision, not an audit verdict.
- Single-tag timeline fetch, viewer-only featured tags, no scheduled-status edit, and `favourited_by` unsurfaced (old #22) are all still true and still low.

## Looked solid

- **Origin safety.** `request()` resolves absolute URLs through `resolveSameOriginUrl` before attaching `Authorization`, and cross-origin Link URLs degrade to cursor carryover (`client.ts:271-299`, `pagination.ts:147-166`). Streaming origin is scheme-pinned plus host-validated (`instance.ts:125-182`, `stream.ts:103-139`).
- **Transport.** Text-before-JSON parsing, 202/204/206 tolerance, redirect refusal with credentials, timeout vs abort separation via name-check (no `instanceof DOMException` anywhere — `client.ts:385-389`, `endpoints.ts:1511-1515`), 429 metadata preserved (`client.ts:231-243`, `44-50`).
- **Secure randomness.** All security paths go through `core/random.ts:27-46`, which throws `errors.crypto.unavailable` with no `Math.random` fallback; native installs expo-crypto at boot (`src/platform/polyfills.ts:14-25`); PKCE keeps a pure-TS SHA-256 backstop (`oauth.ts:553-634`).
- **Search resolution.** `resolve=true` now rides authenticated URL/handle-shape queries for posts and accounts (`backend.ts:425-434,954-993`, `endpoints.ts:429-454`), while `@` autocomplete stays local (`backend.ts:986-993`). Quote resolution uses strict URI match (`quoteMarker.ts:301-312`, `backend.ts:1793-1811`).
- **Capabilities.** Mastodon rows now enable `polls_multi` (`core/detect.ts:482`), `polls_hide_totals` (`:486`), list policy + exclusive (`:507-508`); Akkoma/Pleroma stay honestly unknown where unverified. Drafts carry `sensitive`/`language` end to end (`core/backend.ts:286-293`, `compose.ts:139-155`). Featured-posts gate admits mastodon/akkoma/pleroma (`backend.ts:466-481`).
- **Polls.** Null `votes_count` passes through as null (no fake zeros, `adapt.ts:334-348`), poll emojis merge into the shared emoji map (`adapt.ts:490-493`), expiry floor backstops at the wire layer (`compose.ts:162-167`).
- **Notifications.** v1-then-v2 dismiss routing without key sniffing (`backend.ts:1297-1312`), markers-derived read state with abort/auth propagation (`backend.ts:496-533`), grouped-row adaptation preserving counts and positions (`adapt.ts:783-839`), probed (never flavor-guessed) requests/policy support (`notificationRequests.ts:53-83`, `backend.ts:391-395`).
- **Paging.** Regex-based Link parsing (no comma split, `pagination.ts:36-51`), opaque cursors, end-on-no-link-or-empty everywhere, lists-timeline cursors continuation honored (`backend.ts:1549-1561`).
- **Detection.** v2-shape fallback when NodeInfo is blocked (`instance.ts:401-412`), substring + shape + NodeInfo family detection (`instance.ts:210-240`), per-flavor scope strings keeping the authorize URL under the 502 guard (`oauth.ts:219-222`).
- **Streaming.** Pooled per-(stream, params) sockets, lazy dial, bounded backoff, fast-close breaker, ack watchdog, feed-level delete fan-out with `onDeletes` (`stream.ts:204-223,382-425,501-529,747-752`).
- **Threads/quotes.** Cycle-safe rebuild (`thread.ts:60-137`), dual-shape quote handling with shallow-nested `quoteRef` for lazy fetch (`adapt.ts:412-446`), strict textual-marker parsing (`quoteMarker.ts`).
- **OAuth.** Confidential-client exchange, one-shot state, 15-minute pending expiry, verify-before-store, scope-shaped-only registration fallback, app-secret vault split (`oauth.ts:461-530,636-713,746-767,915-934`).
- **Filters/lists/admin.** v2-first-with-v1-fallback filters, capability-gated list bodies, skip-and-count on the hot listing paths, admin read-only + reports queue with no faked notes/history (`filters.ts:88-101`, `lists.ts:41-53`, `admin.ts:300-343,450-482`).
