# Audit: general networking (2026-10-26)

Scope: `packages/fedi/src/core/http.ts`, `core/errors.ts`, `api/client.ts`, `mastodon/{client,pagination,stream,backend}.ts`,
`misskey/{client,stream,external,remotepost,adapt}.ts`, `src/state/queries/*`, `src/state/streaming.ts`, `src/screens/HomeFeed.tsx`.
Read-only audit; no source modified. Only items verified by reading code are listed. Greps run for `signal`,
`onlineManager|NetInfo|AppState|focusManager`, `streamingOrigin`, `retryAfter`, `crypto`, `redirect:`.

## Summary

Most of the 2026-10-25 findings have since been repaired and the repairs verified in place: the body read is inside
the deadline on every credentialed path, `signal` is threaded from every read `queryFn`, `onlineManager`/`focusManager`
are wired to NetInfo/AppState, both stream breakers reset on healthy close only, backends and stream handles are pooled
per session identity, gap-fill plus per-post update coalescing exist, uploads carry scaled deadlines with stall
detection, the CSPRNG seam throws instead of falling back to `Math.random`, Link parsing is regex-based, end-of-feed
never uses `length < limit`, persistence is allowlisted per session with a purge registry, and remote-post resolution
is lazy with a public-https-only policy. What remains is one unhardened legacy path (the external Drive upload missed
every X2.2/X7.4 repair), one half-landed feature (streaming-origin plumbing with no producer), one incompletely wired
repair (gap-fill covers only notification mounts and one transition shape), and low-severity residuals.

Counts: 0 critical, 1 high, 2 medium, 6 low.

## Findings

### H1 (high) External Drive upload follows redirects with the token and has no deadline

- `packages/fedi/src/misskey/external.ts:328-343` (`externalUploadFile`): the fetch at `:330-334` passes only
  `{method: "POST", credentials: "omit", body: form}` — no `redirect: "manual"`, no `signal`, no timeout — and the
  `await response.text()` at `:343` sits outside the `try`, unbounded.
- Contrast the three sibling paths, all hardened: internal Misskey upload (`misskey/client.ts:395-413`, `redirect:
  "manual"` plus `isRedirectStatus` refusal at `:404-410`, scaled deadline at `:340-346`); `postDirect` in the same
  file (`external.ts:185-229`, 30 s `DIRECT_TIMEOUT_MS`, body read inside the `try` at `:205`); Mastodon media upload
  (`mastodon/endpoints.ts:1413-1543`, manual redirects, scaled deadline, stall detection).
- Failure: (a) the instance (or a proxy in front of it) answers the upload with a 301/302/307. Fetch's default
  `follow` re-sends the multipart body — including the `i` token field appended at `:323` — to the next hop. The
  internal path refuses exactly this with `errors.network.redirect`; the external path delivers the credential to it.
  (b) A server that sends headers then stalls the body hangs the upload forever; every sibling path has a deadline.
- Fix: mirror the internal upload — `redirect: "manual"` with the `isRedirectStatus` refusal before trusting the
  body, an `AbortController` deadline (scaled or `DIRECT_TIMEOUT_MS`), and move `response.text()` inside the guarded
  region.

### M1 (medium) Streaming-origin wiring has no producer: `detectServer` never writes the evidence the backend reads

- Consumer: `packages/fedi/src/api/client.ts:244-251` (`streamingOriginOf` reads `session.evidence.streamingOrigin`),
  passed through at `:280` (`backendForSession`) and `:343` (`activeBackend`) into `createMastodonBackend`
  (`mastodon/backend.ts:385`, `streamOrigin`), then to `createStreamHandle` (`mastodon/stream.ts:264`,
  `resolveStreamingBase` at `:126-139`).
- Producer missing: `DetectionEvidence` (`packages/fedi/src/core/detect.ts:193-230`) has no `streamingOrigin` fields,
  and `detectServer` (`detect.ts:884-980`) records only nodeinfo/version/shape/translation evidence — never a
  streaming advertisement. The producer (`streamingEvidenceFor`, `mastodon/instance.ts:195-201`) has no caller
  outside tests (grep), and `state/logs/2026-10-25-repair25-x3.4.md:21,46` records the login-flow persistence as
  explicitly deferred. (Separately, `fetchInstanceCapabilitiesInner` already computes the decision at
  `mastodon/instance.ts:418-421`, but `detectServer` — the flow login actually persists — does not.)
- Failure: on a split-host Mastodon instance (streaming on `streaming.example.com`), production sessions carry no
  `streamingOrigin`, so the socket always dials `wss://<REST host>/api/v1/streaming`, fails, and walks into the
  5-fast-close breaker (`mastodon/stream.ts:404-409`) showing "stopped". Feeds keep working via paging, so this is a
  dead-live-updates defect, not an outage. Same user-visible outcome as last year's M5; the cause moved from missing
  plumbing to missing producer.
- Fix: merge `streamingEvidenceFor` output into the evidence inside `detectServer` (the instance body is already
  fetched there), widen `DetectionEvidence` with the two fields, and backfill on next login/verify.

### M2 (medium) Reconnect gap-fill is wired only for notification mounts and only for one transition shape

- `src/state/streaming.ts:659-706` (`useLiveNotifications`) wires `watchStreamGapFill` at `:677`; `useFeedLive`
  (`:498-611`) does not — its comment at `:576-581` assumes the notifications mount covers feed gaps. The only
  production mount of `useLiveNotifications` is `src/screens/Notifications.tsx:624` (grep), so a session that never
  opens Notifications gets no gap-fill on any feed reconnect.
- `watchStreamGapFill` (`streaming.ts:913-945`) fires only on `was === 'reconnecting' && next === 'connected'`
  (`:931`). Misskey error-path reconnects (`poolStatus` `error` → `connecting` → `live`, `misskey/stream.ts:718-727`
  resetting a new subscriber straight to `connecting`) and Mastodon dead-handle retries (`stopped` → `connecting` →
  `connected` after `retry()`, `mastodon/stream.ts:616-634`) never pass through `reconnecting`, so they never fill.
- Failure: posts/notifications arriving during an outage that ends via either of those paths are lost until the 30 s
  stale refetch or next mount happens to run.
- Fix: wire `watchStreamGapFill` (or its `gapFillSessionFirstPages` core) into `useFeedLive` as well, and trigger on
  any transition into `connected` from a non-`connected` state that had previously left it (track a was-away flag
  rather than matching one exact predecessor).

### L1 (low) `Idempotency-Key` still minted per call; the stable-key seam has no production caller

- `packages/fedi/src/mastodon/backend.ts:609-615` (`createPost` calls `newIdempotencyKey()` per invocation) and
  `:1656-1663` (`scheduled.create`, same at `:1662`). The backend imports only `newIdempotencyKey` (`:169`).
- `stableIdempotencyKey`/`attemptKeyForBody` (`mastodon/compose.ts:224-242`) and `attemptKeyFor` (`:200-208`) have
  zero callers outside tests (grep); `compose.ts:210-214` admits "The backend still mints per call today", and the
  app submit path (`src/state/queries/composer.ts:186-199`) passes the draft straight through with no key
  management. (Flagged to avoid losing it: the sibling 2026-10-26 mastodon audit covers the same seam.)
- Failure: a post-create timeout followed by user retry sends a new key, so the server can store duplicate posts.
  Misskey `notes/create` has no equivalent mechanism.
- Fix: thread the key through `Backend.createPost` (composer-owned `AttemptKey` via `attemptKeyForBody` with a
  session-prefixed fingerprint), same for `scheduled.create`.

### L2 (low) `?i=<token>` still rides the Misskey WebSocket URL

- `packages/fedi/src/misskey/stream.ts:177-182` (`streamUrlFor` appends `?i=${encodeURIComponent(token)}`).
  Mastodon sends auth as the `Sec-WebSocket-Protocol` bearer pair (`mastodon/stream.ts:259-264`), never the URL.
- Failure/impact: the token lands in proxy/server access logs and RN network-debug output. Misskey's protocol
  requires query-or-header auth and sockets cannot set headers, so this is a protocol-imposed residual, kept for
  that reason — not a regression.
- Fix: prefer a ticket/subprotocol auth where target servers support it; at minimum never log the URL (current code
  already avoids putting it in messages).

### L3 (low) Misskey-family 429s never surface `Retry-After`, so the paging cooldown only works for Mastodon

- `retryAfterMsOf` (`src/state/queries/retry.ts:51-59`) reads `params.retryAfterMs`, which only Mastodon's
  `toApiError` stashes (`mastodon/client.ts:147-159` from `parseRateLimit`, `:234-243`). Misskey's `translateError`
  (`misskey/client.ts:162-241`) parses no headers, and `call()` discards the `headers` `requestJson` returns
  (`misskey/client.ts:281-288`).
- Failure: a throttled Misskey next-page fetch still stops auto-paging via the `isFetchNextPageError` guard
  (`src/state/queries/usePagedLoad.ts:128-137`), but with no timed cooldown and no visible countdown — strictly
  worse feedback than the Mastodon path, same guard.
- Fix: parse `Retry-After` in the Misskey transport (or in `translateError` from the response headers) into the
  same `params.retryAfterMs` shape.

### L4 (low) Timeout/abort race rethrows the raw abort error, bypassing the typed shape

- `packages/fedi/src/core/http.ts:397-414`: when the timer fired AND the caller aborted (`isAbort && timedOut`),
  line `:414` (`if (isAbort) throw err`) rethrows the raw `AbortError` instead of the typed `timeout` error built
  at `:382-392`. Identical shape in `mastodon/client.ts:388-406` (`:406`).
- Failure: callers expecting `HttpError`/`ApiError` (`.status`/`.code`/`.kind`) get a bare DOM error on this one
  race. The retry policy still does the right thing (`isAbortedError` matches `name === 'AbortError'`,
  `src/state/queries/retry.ts:12-15`), so the blast radius is error rendering, not retry storms.
- Fix: prefer the typed `timeout` error whenever `timedOut` is set, regardless of the abort flag (or adapt the raw
  error to `kind: "aborted"` at the boundary).

### L5 (low) Unparsable feed descriptor throws during render instead of answering an error state

- `src/state/queries/usePostFeedQuery.ts:208` calls `parseFeedDescriptor(descriptor)` (which throws `FediError`
  `errors.feeds.invalidDescriptor`, `packages/fedi/src/core/feedDescriptor.ts:55-59,79-113`) directly in the hook
  body. `feedSourceForDescriptor` (`src/state/streaming.ts:305-311`) already treats the same throw as unreachable
  null, but the query hook has no guard.
- Failure: a corrupt or legacy descriptor value in a persisted deck column crashes the mounting screen's render
  (up to the nearest screen-level boundary) instead of rendering the honest unsupported/unavailable state the
  backend convention (`ApiError` 404 + `errors.unsupported.*`) provides everywhere else.
- Fix: parse inside a `try` and return a disabled query carrying the typed `FediError`, or pre-validate with
  `isFeedDescriptor` (`feedDescriptor.ts:116-124`).

### L6 (low) Native PKCE/fetch assumptions need a device check (`btoa` fallback, `redirect: "manual"`)

- `packages/fedi/src/mastodon/oauth.ts:618-633` (`s256Challenge`): `new TextEncoder().encode` at `:619` and the
  `crypto.subtle` probe at `:621` assume globals the polyfill (`src/platform/polyfills.ts:14-41`, crypto only)
  does not install; when `btoa` is absent the fallback at `:630-633` emits a hex string instead of base64url, which
  the server will reject as a PKCE challenge mismatch.
- `packages/fedi/src/core/http.ts:356`, `mastodon/client.ts:347`, `misskey/client.ts:399` assume fetch honors
  `redirect: "manual"`. The unauthenticated prober already distrusts implementations that ignore it
  (`core/detect.ts:848-858`, re-validates `res.url`), but the credentialed transports do not re-check — on a
  runtime that silently follows, the 3xx refusal never fires and the credential follows.
- Status: needs device check — not verified on Hermes. If `TextEncoder`/`btoa`/`redirect: "manual"` all behave on
  the shipping runtime, L6 dissolves to the `pureSha256` fallback path (already correct) plus one hardening
  (`res.url` origin re-check on credentialed paths).

## Looked solid

- Origin/token scoping: `requestJson` takes no token (`core/http.ts:9-18,285-289`); `request()` refuses cross-origin
  absolute URLs before I/O (`mastodon/client.ts:272-299`); Misskey client is built from one session with an
  `endpointPath` same-origin guard (`misskey/client.ts:141-156,260-298`); `credentials: "omit"` on every fetch;
  Link-continuation cross-origin fallback re-fetches on the session origin with cursor params only
  (`mastodon/pagination.ts:147-166`).
- Deadline discipline: body reads inside the timer on all credentialed paths (`core/http.ts:374-427`,
  `mastodon/client.ts:363-422`, `misskey/external.ts:178-229` `postDirect`, `misskey/client.ts:337-449` upload);
  abort surfaces as typed `aborted`, never retried (`retry.ts:7-32`); redirect refusal typed before any second
  request on all of them (H1's `externalUploadFile` excepted).
- Retry/paging: `retryPolicy` excludes 401/403/404/410/422/429 and aborts (`retry.ts:34-41` via
  `isNonRetryableStatus`, `core/errors.ts:178-186`); `usePagedLoad` gates scroll/end prefetch on error state,
  429 cooldown with countdown, and a burst latch (`usePagedLoad.ts:81-150`), wired at both `HomeFeed` call sites
  (`src/screens/HomeFeed.tsx:240,448`) with footer-only explicit retry (`:463-477`); refresh trims to the first
  page (`:178-187`); end-of-feed is link/empty-page only on both families (`pagination.ts:116-122`,
  `misskey/adapt.ts:595-631`).
- Online/foreground: `setupQueryLifecycle` wires NetInfo→`onlineManager` and AppState→`focusManager` with budgeted
  foreground refetch of feed/notification/`me` only (`queries/lifecycle.ts:1-317`, mounted in
  `Provider.tsx:211-217`); streams suspend after 30 s background and nudge dead handles on resume
  (`streaming.ts:584-611,684-706,768-849`).
- Streams: breakers count accept-then-close loops and reset on healthy close only, both families
  (`mastodon/stream.ts:384-425,578-589`; `misskey/stream.ts:412-447,481-493`); Mastodon ack watchdog
  (`stream.ts:565-577`), Misskey dial watchdog plus heartbeat with 2-missed-pong reconnect
  (`misskey/stream.ts:147-157,330-407,466-479`); subscribes queue until open with ack armed on send
  (`misskey/stream.ts:265-298`); token never in Mastodon URL (subprotocol pair); per-session backend+handle
  pooling (`api/client.ts:239-292`) with session-identity memo in `usePostFeedQuery` (`:211-222`) and
  `useBackendForSessionId` (`HomeFeed.tsx:62-70`).
- Uploads (except H1): size-scaled deadlines plus 60 s stall detection on both families
  (`core/backend.ts` `uploadTimeoutForBytes`, `mastodon/endpoints.ts:1413-1543`, `misskey/client.ts:304-449`);
  upload timeouts report `errors.network.timeoutUpload`, never instance-timeout; per-item cancel in the composer
  (`queries/composer.ts:781-837`).
- Randomness: `core/random.ts:1-47` throws `errors.crypto.unavailable` with no `Math.random` fallback; installed at
  boot by `src/platform/polyfills.ts:14-41`; jitter uses the same seam (`misskey/stream.ts:300-321`).
- Privacy/persistence: default-deny persist allowlist with private-row stripping and first-page trim
  (`queries/persistPolicy.ts:46-161,198-260`), per-session split blobs, and purge-on-remove covering queries,
  storage, memory, and stream stops (`state/session/purge.ts:1-260`, registered in `Provider.tsx:210`).
- Remote-post fetches are lazy (menu tap) with public-https-only policy and manual redirects
  (`components/Post/PostCard.tsx:509-523`, `misskey/remotepost.ts:109-149`); the per-render warm is gone.
