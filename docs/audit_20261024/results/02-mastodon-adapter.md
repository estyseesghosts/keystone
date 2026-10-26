# Mastodon Adapter Audit

Scope: `packages/fedi/src/mastodon/*.ts` + `packages/fedi/test/mastodon-*.test.ts`.
Method: full read of every in-scope file, grep/shell for signatures, `wc -l` for sizes, targeted test run.
Verification: `NODE_ENV=test npx jest mastodon-adapt mastodon-stream mastodon-oauth-scopes` → 3 suites, 80 tests, all pass.

## File sizes

`wc -l` (exact):

| File | LOC | >650 |
|---|---|---|
| `packages/fedi/src/mastodon/backend.ts` | 1687 | YES |
| `packages/fedi/src/mastodon/endpoints.ts` | 1329 | YES |
| `packages/fedi/src/mastodon/oauth.ts` | 829 | YES |
| `packages/fedi/src/mastodon/adapt.ts` | 812 | YES |
| `packages/fedi/src/mastodon/stream.ts` | 698 | YES |
| `packages/fedi/src/mastodon/wire.ts` | 672 | YES |
| `packages/fedi/src/mastodon/admin.ts` | 473 | no |
| `packages/fedi/src/mastodon/client.ts` | 469 | no |
| `packages/fedi/src/mastodon/presentation.ts` | 425 | no |
| `packages/fedi/src/mastodon/instance.ts` | 322 | no |
| `packages/fedi/src/mastodon/quoteMarker.ts` | 312 | no |
| `packages/fedi/src/mastodon/compose.ts` | 252 | no |
| `packages/fedi/src/mastodon/tags.ts` | 217 | no |
| `packages/fedi/src/mastodon/pagination.ts` | 191 | no |
| `packages/fedi/src/mastodon/statusActions.ts` | 180 | no |
| `packages/fedi/src/mastodon/conversations.ts` | 151 | no |
| `packages/fedi/src/mastodon/thread.ts` | 137 | no |
| `packages/fedi/src/mastodon/auth.ts` | 131 | no |
| `packages/fedi/src/mastodon/domainBlocks.ts` | 92 | no |
| `packages/fedi/src/mastodon/listMembership.ts` | 18 | no |

Six files exceed 650 LOC. Of those, `wire.ts` (672, pure interfaces) and `oauth.ts` (829, dominated by a ~110-line scope-history comment block at `packages/fedi/src/mastodon/oauth.ts:37-116` plus a vendored SHA-256 at `packages/fedi/src/mastodon/oauth.ts:448-508`) are large for defensible reasons. The genuine split candidates are `backend.ts` + `endpoints.ts` (see Condensed responsibility).

## Long-parameter functions

No function takes >4 positional parameters. The codebase consistently uses single-`opts` bags for complex calls:

- `packages/fedi/src/mastodon/oauth.ts:348` `registerApp(opts)` (7 fields)
- `packages/fedi/src/mastodon/oauth.ts:532` `buildAuthorizeUrl(opts)` (6 fields)
- `packages/fedi/src/mastodon/oauth.ts:641` `exchangeCode(opts)` (6 fields)
- `packages/fedi/src/mastodon/oauth.ts:705` `passwordGrant(opts)` (6 fields)
- `packages/fedi/src/mastodon/oauth.ts:737` `mfaChallenge(opts)` (6 fields)
- `packages/fedi/src/mastodon/auth.ts:44` `finishOAuthExchange(opts)`; `packages/fedi/src/mastodon/auth.ts:78` `firstPartyPasswordSignin(store, origin, redirectUri, username, password, flavor?)` (6 positional, all required scalars — acceptable, mirrors the grant)
- `packages/fedi/src/mastodon/statusActions.ts:63` `setStatusToggle(client, statusId, toggle, on)` and `packages/fedi/src/mastodon/statusActions.ts:118` `setEmojiReaction(client, statusId, emoji, on)` — 4 params each with a trailing `on: boolean`. Mild boolean-trap shape, mitigated by the `StatusToggle` union (`packages/fedi/src/mastodon/statusActions.ts:23`) and the pure helpers `toggleEndpoint` (`packages/fedi/src/mastodon/statusActions.ts:28`), `toggleIsOn` (`packages/fedi/src/mastodon/statusActions.ts:34`), `optimisticToggle` (`packages/fedi/src/mastodon/statusActions.ts:42`).
- Same `(client, id, bool)` toggle-verb pattern in `packages/fedi/src/mastodon/endpoints.ts:887` `setStatusPinned`, `packages/fedi/src/mastodon/endpoints.ts:921` `setFollowing`, `packages/fedi/src/mastodon/endpoints.ts:933` `setMuted`, `packages/fedi/src/mastodon/endpoints.ts:945` `setShowingReblogs`, `packages/fedi/src/mastodon/endpoints.ts:955` `setBlocked`, `packages/fedi/src/mastodon/endpoints.ts:1085` `answerFollowRequest`. Verdict: idiomatic, no change needed.

## Condensed responsibility

`backend.ts` (1687) and `endpoints.ts` (1329) are big but NOT god files — each has one job:

- `endpoints.ts`: one typed wire call per endpoint (~40 exports), no adaptation logic beyond `adapt*` calls. Matches the Misskey adapter's stated discipline ("one place per endpoint", `packages/fedi/src/mastodon/endpoints.ts:782-786`). Cohesive.
- `backend.ts`: the `Backend` interface implementation. The factory `createMastodonBackend` (`packages/fedi/src/mastodon/backend.ts:432`) is a large method table, but the file also accumulates three separable helpers: v1/v2 filter adaptation (`packages/fedi/src/mastodon/backend.ts:294-369`), list helpers (`packages/fedi/src/mastodon/backend.ts:373-415`), and scheduled/boost/quote tail helpers (`packages/fedi/src/mastodon/backend.ts:1571-1687`).

Verdict: no split required now. If `backend.ts` grows further, the natural seams are `filters.ts` (filter adaptation + `withFilterFallback` at `packages/fedi/src/mastodon/backend.ts:359`) and `lists.ts` (`knownRepliesPolicy`/`adaptListRow`/`listFieldsBody`). Do NOT split `endpoints.ts` by resource — it would break the per-family one-place-per-endpoint layout both adapters share.

## Suspected bugs (file:line)

Severity-ordered. "Verified OK" items (asked for in scope) are listed after the defects.

1. **Dead quote-resolution copy in `endpoints.ts` (~47 dead lines).** `resolveTextualQuote` (`packages/fedi/src/mastodon/endpoints.ts:618`), `searchQuotedStatus` (`packages/fedi/src/mastodon/endpoints.ts:633`), `quoteLookups` (`packages/fedi/src/mastodon/endpoints.ts:608`), `QUOTE_MISS_TTL_MS` (`packages/fedi/src/mastodon/endpoints.ts:600`) have **zero callers** anywhere in repo. The backend instead uses its own duplicates: `resolveQuote` (`packages/fedi/src/mastodon/backend.ts:1638`), `pickQuoteTarget` (`packages/fedi/src/mastodon/backend.ts:1675`), `quoteLookups` (`packages/fedi/src/mastodon/backend.ts:1636`), `QUOTE_MISS_TTL_MS` (`packages/fedi/src/mastodon/backend.ts:1635`). Worse, the two matchers have **different semantics**: `pickQuotedStatus` (`packages/fedi/src/mastodon/quoteMarker.ts:301`) uses `urisMatch`, while the backend's `pickQuoteTarget` (`packages/fedi/src/mastodon/backend.ts:1675-1687`) uses verbatim + `new URL().href` comparison. Same job, two answers.
2. **Fabricated notification timestamps.** `adaptV2Notification` (`packages/fedi/src/mastodon/adapt.ts:675`) and `adaptV2Group` (`packages/fedi/src/mastodon/adapt.ts:731-733`) fall back to `new Date().toISOString()` when the server omits `created_at`. Core `Notification.createdAt` is non-nullable `string` (`packages/fedi/src/core/models.ts:735`), so the type forces the lie. Violates the repo's never-fake-data rule; a grouped row with no date renders as "now" and sorts first.
3. **Three divergent absence predicates.** `endpoints.ts:179-186` accepts `MastoHttpError | ApiError`; `tags.ts:56-58` and `backend.ts:204-206` accept only `ApiError`. Consequence: direct (non-backend) callers of `featureTag`/`unfeatureTag` (`packages/fedi/src/mastodon/tags.ts:181-211`) with a raw 404 skip the documented version fallback and throw. Backend paths are safe (guarded client adapts first, `packages/fedi/src/mastodon/backend.ts:209-228`), so this bites tests/scripts/direct callers only.
4. **`accountLookupFailure` is dead AND would misclassify.** Zero callers; and it matches only `MastoHttpError` (`packages/fedi/src/mastodon/endpoints.ts:262-268`), so behind the backend (where every error is adapted `ApiError`) a 404 would read `"error"` instead of `"gone"`. Either delete it or make it accept both classes before first use.
5. **Scope-fallback retries on any 4xx.** `registerApp` (`packages/fedi/src/mastodon/oauth.ts:392-404`) falls back to `FALLBACK_SCOPES` on any 400–499 when no discovery doc exists — including 401/403 (registration forbidden), not just the 422 scope error the fallback exists for. The `discoveryPresent` gate (`packages/fedi/src/mastodon/oauth.ts:321`) narrows the blast radius, but a 403 becomes a second confusing registration attempt instead of surfacing immediately.
6. **Shape-error swallowing is inconsistent.** `fetchStatusHistory` (`packages/fedi/src/mastodon/endpoints.ts:808-816`) and `fetchCustomEmojis` (`packages/fedi/src/mastodon/endpoints.ts:1285-1288`) return `[]` on a non-array 200 body, while every other listing throws `FediError(errors.shape.*)`. A malformed history silently reads as "unedited".
7. **Empty PATCH in `updateAdminReport`.** (`packages/fedi/src/mastodon/admin.ts:455-473`) builds `body = {}` when neither `category` nor `ruleIds` is set and sends it anyway — the server likely 422s. Guard client-side (throw or no-op with a reason).
8. **`conversation` stream events are dropped.** `routeMessage` (`packages/fedi/src/mastodon/stream.ts:403-505`) handles `update`/`status.update`/`delete`/`notification`/`kill`/`filters_changed`/`ping`/`connected` but has no `conversation` branch, so the DM inbox (`packages/fedi/src/mastodon/conversations.ts`) never live-updates despite the socket being shared. Gap, not crash.
9. **Link-header parser edge cases (low probability).** `value.split(",")` (`packages/fedi/src/mastodon/pagination.ts:32`) breaks on literal commas inside URLs; the failure mode is safe (part fails the regex at `packages/fedi/src/mastodon/pagination.ts:33` and is skipped → early end-of-feed, never a wrong page). `cursorsFromUrl` (`packages/fedi/src/mastodon/pagination.ts:108-115`) parses `?offset=` (empty) as `0` via `Number("")`. Trivial.
10. **Misleading dead comment.** `packages/fedi/src/mastodon/client.ts:398-399` discusses 202/206 inside the `if (!response.ok)` branch, which 202/206 can never reach. Cosmetic; move or delete.
11. **Quote-shape detection fragility (watch-item, not a bug today).** `adaptQuote` (`packages/fedi/src/mastodon/adapt.ts:412`) keys the Mastodon branch on `"state" in quote`. Correct today (wire `Status` has no `state` field), but a future server-added `state` field on `Status` would misroute Akkoma-shaped quotes. Consider keying on `"quoted_status" in quote` OR (`"state" in quote` AND NOT `"id" in quote`).
12. **Streaming-origin host trust (documented residual risk).** `streamingOriginAllowed` (`packages/fedi/src/mastodon/stream.ts:106-120`) pins only the *scheme*; the Bearer subprotocol pair (`packages/fedi/src/mastodon/stream.ts:243-247`) is then sent to whatever host the instance advertises. A malicious instance could harvest tokens via a third-party streaming host. Acceptable only because the instance already holds the token via REST — worth one line in the contract doc.

Verified OK (explicitly checked, no action):

- **Streaming is WebSocket, not SSE.** `defaultFactory` (`packages/fedi/src/mastodon/stream.ts:70-82`), subprotocol auth (`packages/fedi/src/mastodon/stream.ts:243-247`), no `EventSource`/SSE string anywhere in `mastodon/`. Ping/pong (`packages/fedi/src/mastodon/stream.ts:407-410`), `kill` no-reconnect (`packages/fedi/src/mastodon/stream.ts:439-444`), 5-fast-close breaker (`packages/fedi/src/mastodon/stream.ts:377-392`), 10s ack watchdog (`packages/fedi/src/mastodon/stream.ts:161`) all present.
- **OAuth scope handling.** Triple + `admin:read`/`admin:write` for mastodon flavor (`packages/fedi/src/mastodon/oauth.ts:218-221`), full NOW set otherwise; `read:conversations` correctly never requested (`packages/fedi/src/mastodon/oauth.ts:156-166`, 422 history documented); 502 ~512-char history documented (`packages/fedi/src/mastodon/oauth.ts:193-199`). `LoginFlows.ts:262` passes `pending.scopes` to `getCachedApp`, so the per-flavor cache binding is correct.
- **Token per-origin isolation.** Cross-origin absolute URLs rejected pre-token (`packages/fedi/src/mastodon/client.ts:266-280`); `feedClient` pairs each session's token with its own origin (`packages/fedi/src/mastodon/endpoints.ts:67-77`); quote caches keyed per origin+token (`packages/fedi/src/mastodon/endpoints.ts:619`, `packages/fedi/src/mastodon/backend.ts:1639`).
- **204/empty-body handling.** Text-first parsing, empty → `data: undefined` (`packages/fedi/src/mastodon/client.ts:370-394`); toggle/pin/edit paths read back via `getStatus` on empty bodies (`packages/fedi/src/mastodon/statusActions.ts:63-74`, `packages/fedi/src/mastodon/endpoints.ts:873-898`).
- **Status/reblog mapping.** Wrapper counts stay on the wrapper, original in `renote` (`packages/fedi/src/mastodon/adapt.ts:475-509`); display correctness owned by `isPureReblog`/`collapseReblogs` (`packages/fedi/src/mastodon/presentation.ts:347-425`). By design.
- **Pagination end rule.** `no next link OR empty page, never length < limit` is implemented uniformly (`packages/fedi/src/mastodon/pagination.ts:133-135`, all page builders).
- **Thread/reply resolution.** Cycle guard + orphan-to-top-level in `rebuildThread` (`packages/fedi/src/mastodon/thread.ts:60-137`); `incomplete` flag (`packages/fedi/src/mastodon/backend.ts:554-556`). Sound on read.
- **Wire-type leakage.** None found: `src/` imports only domain models via `@keystone/fedi`; `index.ts` keeps `./mastodon/wire` internal; the `ext.mastodon` bag is the sanctioned channel (read in `packages/fedi/src/mastodon/admin.ts:215-228`), not a wire leak.

## Quality issues

- **`as any` casts (4, all in `adapt.ts` grouped-notification path):** `packages/fedi/src/mastodon/adapt.ts:664`, `:670`, `:716`, `:721` — envelope `Record<string, unknown>` values cast to `any` for `adaptAccount`/`adaptStatus`. Type the envelope once (narrow to `Status`/`Account` with a guard) instead of casting at four sites. Related: `raw as any` in `packages/fedi/src/mastodon/backend.ts:1447` (list timeline) and `:1500` (bookmarks) bypass wire typing while neighboring code (`fetchTimelinePage`, `statusPage`) is fully typed — make those two call sites use `Status[]` like the rest.
- **Duplication (mastodon-internal):** the quote-cache/matcher copies from §Suspected-bugs-1; `QUOTE_MISS_TTL_MS` defined twice (`packages/fedi/src/mastodon/endpoints.ts:600`, `packages/fedi/src/mastodon/backend.ts:1635`).
- **Duplication (mastodon/misskey):** both families carry independent quote caches and thread rebuilders (`packages/fedi/src/misskey/quote.ts:321` vs backend-local copies here; `packages/fedi/src/misskey/thread.ts` vs `packages/fedi/src/mastodon/thread.ts`). The thread case is justified (different wire shapes); the quote-cache case is not (both are "search-by-URI + TTL map") — candidate for one core helper if a third copy ever appears. No action now.
- **Stale comment:** `packages/fedi/src/mastodon/oauth.ts:17` says the injected-token entry point "is stubbed below" — it exists (`normalizeInjectedToken`, `packages/fedi/src/mastodon/oauth.ts:773`). Update the header.
- **No TODOs/FIXME/HACKs** in `mastodon/`; `console.debug` is dev-and-non-test-gated (`packages/fedi/src/mastodon/client.ts:35-47`). Both fine.
- **Error-construction inconsistency:** `fetchConversationsPage` builds `new ApiError` directly (`packages/fedi/src/mastodon/conversations.ts:77-83`) while the file header (`packages/fedi/src/mastodon/conversations.ts:17-18`) says errors are raw `MastoHttpError` adapted at the boundary. Harmless (a self-built `ApiError` passes through `toApiError` untouched, `packages/fedi/src/mastodon/client.ts:141-160`), but the header should say shape errors are pre-adapted.
- **`voteInPoll` does GET-then-POST** (`packages/fedi/src/mastodon/endpoints.ts:906-917`): two round trips per vote and a TOCTOU window on the poll id. Unavoidable with current core `Poll` (carries no id) — noted, no fix without a model change.
- **`unreact` sequential loop** (`packages/fedi/src/mastodon/backend.ts:487-494`): N sequential DELETEs; correct, could `Promise.all` but failure atomicity is arguably better sequential. No action.

## Top 5 fix priorities

1. **Delete or rewire the dead quote-resolution copy** (`packages/fedi/src/mastodon/endpoints.ts:598-646`). Either delete it (backend owns resolution via `packages/fedi/src/mastodon/backend.ts:1638-1687`) or make the backend use it — and unify the matcher semantics (`urisMatch` in `packages/fedi/src/mastodon/quoteMarker.ts:301` vs verbatim+href in `packages/fedi/src/mastodon/backend.ts:1675`). Two behaviours for one job is the worst defect class here.
2. **Stop fabricating notification dates** (`packages/fedi/src/mastodon/adapt.ts:675`, `:731-733`). Widen core `Notification.createdAt` to `string | null` (as `Account.createdAt` already is, `packages/fedi/src/core/models.ts:186`) and let the row sort last / render dateless, instead of stamping "now".
3. **Unify the three absence predicates** into one shared helper accepting both `MastoHttpError` and `ApiError` (canonical form already exists at `packages/fedi/src/mastodon/endpoints.ts:179-187`; point `packages/fedi/src/mastodon/tags.ts:56` and `packages/fedi/src/mastodon/backend.ts:204` at it). Fixes the `featureTag`/`unfeatureTag` direct-caller fallback gap and prevents a fourth variant.
4. **Narrow the `registerApp` scope fallback** (`packages/fedi/src/mastodon/oauth.ts:392-404`) to scope-shaped rejections (422 / `invalid_scope`-ish bodies) instead of any 4xx, so 401/403 surface immediately rather than burning a second registration.
5. **Handle `conversation` stream events or record the gap** (`packages/fedi/src/mastodon/stream.ts:403-505`): either route them to a listener set (DM inbox live-update) or document in `packages/fedi/src/mastodon/conversations.ts:1-21` that the inbox is poll-only. Also resolve `accountLookupFailure` (`packages/fedi/src/mastodon/endpoints.ts:262`: delete or fix-then-use) and guard the empty PATCH (`packages/fedi/src/mastodon/admin.ts:455-473`) in the same pass — all three are small, adjacent cleanups.
