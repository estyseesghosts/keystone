# Audit: general networking (2026-10-25)

Scope: `packages/fedi/src/core/http.ts`, `core/errors.ts`, `api/client.ts`, `mastodon/{client,pagination,stream,backend}.ts`,
`misskey/{client,stream,external,remotepost,adapt}.ts`, `src/state/queries/*`, `src/state/streaming.ts`, `src/screens/HomeFeed.tsx`.
Read-only audit; no source modified. Only items verified by reading code are listed.

## Summary

The request layer is sound on the points the project cares about most: origin/token binding, cross-origin refusal before I/O,
204/empty-body tolerance, typed timeout vs network errors. The weak spots are around the edges of that layer:
nothing is cancellable, there is no offline/foreground awareness, error-state paging can storm the server, both WebSocket
breakers are defeated by their own `open` handlers, the advertised Mastodon streaming origin is never wired, and several
native-runtime assumptions (`crypto`) are unguarded.

Counts: 0 critical, 3 high, 9 medium, 7 low.

## Findings

### H1 (high) Native `crypto` is assumed but never polyfilled: Mastodon post creation (and weak PKCE) on device
- `packages/fedi/src/mastodon/compose.ts:197-200` (`newIdempotencyKey` calls `crypto.getRandomValues` unguarded);
  used at `mastodon/backend.ts:463` (`createPost`) and `:1405` (scheduled create).
- `packages/fedi/src/mastodon/oauth.ts:444-450` (`randomToken`) guards `crypto` but falls back to `Math.random()` for PKCE
  `code_verifier` and OAuth `state`.
- Verified: no `expo-crypto` / `react-native-get-random-values` in `package.json`; no `crypto` install in `node_modules/expo/src/winter`
  (it installs DOMException, URL, TextDecoder, etc., not crypto); `jest/jestSetup.js:8` mocks `crypto` to `{}`, hiding it in tests.
- Failure: on Hermes with no global `crypto`, `createPost` throws `ReferenceError: Property 'crypto' doesn't exist` before any
  request is sent, so every Mastodon post/reply/quote fails on native. Separately, if `crypto` is missing, PKCE verifier/state are
  `Math.random()` derived (predictable, not CSPRNG). Not device-verified, but nothing in the tree supplies the global.
- Fix: add `expo-crypto` (`getRandomValues`) and install it as `globalThis.crypto` at boot, or inject a randomness seam;
  make `newIdempotencyKey` and `randomToken` throw (not fall back to `Math.random`) when no CSPRNG exists.

### H2 (high) Feed fetch-next-page storm after a page error (no backoff, ignores 429)
- `src/screens/HomeFeed.tsx:229` (scroll handler) and `:416-418` (`onEndReached`) call `fetchNextPage()` whenever
  `hasNextPage && !isFetchingNextPage`. They never check `isFetchNextPageError`. The error footer with a Retry button exists at `:431-440`.
- `retryPolicy` (`state/queries/retry.ts`) stops retrying on 429, but `Retry-After` (surfaced by `toApiError`) is consumed nowhere in
  `src/` (grep: only `mastodon/client.ts`).
- Failure: the next-page request returns 429/500 (or the device goes offline). The query leaves `isFetching`, the user scrolls
  within 1200px of the end, and every scroll event fires a new request (each with up to 2 more retries for 5xx/network). A throttled
  Mastodon server gets hammered, extending the throttle. The explicit Retry button is bypassed.
- Fix: gate both call sites on `!feed.isFetchNextPageError` (only the Retry button clears it), and honour `retryAfterMs` for 429
  (disable auto-paging until it elapses). Same pattern should be checked in `Conversations.tsx:120`, `ChatThread.tsx:213`.

### H3 (high) Account removal / sign-out never clears query cache or its persisted copy
- `src/state/queries/Provider.tsx:75-88` persists the whole `QueryClient` (all successful queries, no `shouldDehydrateQuery` filter)
  to MMKV under `keystone-query-cache`, maxAge 24h (`stale.ts`). No `removeQueries`/`clear`/`persister.removeClient` anywhere keyed on
  session removal (grep over `src/`: only `state/cache/patch.ts:106`, which is per-post).
- Failure: user removes account A (shared device or sign-out of a sensitive account). Timelines, notifications, DM/chat threads for
  A remain in memory and in MMKV for up to 24h, and are restored on next launch. Query keys are sessionId-scoped, so this does not
  cross-contaminate accounts, but it is a data-retention/privacy defect.
- Fix: on `removeSession`/sign-out, `queryClient.removeQueries({predicate: key[0] === sessionId})` and persist; exclude chat/DM
  queries from dehydration.

### M1 (medium) Response-body read is outside the timeout and the caller's abort
- `core/http.ts:295-301` and `mastodon/client.ts:367-374`: the `finally` clears the timer and removes the caller-abort listener as soon
  as headers arrive, then `await response.text()` (`http.ts:301`, `client.ts:374`) runs unbounded. Same shape in `misskey/external.ts`
  `postDirect` (timer cleared in `finally`, then `response.text()`), and `misskey/client.ts:292` (upload).
- Failure: a server/proxy that sends headers then stalls the body (common behind buffering proxies / flaky mobile links) hangs the
  request forever; the query sits in `isFetching`, the "30s hard ceiling" documented at `client.ts:27-29` is not true.
- Fix: keep the timer + abort wiring until the body is fully read (clear in a `finally` around the whole function).

### M2 (medium) No request cancellation anywhere (no `signal` plumbed from queries)
- `rg signal src/` finds no use. `usePostFeedQuery.ts:223` `queryFn: ({pageParam})` ignores `signal`; `Backend` methods take no signal;
  `MisskeyClient.call` (`misskey/client.ts:88`) has no signal option at all. `requestJson`/`request` support `signal`, but nothing passes one.
- Failure: switching columns/accounts, unmounting a screen or fast typing in search leaves every request running to completion (up to
  30s each); slow responses pile up and burn rate limit. react-query's cancellation on unmount is a no-op.
- Fix: add `signal?: AbortSignal` to `PageOpts`/backend calls and thread `queryFn`'s `signal` down to `request`.

### M3 (medium) No online/foreground awareness (no `onlineManager`, `focusManager`, NetInfo, AppState)
- Verified by grep: none of `onlineManager|NetInfo|AppState|focusManager` appears in `src/` or `packages/`. `Provider.tsx:28-39`
  sets `refetchOnWindowFocus: false`.
- On React Native, react-query's `onlineManager` defaults to "online" and never changes. Failure: offline queries are not paused;
  each fails after a network error + 2 retries (exponential default delay) and lands in error rather than waiting; coming back online
  or foregrounding the app after hours triggers no refetch (30s staleTime only helps on remount). WebSockets also have no AppState
  hook, so a socket that the OS killed in the background stays "connected" until the next write.
- Fix: wire `onlineManager.setEventListener` to NetInfo, `focusManager` to AppState, and have the stream handles retry on foreground.

### M4 (medium) Both WebSocket fast-close breakers are reset by the `open` handler, so accept-then-close loops forever
- Mastodon: `mastodon/stream.ts:541-543` (`onopen` sets `fastCloses = 0; attempt = 0`). Misskey: `misskey/stream.ts:276-280`
  (`open` sets `quickCloses = 0; backoffMs = BACKOFF_BASE_MS; poolAttempt = 0`).
- Failure: a server that completes the WS handshake and then closes (revoked/expired token on some proxies, `kill`-like closes without
  the frame, mastodon-compatible servers that auth after upgrade) never trips the breaker: each cycle resets counters, so it
  redials every ~1-2s forever (Mastodon backoff stays at `backoffMs(1)=2s`; Misskey at 1-1.5s) and re-sends subscriptions each time.
  The breaker only catches sockets that never open.
- Fix: reset counters only after the connection has stayed up past the fast-close window (e.g. in the close handler when
  `now - openedAt >= FAST_CLOSE_MS`, which the Mastodon code half-does at `:390-391`), not on open.

### M5 (medium) Mastodon advertised streaming origin is never passed to the backend
- `api/client.ts:202-206` (`backendForSession`) and `:259-262` (`activeBackend`) call `createMastodonBackend(..., {flavor, evidence})`
  with no `streamingOrigin`. Grep for `streamingOrigin` shows it is only consumed in `mastodon/backend.ts` and produced in
  `mastodon/instance.ts:306`; no caller supplies it.
- Failure: split-host Mastodon instances (streaming on `streaming.example.com`, as the stream.ts header describes) always dial
  `wss://<REST host>/api/v1/streaming`, fail, hit the 5-fast-close breaker and show "stopped". The documented feature is dead code.
- Fix: persist the advertised streaming origin on the session (or in `evidence`) at detection and pass it through.

### M6 (medium) `backend.stream()` is not pooled; backend identity churns on any session-store change
- `misskey/backend.ts:916-926` and `mastodon/backend.ts:1423-1433` build a NEW handle (new Misskey pool / new Mastodon entry map) on every call, although the
  Mastodon comment says "single pooled handle per backend". Callers: `src/state/streaming.ts:459` (per feed), `:577` (notifications), `state/queries/chat.ts:318,351`.
  So N mounted feeds + notifications + chat = N+ sockets per session (Misskey: one WS each; Mastodon: one per stream key per handle).
- `src/screens/HomeFeed.tsx:59-66` `useBackendForSessionId` memoises on the entire session `snapshot`, so any snapshot change
  (permission-denied note, health refresh, other account added) yields a new `Backend`; the `useFeedLive` effect deps include `backend`
  (`streaming.ts:524`), so every live feed tears down and redials its socket and loses its buffered pending posts.
- Fix: memoise a per-session backend (and its stream handle) in the store keyed by session id + token/flavor/evidence; memo on the session object, not the snapshot.

### M7 (medium) Streaming reconnect has no gap fill; updates trigger one uncoalesced fetch per event
- No `invalidate`/refetch on reconnect in `state/streaming.ts` (grep shows none tied to status transitions): posts/notifications that arrive during a socket outage are lost until the 30s stale refetch happens to run.
- `state/streaming.ts:494-498`: each `onUpdate` event does `backend.post(event.id)` with no debounce/dedupe and no ordering guard. A burst of reactions on a hot post fires one request per event, and an older response can overwrite a newer one via `patchPostInCaches`.
- Fix: on `reconnecting -> connected`, invalidate the feed/notification queries; coalesce per-id updates (trailing debounce, keep latest in-flight).

### M8 (medium) Mastodon media upload and image PATCH inherit the 30s total timeout
- `mastodon/backend.ts:1145` (`postFormData("/api/v2/media", form)`) and `mastodon/endpoints.ts:779` (`patchFormData`) pass no `timeoutMs`; `request()` defaults to 30s for the whole request. (The Misskey upload path explicitly has no deadline, `misskey/client.ts:246-248`.)
- Failure: a video or large image on a mobile uplink exceeds 30s; the request is aborted and reported as `errors.network.timeoutInstance` ("the instance did not answer"), the server may have stored the file anyway, and a user retry duplicates it.
- Fix: pass a size-scaled or much larger timeout (or progress-based) for multipart uploads.

### M9 (medium) Every rendered federated post fires an unauthenticated direct fetch to the remote origin
- `src/components/Post/PostCard.tsx:729-731` calls `resolveRemotePostUrl(effective.uri)` in an effect for every mounted card; `misskey/remotepost.ts:106-125` does `fetch(uri)` with no scheme/host validation (any `uri` the server packs, including `http:` or private IPs).
- On native there is no CORS, so the request succeeds for every post. Failure/impact: scrolling a timeline makes the device contact each author's home server (IP/interest leak, a request per unique `uri`, up to 6s each), and a malicious server can make clients GET arbitrary LAN/localhost URLs (blind GET). The comment says the intent was to warm a cache for a menu action.
- Fix: resolve lazily when the menu opens, restrict to `https:`, and skip private/loopback hosts.

### L1 (low) `toApiError` discards the transport error's own `code`/`params`
- `mastodon/client.ts:141-158`: it builds `new ApiError(err.message, err.status, code, ...)` with `code` taken from the response body's `error` string (human text such as "Record not found"), not `err.code`. For timeout/network errors the localizable `errors.network.timeoutInstance` / `unreachableOrigin` identity is dropped, and `status` 0 gets the default `errors.network.apiError`. Misskey's `translateError` preserves them. UI sees a different code per family.
- Fix: map `err.kind`/`err.code` through; never use free-form `error` text as the stable code.

### L2 (low) `Idempotency-Key` is minted per call, so it can never dedupe a retry
- `mastodon/backend.ts:463` and `:1405` call `newIdempotencyKey()` inside `createPost`/scheduled create. `attemptKeyFor` (`compose.ts:211`, documented as the retry mechanism) has no production caller (grep). A timeout followed by user retry sends a new key, so the server can create duplicate posts. Misskey `notes/create` has no equivalent.
- Fix: hold an `AttemptKey` in composer state and pass it in the draft.

### L3 (low) `mastodon/client.ts:354` uses `err instanceof DOMException` in the catch block
- `core/http.ts:280-282` and `misskey/external.ts` explicitly warn against it. Verified that Expo's winter runtime installs `DOMException` (`node_modules/expo/src/winter/runtime.native.ts`), so it works under Expo, but it throws a ReferenceError (replacing the real network error) in any runtime without the global (tests, non-Expo hosts) and misclassifies non-DOMException `AbortError`s as network failures. Align with the name check.

### L4 (low) Misskey stream: no connect timeout, no heartbeat/stale-socket detection
- `misskey/stream.ts:258-287`: a socket that never fires `open` or `close` (captive portal, blackholed SYN) keeps status `connecting` forever (Mastodon has a 10s ack watchdog, `stream.ts:524`). `pong: true` is requested but nothing monitors liveness, so a half-open socket after sleep stays `live`. Also `armAckTimeout` (`:219`) starts when `sendConnect` is called even if the message was dropped because the socket was not open (`sendMessage` `:214` silently returns), marking subs `unavailable` after 10s on slow dials.

### L5 (low) `?i=<token>` in the Misskey WebSocket URL
- `misskey/stream.ts:152-157` puts the token in the query string (Misskey requires it; Mastodon path uses subprotocols). Tokens can land in proxy/server logs and RN network debug output. Prefer a subprotocol/ticket if the target servers support it; at minimum never log `url`.

### L6 (low) Pagination edge cases
- `mastodon/pagination.ts:32` splits the `Link` header on every `,`, so a URL containing a comma in its query breaks parsing; parse `<...>` entries with a regex instead.
- `misskey/adapt.ts:584` ends the feed when `items.length < limit`, which `core/models.ts` and the Mastodon contract (`pagination.ts:10`) say not to use; any Misskey endpoint that filters server-side after the limit (e.g. mutes/visibility) can terminate paging early.
- Pull-to-refresh on an infinite query (`HomeFeed.tsx:407` `feed.refetch()`) refetches every loaded page sequentially, multiplying request count against rate limits.

### L7 (low) `usePostFeedQuery` rebuilds the backend every render
- `state/queries/usePostFeedQuery.ts:206-209` calls `resolveSessionBackend(appStorage(), sessionId)` in render body: `findSession` (reads/JSON-parses stored sessions from MMKV) plus a fresh `Backend` per render per mounted column. Use `useMemo` keyed on the session.

## Looked solid

- Origin/token scoping: `requestJson` has no token parameter (`core/http.ts`); `request()` refuses cross-origin absolute URLs before I/O; `createMisskeyClient` is built from one session and `endpointPath` re-checks same-origin; `activeSessionMastoClient` resolves per call and fails closed; `credentials: "omit"` everywhere; Link `rel=next` URLs are same-origin checked, with cursor-only fallback for mismatched origins (`pagination.ts:160-179`).
- Empty/204 bodies handled by reading text then parsing (`http.ts:300`, `client.ts:374`, upload path special-cases 204); HTML error pages keep raw text; typed `kind` distinguishes timeout/network/invalid-json/http so a timeout is never treated as "unsupported".
- `retryPolicy` correctly excludes 401/403/404/410/422/429 and keeps 5xx/network retryable.
- Mastodon stream: lazy dial, refcounted entries, ack watchdog, superseded-socket guards (`e.socket !== ws`), `kill` handling, `retry()` clearing breaker, bounded exponential backoff, no token in URL (subprotocol), scheme-pinned advertised origin.
- Misskey stream: refcounted pool, resubscribe on reopen, per-sub ack tracking, token-change handling, listener errors isolated.
- Query keys carry `sessionId`; post-feed dedupe by id (`feedItems`) tolerates page overlap.
- `remotepost.ts` caches are bounded (500) with negative TTL and in-flight dedupe.
