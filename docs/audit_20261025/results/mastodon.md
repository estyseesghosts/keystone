# Mastodon-family audit (2026-10-25)

Scope: `packages/fedi/src/mastodon/*` (client, oauth, auth, pagination, stream, adapt, wire, endpoints, backend, compose, statusActions, instance, filters, lists, tags, conversations, domainBlocks, thread), the Mastodon rows of `packages/fedi/src/core/detect.ts`, the fixtures and tests under `packages/fedi/test`, and the app call sites that touch Mastodon behavior (`src/screens/Notifications.tsx`, `src/state/queries/notifications.ts`, `src/components/Post/PostPoll.tsx`, `src/api/composer.ts`).

Method: static read of the code. No server, no Mastodon source checkout, and no device were available. Server-side behavior claims below come from the Mastodon API docs and from what the repo's own comments say. Where I could not check against code I say "unverified". `admin.ts` was skipped on purpose because `results/mastodon-admin.md` covers it.

## Summary

The data layer is in good shape. IDs stay opaque strings, tokens never leave their origin, Link paging is consistent, and `adaptStatus` degrades well. I found one real functional break on current Mastodon, a cluster of "capability says unsupported but the server supports it" gaps, and several places where the client shows or sends data it should not.

| # | Severity | Finding |
|---|---|---|
| 1 | High | Dismissing a notification on Mastodon 4.3+ uses the group key as a v1 id. The 404 is read as "server has no dismiss", which hides the action for the session. |
| 2 | High (needs device check) | No `crypto` polyfill. `newIdempotencyKey()` is unguarded, and `randomToken()` silently falls back to `Math.random` for the PKCE verifier and state. |
| 3 | Medium | `client.ts` still has `err instanceof DOMException`, which core/http.ts and misskey/external.ts already fixed for Hermes. |
| 4 | Medium | Search never sends `resolve=true`, so remote handles and post URLs cannot be found. |
| 5 | Medium | Pinned posts are declared "not available" on vanilla Mastodon, though `pinned=true` is supported. |
| 6 | Medium | Multi-choice polls are disabled on Mastodon (`polls_multi: "unsupported"`), though Mastodon supports `multiple`. |
| 7 | Medium | Polls with hidden totals render fake "0" vote counts. |
| 8 | Medium | The Idempotency-Key is generated per `createPost` call, so retries get a new key and can create duplicate posts. |
| 9 | Medium | Mastodon notifications never carry `read` state, and the marker that gets written is never read back. |
| 10 | Medium | `lists.timeline` drops the cursors continuation, so the cross-origin Link fallback re-fetches page 1 forever. |
| 11 | Medium | There is no `sensitive` (or `language`) field on drafts, so media cannot be marked sensitive without a CW. |
| 14 | High | Streaming auth sends `Bearer, <token>` as the subprotocol; Mastodon takes the whole header as the token (verified in local checkout). |
| 12, 13, 15 to 22 | Low | See below. |

## Findings

### 1. High: notification dismiss breaks on grouped (v2) notifications and then hides itself

- Files: `packages/fedi/src/mastodon/adapt.ts:724-768` (group id is `group_key`), `backend.ts:1118-1120`, `endpoints.ts:1174`, `src/screens/Notifications.tsx:252-264`.
- `backend.notifications()` prefers `/api/v2/notifications` on every server that has it (Mastodon 4.3+). `adaptV2Group` sets `Notification.id = group_key`. The group key looks like `favourite-123-456` or `ungrouped-789`, not a notification id.
- `dismissNotification(id)` then calls `POST /api/v1/notifications/<group_key>/dismiss`. That is the v1 route, which looks up a notification by numeric id. It answers 404.
- The screen treats any 404/405 as "this server has no dismiss route": `isUnsupportedError(err)` calls `setDismissUnsupported(true)`. One click on a modern Mastodon therefore removes the Dismiss control for the rest of the screen's life, with a caption saying the server does not support it.
- Scenario: the user opens Notifications on a Mastodon 4.3+ account and presses dismiss on any row. Nothing is dismissed, and the control disappears with a false "unsupported" reason.
- Fix: for a row that came from a group, call `DELETE /api/v2/notifications/:group_key`. Keep `most_recent_notification_id` in `ext` and use v1 only for ungrouped rows. Narrow the "unsupported" check so it does not fire for a 404 on a specific id.
- Tests: `mastodon-grouped.test.ts` has nothing for dismiss, and `NotificationsActions.test.tsx` only uses id `n1`.

### 2. High (needs device verification): no secure-random source on native

- Files: `packages/fedi/src/mastodon/compose.ts:197-201`, `oauth.ts:444-458`, `src/platform/polyfills.ts` (empty).
- `newIdempotencyKey()` calls `crypto.getRandomValues` with no guard. `package.json` has no `expo-crypto` or `react-native-get-random-values`, and the native polyfills file is empty.
- If Hermes/Expo does not expose `globalThis.crypto`, `createPost` and `scheduled.create` throw a ReferenceError on every post.
- `randomToken()` checks for `crypto`, and when it is missing it uses `Math.random`. The OAuth `state` and the PKCE `code_verifier` would then be predictable, with no error and no log line.
- I could not confirm whether RN 0.86 / Expo 57 provides `crypto`. Run `typeof crypto?.getRandomValues` on a device build.
- Fix: install and import a polyfill in `src/platform/polyfills.ts`, or throw in `randomToken` instead of using `Math.random`. Add a native test for the globals.

### 3. Medium: Hermes-unsafe `instanceof DOMException` left in the Mastodon client

- File: `packages/fedi/src/mastodon/client.ts:155`.
- `core/http.ts:280` and `misskey/external.ts:185` carry the note "never `err instanceof DOMException`, Hermes/RN may not provide the global". `mastodon/client.ts` was not updated.
- When a caller aborts (react-query cancel, screen unmount) and `DOMException` is undefined, evaluating it inside the catch throws a ReferenceError. That error replaces the AbortError and is reported as a failure.
- Fix: use `(err as {name?: unknown})?.name === "AbortError"`, the same as core/http.ts.

### 4. Medium: search cannot resolve remote accounts or post URLs

- Files: `endpoints.ts:410-453` (`searchV2` has no `resolve` option), `backend.ts:799-838`.
- Mastodon's docs say `resolve` defaults to false and is the switch for WebFinger and URL lookups. `search.accounts`, `search.posts`, and the `@` autocomplete always omit it. Only `resolveAccountByHandle` and `resolveQuote` pass `resolve: true`.
- Scenario: the user pastes `https://other.example/@x/123` or `@x@other.example` into Search. If the home server has never seen it, the result is empty. The post-URL case is the standard "open this post on my server" flow.
- Fix: add `resolve` to `SearchV2Options`. Send `true` when the query is a URL or contains a handle shape, and only for authenticated sessions, since resolve needs a token.

### 5. Medium: pinned posts declared unavailable on vanilla Mastodon

- File: `backend.ts:368-382` (`accountFeaturedPosts`). `endpoints.ts:593-595` says "`pinned` is Akkoma-only".
- `GET /api/v1/accounts/:id/statuses?pinned=true` is a documented Mastodon parameter. The code throws `errors.unsupported.pinned` for every non-Akkoma flavor, so the Featured tab on Mastodon profiles never works.
- Fix: allow it for `mastodon` too. The request needs no extra scope.

### 6. Medium: `polls_multi` is "unsupported" for Mastodon

- Files: `core/detect.ts:461`, used at `src/api/composer.ts:182`.
- `POST /api/v1/statuses` accepts `poll[multiple]` on Mastodon, and `statusBodyOf` already sends it (`compose.ts:166`). The capability table turns the control off with "This server allows single-choice polls only."
- Fix: set `polls_multi: "supported"` for mastodon. Akkoma and Pleroma have no value at all, so they are "unknown". Confirm for them and set it.

### 7. Medium: hidden-total polls render fake zeros

- Files: `adapt.ts:341-345` (`votesCount: o.votes_count ?? 0`), `src/components/Post/PostPoll.tsx:158,167,173`.
- Mastodon sets each option's `votes_count` to `null` while a `hide_totals` poll is open. The adapter turns that into 0 and the row shows "0" and an empty bar, which breaks the "never ship fake data" rule.
- Because `polls_hide_totals` is `"supported"` for Mastodon, the app can create such polls itself.
- Fix: make `PollOption.votesCount` `number | null` and render nothing (or "hidden") for null. Also map `poll.emojis` (see finding 20).

### 8. Medium: Idempotency-Key is not stable across retries

- Files: `backend.ts:458-464`, `compose.ts:203-219` (`attemptKeyFor`).
- `createPost(draft)` calls `newIdempotencyKey()` on every invocation. `attemptKeyFor`, which keeps a key for an identical body, has no non-test caller. The `scheduled.create` path (`backend.ts:1405`) does the same.
- Scenario: a post times out on a flaky connection. The user taps Post again. The server sees a new key and creates a duplicate.
- Fix: accept an optional key in `createPost`, or cache it in the backend keyed by the draft fingerprint. The composer holds the `AttemptKey`.

### 9. Medium: notification read state is never available on Mastodon

- Files: `adapt.ts:707` (v2 flat rows `read: null`), `adapt.ts:763` (groups `read: null`), `adapt.ts:788` (v1: only `pleroma.is_seen`), `backend.ts:1109-1116`, `endpoints.ts:1161`, `src/state/queries/notifications.ts:233`.
- The code writes a marker with `POST /api/v1/markers`, but nothing reads `GET /api/v1/markers?timeline[]=notifications`. Mastodon rows therefore always have `read: null`, and the unread counter (`item.read === false`) stays at zero. "Mark read" has no visible effect.
- Fix: read the marker (or compare against `last_read_id`) and derive `read` per row, or hide the "mark read" control on Mastodon. For v2 groups use `page_max_id` and `most_recent_notification_id` as the marker value.

### 10. Medium: `lists.timeline` ignores a cursors continuation

- File: `backend.ts:1317-1330`.
- `query = cont ? {} : {limit}`. For `cont.kind === "cursors"` (the Akkoma "Link on a different origin" fallback, `pagination.ts:160-179`) the path is the plain list URL and no cursor is applied, so the same first page is returned again.
- `bookmarks.list` (`backend.ts:1368-1373`) handles the case correctly.
- Scenario: Akkoma behind a proxy. Scrolling a list timeline repeats page 1 and never ends.
- Fix: reuse `pageQuery` or `withCursors` as bookmarks does.

### 11. Medium: no way to send `sensitive` (or `language`)

- Files: `core/backend.ts:145-164` (`PostDraft`), `compose.ts:88-96` (`StatusBody`).
- `capabilities.media_sensitivity = "unsupported"` is correct for per-file flags. But Mastodon does take a status-level `sensitive`, and `PostDraft`/`StatusBody` have no such field. Media is flagged sensitive only via a CW, and `uploadMedia`'s `isSensitive` is accepted and silently dropped (`backend.ts:1137-1160`).
- Fix: add `sensitive` to the draft and body when media is attached and the user ticks it. An optional `language` field is a smaller version of the same gap.

### 12. Low: notification types outside the table render as raw strings

- File: `adapt.ts:625-634`.
- Missing Mastodon types: `status`, `update`, `quoted_update`, `admin.sign_up`, `admin.report`, `severed_relationships`, `moderation_warning`. Akkoma has `move`. All map to kind `unknown`, and the row shows `rawType` untranslated (`NotificationRow.tsx:104`).
- Core already has a `note` kind that fits `status`. The `severed_relationships` and `moderation_warning` rows carry no `account`, so check the row handles that.
- Notification policy and requests (`/api/v1/notifications/policy`, `/requests`) are not implemented. Mastodon 4.3+ files non-follower notifications there, so they are invisible.

### 13. Low: timeline deletes from the stream are never applied

- File: `stream.ts:210,311,473`.
- `Entry.deletes` is never added to (there is no API that does it), so a `delete` frame reaches only `subscribePost` listeners. A deleted post stays in the home feed until the next refresh. `mastodon-stream-delete.test.ts` documents this as intended. It is still user-visible. `conversation` frames are also ignored (documented).

### 14. High (verified against local Mastodon checkout): streaming auth fails on Mastodon

- File: `packages/fedi/src/mastodon/stream.ts:247`; server side `/Users/terezi/Local Documents/fedifedifedi/mastodon/streaming/index.js:408-418`.
- The client offers subprotocols `["Bearer", token]`, so the header reads `Bearer, <token>`. The server takes the whole `sec-websocket-protocol` value as the token (`accessToken = query?.access_token || req.headers['sec-websocket-protocol']`) and only strips a `Bearer ` prefix from the `Authorization` header. It looks up `Bearer, <token>`, which is not a valid token, so the handshake is rejected.
- `docs/mastoapi-contract.md:370-376` claims Mastodon accepts this pair. This checkout contradicts it.
- Scenario: every Mastodon session fails to stream. The 5-fast-close breaker trips and the badge shows "stopped". Feeds fall back to polling.
- Fix: for Mastodon send the bare token as the only subprotocol (`[token]`), or use `?access_token=`. Keep `["Bearer", token]` only if Akkoma needs it. Also check that the server echoes a subprotocol on iOS.

### 15. Low: nested quotes in Mastodon 4.5 show as unavailable

- File: `adapt.ts:406-433`.
- From my recollection of the 4.5 API, a quoted status that itself quotes is serialized as a shallow quote with `quoted_status_id` and no `quoted_status`. `adaptQuote` then returns `quoteUnavailable: true`, even though the id could be fetched. Unverified against source. `wire.ts:254-259` has no `quoted_status_id`.

### 16. Low: family detection depends on NodeInfo for plain Mastodon

- File: `instance.ts:104-134`.
- Stock Mastodon `version` is just `4.x.y`, so it hits none of the substring checks, and `unknown` is only resolved through NodeInfo. If NodeInfo is blocked or fails, the family is `unknown`: the full 28-scope string is requested (`oauth.ts:219`), and the UI unlocks very little. `detectServer` in `core/detect.ts` has the same dependency. Consider treating a v2 instance body with `configuration.urls.streaming` and no `pleroma` key as Mastodon.
- Pixelfed, Friendica, Iceshrimp, and similar servers stay unknown, which is fine.

### 17. Low: one malformed row fails the whole page

- Files: `endpoints.ts:154,288,364-365,446`, `adapt.ts:794`, `conversations.ts:52`, `stream.ts:453`.
- `isStatusRow` guards are used only in `lists.timeline`, `bookmarks.list`, and the v2 notification adapter. All other paths call `adaptStatus` or `adaptAccount` directly, which throws on a missing `account`. One bad status in a forks' timeline fails the full page. The stream path swallows it, which is fine.

### 18. Low: pagination parsing has no unit tests and a naive comma split

- File: `pagination.ts:29-41`.
- `parseLinkHeader` splits on every comma, so a `Link` href containing a raw comma is cut in half. Mastodon encodes commas, so this is unlikely in practice. No test file mentions `parseLinkHeader` or `nextContinuation`. `fallbackMaxId`, `nextLink`, `prevLink`, `writeCapabilities`, `buildStatusBody`, and `feedClient` are unused outside tests/their own file. `feedClient` reads the active session at call time and would send the wrong token for a non-active session if anyone used it.

### 19. Low: token revocation may use the wrong app after re-registration

- File: `oauth.ts:306-316,833-852`.
- The app cache holds one app per origin and a scope change re-registers it. Old tokens were issued to the previous client id, so `revokeToken` with the new credentials fails silently (best effort) and the old token stays valid on the server.

### 20. Low: poll option emojis not mapped

- File: `adapt.ts:332-347`.
- `Poll.emojis` is typed in the wire but not read, so `:shortcode:` in option titles stays as literal text.

### 21. Low: static avatar and header are always preferred

- File: `adapt.ts:242-244` (`avatar_static ?? avatar`).
- Animated avatars never animate. This may be intentional. It needs an owner decision.

### 22. Low: other small gaps

- `fetchTagTimelinePage` supports a single tag only (no `any[]`/`all[]`).
- Featured tags are shown only for the viewer (`/api/v1/featured_tags`), not for other accounts.
- Scheduled statuses can be listed, created, and deleted, but not edited (`PUT /api/v1/scheduled_statuses/:id`).
- Poll expiry from `expiresAt` can become `expires_in: 0` (`compose.ts:159-163`), which Mastodon rejects (minimum 300 seconds).
- `reposts` shows boosters only; `favourited_by` exists in the endpoint code but is not surfaced.

## Things that looked solid

- **Origin safety.** `request()` resolves absolute URLs through `resolveSameOriginUrl` before attaching `Authorization`. Link next URLs on a different origin fall back to cursor params only, so the Bearer token never leaves the session origin (`client.ts:61-100`, `pagination.ts:160-179`). The streaming origin is scheme-pinned (`stream.ts:106-120`).
- **Response handling.** Text is read before JSON parsing. 202, 204, and 206 are accepted, timeouts are separate from "endpoint missing", and 429 keeps Retry-After and the rate-limit headers.
- **Pagination rules.** Ids are never parsed or compared numerically, and end-of-feed is "no next link or empty page" everywhere, never `length < limit`.
- **OAuth.** PKCE S256 with a pure-TS SHA-256 fallback, state validated once and deleted on read (replay guard), a 15-minute pending expiry, token verified via `verify_credentials` before it is stored, and `/oauth/revoke` is best effort. App cache is bound to redirect URI and scope string. The scope-fallback only fires on 422 or a scope-shaped error.
- **Adapters.** `adaptStatus` tolerates missing optional fields. Both quote shapes (Mastodon `{state, quoted_status}` and Akkoma nested) are handled. Unknown visibility reads `direct`, never wider. Unknown notification types become `unknown` with `rawType` kept. Edit history is reversed to newest-first with an honest `original` flag. `adaptRelationship` keeps absent flags absent.
- **Filters.** v2-first with a 404/405-only fallback to v1, whole keyword lists carried through edits, `expires_in` computed correctly.
- **Lists and domain blocks.** Capability-gated list fields (no unknown params sent), domain block DELETE uses the query string.
- **Conversations.** No fake show route: the inbox scan stops on repeated continuation.
- **Thread rebuild** survives cycles, missing parents, and unauthenticated caps.
- **Streaming.** Pooled sockets per (stream, params), lazy dial, bounded backoff, fast-close breaker, `kill` and `ping`/`pong` handling.
- **Tests.** 16 Mastodon test files plus fixtures for status, reblog, quote-pending, grouped notifications, filters v1/v2, scheduled, and media-processing. Not covered: dismiss on grouped rows, nested/shallow quote, hidden-total polls, list-timeline cursors, `parseLinkHeader`, `resolve=true` search, and DOMException/abort behavior.
