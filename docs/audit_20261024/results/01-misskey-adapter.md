# Misskey Adapter Audit

Scope: `packages/fedi/src/misskey/*.ts` (31 files, 8053 LOC total) + `packages/fedi/test/misskey-*.test.ts` (20 files, 5249 LOC).
Method: full read of backend/stream/wire/adapt/external/client/translate/quote/chat/admin/auth; `cat` of the 17 small modules; `wc -l`, `grep` for signatures/`any`/TODO/wire-leak/test-coverage.

## File sizes (>650 LOC table)

`wc -l` (exact):

| File | LOC | >650? |
|---|---|---|
| `backend.ts` | 1570 | YES |
| `stream.ts` | 787 | YES |
| `wire.ts` | 631 | no (28 lines under) |
| `adapt.ts` | 580 | no |
| `external.ts` | 522 | no |
| `translate.ts` | 442 | no |
| `client.ts` | 384 | no |
| `quote.ts` | 360 | no |
| `chat.ts` | 330 | no |
| `admin.ts` | 273 | no |
| `customEmoji.ts` | 272 | no |
| `importExport.ts` | 253 | no |
| `recommendations.ts` | 229 | no |
| `softMute.ts` | 192 | no |
| `auth.ts` | 156 | no |
| `thread.ts` | 138 | no |
| rest (15 files) | ≤94 each | no |

Only 2 files exceed 650. `wire.ts` (631) is fine as a types+pure-helpers file. No split needed for `stream.ts` yet (see §Condensed responsibility); `backend.ts` needs one.

## Long-parameter functions

No function takes >4 positional params. The maxima (4 each, both end in an options bag — acceptable):

- `recommendations.ts:79` `fetchRecommendationPage(call, origin, cursor, opts = {})`
- `like.ts:48` `likeViaNotesLike(call, origin, noteId, override)`
- `backend.ts:803` call site `fetchRecommendationPage(call, opts.origin ?? null, o.cursor ?? null, o)` — 4 args, fine.

Other observations:

- **Options-bag discipline is good.** New surfaces use bags: `chat.ts:219` `CreateChatRoomOpts`, `chat.ts:232` `ChatTimelineOpts`, `chat.ts:269` `SendChatMessageOpts`, `importExport.ts:57` `ImportOptions`, `admin.ts:182` `AbuseUserReportsPageOptions`, `client.ts:62` `UploadOptions`. No boolean-trap params in new code (`chat.ts:204` `rooms?: boolean` is inside a bag, fine).
- **Mild smell: positional pagination** in `mutes.ts:47,55,63` (`limit = 20, untilId?`), `favorites.ts:20`, `featured.ts:20,31`, `schedule.ts:20`, `serverDrafts.ts:19` (`limit = 20, untilId?, sinceId?`). Positional optionals don't scale; a `{limit, untilId, sinceId}` bag would match the rest of the codebase. Low priority.
- `stream.ts:454` `subscribeChannel(channel, params, handlers, token = activeToken)` and `stream.ts:511` `captureNote(noteId, onUpdated, token = activeToken)` — the trailing `token` param is the token/origin weak spot (see B6).

## Condensed responsibility

1. **`backend.ts` (1570 LOC) is the god file.** `createMisskeyBackend` (`backend.ts:261-1493`) builds ~30 API groups in one closure: drive, antennas, clips, channels, chat, announcements, adminInsight, reportsQueue, lists, scheduled, serverDrafts, bookmarks, transfer, recommendations, timeline/post/thread/replies/reposts/reactions, create/edit/delete/react/boost/vote, account/follow/mute/block/report, search/explore, notifications, emoji, upload, translate, stream. It also owns `wireVisibility` (`backend.ts:204`), `createNoteBody` (`backend.ts:218`), `listAccounts` (`backend.ts:1480`), `adaptServerDraft` (`backend.ts:1509`), `antennaBody`/`adaptAntenna` (`backend.ts:1525,1541`). Mapping + networking + body-building + paging + business rules (report normalization at `backend.ts:1233-1259`) all live here. Split candidates (each already has a module to grow into): drive block → `drive.ts`; antennas block → `antennas.ts`; `createNoteBody`/`wireVisibility`/`editPost` body logic → `noteBody.ts` shared by create/edit/scheduled/drafts (today the same poll/visibility shape is rebuilt 4×: `backend.ts:218`, `backend.ts:942-979`, `backend.ts:698-711`, `backend.ts:729-751`).
2. **`stream.ts` (787 LOC) has two jobs** — generic pool (`stream.ts:181-580`) + `StreamHandle` adapter (`stream.ts:675-770`) — but the split is clean (one factory boundary, `StreamPoolOptions`/`StreamHandleOptions` at `stream.ts:99,669`). Acceptable; no action.
3. **`translate.ts` (442 LOC) mixes three concerns**: translator instance (`translate.ts:73-156`), MFM prose policy (`translate.ts:253-324`), display policy (`translate.ts:378-395`), outcome/retry bus (`translate.ts:407-442`). Cohesive enough; no action, except the module-global caches are a bug (B3).
4. **`wire.ts` (631 LOC)** mixes wire interfaces, reaction-acceptance labels, follow/renote/collapse helpers, admin/report wire shapes. All pure; acceptable.
5. **`external.ts` (522 LOC)** mixes MiAuth HTTP (`external.ts:158-314`), session-store facade (`external.ts:401-487`), legacy migration (`external.ts:497-522`). Acceptable, but has an ESM style violation: second `import` block at `external.ts:352-361` mid-file (hoisted, works, but lint-unfriendly).

## Suspected bugs (with file:line refs)

**B1 — `users/relation` wrong param name on the main path (highest confidence).** `backend.ts:1104` sends `{ userIds: ids }` (plural) while `mutes.ts:14` sends `{ userId: userIds }` (singular). Upstream Misskey `users/relation` takes `userId: string[]` (singular — matches `mutes.ts`). So `Backend.relationships()` sends an unknown field: Sharkey 400s on unknown fields, stock Misskey ignores it and returns unfiltered/everything. Zero test coverage: `relationships` appears in no `misskey-*.test.ts`. Fix: `userIds` → `userId` in `backend.ts:1104`, add a param-shape test.

**B2 — `noteReactions` crashes on missing `user`.** `backend.ts:926` does `adaptAccount(row.user as UserDetailed)` with no guard; `adaptAccount` (`adapt.ts:80-126`) dereferences `user.id`/`user.username` unconditionally. Deleted/gone reactors (or a fork omitting the pack) → `TypeError`. Contrast `chat.ts:115,129,164`, which all check `typeof rec.id === "string"` before adapting. Fix: skip rows without a string-id user (or map to null-account row).

**B3 — module-global caches leak data across sessions/accounts (multi-account correctness).**
- `translate.ts:201-208`: `completed`, `inflight`, `failedAt` are module globals keyed by bare `noteId`. Two translator instances (accounts A, B) share them: B reads A's cached translation, A's failure-suppression silences B's retry (`translate.ts:110-113`), `requestTranslation` gates on per-instance `capabilityValue` (`translate.ts:107`) so cross-account staleness is silent.
- `translate.ts:407-408`: `outcomes`, `retries` same problem; `retryTranslation` (`translate.ts:438-442`) for account A triggers refetch UI for account B.
- `quote.ts:273-274,310-311`: `seenByUri`/`seenById`/`completedLookups`/`inflightLookups` are module globals keyed by URI. `resolveQuoteUri` (`quote.ts:321-352`) serves `seen`/`completed` without any session check: account A resolves a followers-only note via credentialed `ap/show`, account B (no access) gets the cached `Post` — a visibility bypass within the app. Failure-nulls are also cached permanently (`quote.ts:344`) with no retry: a note that becomes visible later never resolves.
- `remotepost.ts:29-30` (`resolved`/`inflight` keyed by URI): same shape but only caches public page URLs — low severity.
- `softMute.ts:56` `regexCache`: unbounded module-global `Map`, never evicted (minor memory leak; attacker-influenced keys via filter text).
Fix: scope caches per translator instance / per session (pass a cache object in, or key by `${origin}${accountId}`), add TTL+retry to quote lookups.

**B4 — `updateProfile` forwards `ext` verbatim → Sharkey 400 risk.** `backend.ts:1153` `Object.assign(params, patch.ext ?? {})`. Any caller-controlled `ext` key the server doesn't know is a 400 on Sharkey. Pinned by test (`misskey-backend.test.ts:298-317`), so it's intentional — but there is no allow-list. Fix: allow-list the known `i/update` fields, drop/ignore unknown with a documented rule.

**B5 — `antennaBody` sends `userListId: null` and all fields unconditionally.** `backend.ts:1525-1539` always includes `userListId` (null for non-list antennas), `keywords`, etc. Null/empty-field sends are exactly what Sharkey 400s on (cf. the discipline comments at `backend.ts:293-294,325-327`). Fix: omit null/empty fields like every other call site.

**B6 — stream per-call `token` param invites cross-session socket thrash.** `stream.ts:458`/`stream.ts:513` accept `token` defaulting to `activeToken`; `retain` (`stream.ts:402-426`) closes and reopens the socket on token change. Two handles with different tokens on one pool → close/reopen ping-pong; rapid token flips reset backoff (`stream.ts:417-420`). Today pools are per-session so this is latent, but the parameter suggests sharing is safe when it isn't. Fix: remove the `token` params (pool owns exactly one session credential), or document that one pool = one session and assert.
Also `close()` (`stream.ts:557-579`) never resets `poolStatus` — after close, `status()`/`snapshot()` report stale `live`/`reconnecting`/`error`. `release()` (`stream.ts:428-447`) resets to `connecting`; `close()` should reset too.

**B7 — bookmarks ignore the caller's limit (wrong `end` flag).** `backend.ts:760-769` computes `limit` but `listFavorites(call, cursor.untilId)` (`favorites.ts:20-28`) always sends `limit: FAVORITES_PAGE` (20). `pageOf(rows, limit)` then compares a 20-row fetch against the caller's limit: `limit: 50` → `end: true` after one page (pagination stalls); `limit: 5` → 20 rows adapted for a 5-row page. Fix: thread `limit` through `listFavorites`.

**B8 — `account()` sends `{}` when ref is empty → 400.** `backend.ts:1053-1061`: if `ref` has neither `id` nor `username`, `params` stays `{}` and `users/show` 400s. Fix: throw a local `FediError` (comment-required pattern at `backend.ts:1244-1249`) before I/O.

**B9 — legacy-migration shape mismatch.** `external.ts:514` does `adaptMe(s.user as MeDetailed)` where `s.user` is a cached **core Account** (has `bio: Content` object, `acct`, `displayName`), not a wire `MeDetailed`. `bioContent` (`adapt.ts:139-145`) then reads `.length` off an object and `plainFromMfm` receives an object — mis-map or crash on flip-time reload. Fix: detect the core shape (e.g. `acct`/`bio` object present) and carry it through as-is instead of re-adapting.

**B10 — chat send failures throw unlocalizable plain `Error`.** `chat.ts:297,310` (`createRoomMessage`, `createUserMessage` empty-text guard). Every other user-facing failure in the package is `FediError` with a stable code. Fix: `FediError` + code.

**B11 — `fetchServerInfo` fabricates values.** `admin.ts:78-87` falls back to `""`/`0` for missing machine/os/cpu/mem/fs. `0` cores / `0` bytes is a real measurement, not "unknown" — contradicts the package's never-fake discipline (and `fetchQueueStats` at `admin.ts:108-118` correctly uses null). Fix: null-or-omit, matching queue counts.

**B12 — misc transport issues.**
- `client.ts:233-256` upload has no timeout (acknowledged in comment, matches old path) — a stalled Drive upload hangs forever with no retry signal. Fix: AbortController deadline like `postDirect` (`external.ts:160-161`).
- `external.ts:259-271` `externalUploadFile` also has no timeout; and hardcodes nothing about scheme — but `customEmoji.ts:125` hardcodes `https://` for remote host fetch, so `http://` dev instances can never load remote emoji. Fix: pass scheme through.
- `external.ts:244-255` `externalApiCall` precedence (`params.i ?? token`) is correct; but `postDirect` 200-with-empty-body returns `undefined as T` (`external.ts:213`) — `fetchExternalMe` (`external.ts:231-241`) would then `adaptMe(undefined)` → crash. Fix: validate non-empty before adapting.
- `backend.ts:1303-1311` `explore.users` `Promise.all`: one failing call fails the whole Explore page (pinned-users 404 on a fork kills popular-users too). Fix: `allSettled` with partial results.

**B13 — `translate.ts:220` `isTranslateResult` is dead code** (defined, never called — grep confirms single occurrence). Delete or use at `translate.ts:126-129`.

**B14 — `renoteMutes.ts:28` unsafe fallback.** `(row.mutee ?? row as UserDetailed)` — a row with null `mutee` adapts the muting row itself (`{id, createdAt, muteeId, mutee}` has no `username`) → `Account.username` undefined, downstream crash. Fix: filter rows without a string-id `mutee` (same guard as B2).

## Quality issues

- **`any` abuse: none found.** `grep -c "any"` hits are all inside `unknown`-handling or the word `company`-style substrings; every hit file uses `unknown` + narrowing (`admin.ts:48-64`, `chat.ts:96-102`, `quote.ts:56-69`). `Record<string, unknown>` (19 sites in `backend.ts`, 8 in `chat.ts`, 7 in `stream.ts`) is the honest wire-bag type, not abuse. **Wire `unknown`-typed optional fields** (`wire.ts:561-631` admin/report shapes) are a deliberate fork-drift strategy — fine.
- **Duplicated mapping logic (3 sites).**
  1. `mutes.ts:47-69` `listBlocks`/`listMutes`/`listRenoteMutes` are near-identical (endpoint string differs); `backend.ts:1180-1186` duplicates two of them via `listAccounts`. Collapse to one helper.
  2. `backend.ts:383-438` clips mapping re-spreads `ClipSummary` fields by hand 4× instead of reusing `clips.ts:22` `adaptClipSummary` (which is module-private — export it).
  3. Emoji-entry validation is written 3×: `backend.ts:1385-1392` (`customEmojis`), `customEmoji.ts:185-191` (store `load`), `customEmoji.ts:143-150` (remote hosts). Extract one `isValidEmojiEntry`.
- **Inconsistent null-vs-omit discipline is documented but fragile:** ~40 call sites hand-roll `...(x != null ? {x} : {})`. It works, but one lapse = Sharkey 400 (B5 is the live example). A tiny `pickDefined()` helper + lint rule would make the discipline structural.
- **Dead code:** `external.ts:55` `ACTIVE_KEY` (declared, never read — `SESSIONS_KEY` at `external.ts:54` survives only for legacy migration); `translate.ts:220` `isTranslateResult` (B13).
- **Naming:** consistent (`fetch*` reads, `list*` paged reads, `adapt*` pure maps, `create*` writes). Two exceptions: `chat.ts:203` `chatHistory` (verb-less; `listChatHistory` would match), `mutes.ts`/`renoteMutes.ts` overlap (`mutes.ts:63` `listRenoteMutes` returns `Account[]` while `renoteMutes.ts:18` `listRenoteMutes` returns `Page<Account>` — same name, different shapes; the backend uses the latter at `backend.ts:1212`. Rename the `mutes.ts` one or delete it).
- **Missing tests:** `Backend.relationships()` has zero coverage (see B1); `admin.ts` insight/report adapters (`fetchServerInfo`, `fetchInstanceMeta`, `fetchQueueStats`, `fetchAbuseUserReports`, `adaptAbuseUserReport`) have no direct unit tests (only `reportAccount` via `misskey-reports.test.ts`); `recommendations.ts` is unreferenced by any test file. Everything else has at least a referencing suite; `misskey-w8-modules.test.ts` (956 LOC) carries antennas/drive/schedule/drafts/softMute/remotepost/noteEdit/mutes/likeEmoji/listMembership.
- **No TODO/FIXME/HACK** in scope (only a `console.debug` dev-census line at `client.ts:211`, correctly gated by `__DEV__` + non-test env).
- **Non-null assertions:** none found (`grep` for `!.`/`!;`/`!)` clean).

## Top 5 fix priorities

1. **Fix `users/relation` param + cover `relationships()` (B1).** Wrong-field live bug on the main relationship path; one-line fix in `backend.ts:1104` (`userIds` → `userId`) plus a param-shape test. Validates the Sharkey-strict contract.
2. **Scope module-global caches per session (B3).** Quote `seen`/lookup maps are a cross-account visibility leak; translate caches leak translations/failure state across accounts. Move maps into instance state (translator factory / per-session quote cache) with TTL and retry for failed lookups.
3. **Guard `adaptAccount` call sites against missing users (B2, B14).** `backend.ts:926` and `renoteMutes.ts:28` crash on null packs; apply the `chat.ts` `typeof id === "string"` guard pattern and filter/skip.
4. **Break up `backend.ts`: extract `noteBody.ts` + `drive.ts` + `antennas.ts`.** Four copies of the create/edit/scheduled/draft body (B4/B5 live here) become one tested builder with omit-null semantics — fixes the Sharkey-400 class structurally, not per-site.
5. **Thread bookmarks limit + validate `account()` ref + `FediError` for chat guards (B7, B8, B10).** Small, test-pinned fixes that remove a pagination stall, a doomed 400, and two unlocalizable errors.
