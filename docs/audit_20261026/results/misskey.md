# Misskey adapter audit — Keystone v2 (2026-10-26)

Scope: ALL of `packages/fedi/src/misskey/` (`backend.ts`, `adapt.ts`, `stream.ts`, `client.ts`, `translate.ts`, `quote.ts`, `renoteMutes.ts`, `external.ts`, `auth.ts`, `wire.ts`, plus `mutes.ts`, `noteBody.ts`, `noteEdit.ts`, `favorites.ts`, `like.ts`, `emoji.ts`, `chat.ts`, `followRequests.ts`, `featured.ts`, `recommendations.ts`, `remotepost.ts`, `serverDrafts.ts`) and the Misskey-touching parts of `core/{detect,sessions,random}`. Read-only; no source modified. Only code-verified issues are findings with `file:line`. Upstream Misskey/Sharkey wire shapes recalled from memory are flagged "recalled from memory, needs live check" — no server source is in this repo.

## Summary

- 13 of the 17 prior findings (2026-10-25 M1–M17) are fixed in code: wrapper-row unwrapping (M1), `users/search` offset paging (M2), tolerant reaction-URL lookup (M3), honest-unknown `status_editing` on stock Misskey (M4), `notes/edit` `editId` + `{createdNote}` envelope (M5), explicit-null edit clears (M6), revoke sends `token` (M7), CSPRNG-only session ids (M8), `http` restricted to local hosts (M9), `fileIds` guard (M10), quote-adapt-crash TTL + `finally` cleanup (M11), stream handler isolation (M12), heartbeat + idle-on-release (M13), `movedTo` mapping (M14), empty-page-only `end` in `pageOf` (M15).
- New findings: 1 Medium (external multipart upload follows redirects with the credential and has no timeout), 1 Medium-low (`notes/like` always sends `override`, even null, against the repo's own omit-null discipline), 3 Low, 2 Info.
- No remaining module-global cross-account data leak: translate/quote caches are per-instance (the M11 fix held), `remotepost` is public-only by construction, and the remaining globals (`like`/`recommendations` support, `droppedEvents`, regex cache) hold no per-account data.
- Counts: 2 Medium, 3 Low, 2 Info. No High.

## Findings

### M1 (Medium) External Drive upload follows redirects with the credential and has no timeout

- `packages/fedi/src/misskey/external.ts:314-370` (`externalUploadFile`).
- Description: the multipart `drive/files/create` POST uses bare `fetchImpl(url, { method, credentials: "omit", body: form })` — no `redirect: "manual"`, no deadline. The same file's `postDirect` (`external.ts:178-196`) refuses 3xx with `errors.network.redirect`, and the internal upload (`client.ts:304-449`) does both a scaled deadline and the same redirect refusal. A 302 from the instance (or a MITM on the one remaining `http://` local target) re-posts the FormData — including the `i` token field — to the redirect target, and a hung upload never settles.
- Fix: mirror `postDirect`/internal upload — `redirect: "manual"` with the typed refusal, plus the scaled `uploadTimeoutForBytes` deadline (or at minimum the 30s `DIRECT_TIMEOUT_MS`).

### M2 (Medium-low) `notes/like` always sends `override`, even null

- `packages/fedi/src/misskey/like.ts:59` (`await call("notes/like", { noteId, override })`); caller default `backend.ts:488` (`override = null`).
- Description: the default like press (server's `defaultLike`) sends `{noteId, override: null}`. Every other Misskey-family writer in this package omits null/empty fields because Sharkey 400s on them (`noteBody.ts:5-13`, `client.ts:328-335`, `chat.ts:175-186`). Whether `notes/like` tolerates an explicit-null `override` is recalled from memory, needs live check — if it 400s, every default like press surfaces a user-visible error (the error is not `UNKNOWN_API_ENDPOINT`, so it rethrows rather than falling back to a heart reaction).
- Fix: verify live; if null is rejected, send `{noteId}` when `override == null` (keep `override` only when set).

### M3 (Low) `votePoll` with zero choices resolves success with zero requests

- `packages/fedi/src/misskey/backend.ts:513-550`.
- Description: `choices: []` skips the loop and returns `undefined` — the caller believes a vote landed. The `poll === null` no-poll guard (ADR 0010) shows the module wants local validation before wire traffic; an empty ballot is the same class of caller bug and currently succeeds silently.
- Fix: throw `errors.shape.noPoll`-adjacent typed error (or at minimum a documented no-op) when `choices.length === 0`.

### M4 (Low) Recommendation feed uses the short-page `end` heuristic removed from `pageOf`

- `packages/fedi/src/misskey/recommendations.ts:118-123` (`cursor: items.length < limit ? null : …`, `end: items.length < limit`).
- Description: `adapt.ts:586-611` deliberately uses empty-page-only `end` (M15: post-filtered endpoints return short non-empty pages while more exists). The fork `notes/recommendations` feed reintroduces the old rule, so a filtered short page ends infinite scroll early with no cursor to resume from.
- Fix: match `pageOf` — `end` only on an empty page, cursor whenever items exist (offset cursor already supports it).

### M5 (Low) Chat `deleted` stream event only handles a string body

- `packages/fedi/src/misskey/stream.ts:1052-1058` (`if (type === "deleted" && typeof body === "string")`).
- Description: any other shape (e.g. an object row, recalled from memory — the upstream chat-stream `deleted` payload shape needs live check) is silently ignored: the open thread never learns of the deletion until refetch. No crash (pool dispatch is guarded), just a missed update.
- Fix: verify the wire shape live; accept `{id}`-shaped bodies as well as bare strings.

### M6 (Info) Per-origin support caches are shared across accounts on one origin

- `packages/fedi/src/misskey/like.ts:29`, `packages/fedi/src/misskey/recommendations.ts:31` (`supportCache = new Map<string, boolean>()`, keyed by origin).
- Description: deliberately server-scoped (endpoint presence is not per-account), and only 404/405/`UNKNOWN_API_ENDPOINT` verdicts are cached — never 403s — so a low-scope token cannot poison a full-scope token's probe. Benign as written; noted because the audit scope explicitly asked about module-global caches. Same verdict for the other remaining globals: `stream.ts:162` `droppedEvents` (process dev counter only), `softMute.ts:64` `regexCache` (pure function cache, no account data), `remotepost.ts:38-39` (public-only, `credentials: "omit"`, documented at `remotepost.ts:18-25`), `client.ts:522` `permissionDeniedObserver` (single app-owned slot by design).

### M7 (Info) Wire shapes matching memory but unverified live

- `backend.ts:645-652` + `mutes.ts:22-26` (`users/relation` `{userId: string[]}`); `favorites.ts:22-31` (`i/favorites` `{limit, untilId}`); `backend.ts:623-643` (`users/reactions` rows read as `{id, createdAt, reaction, note?}`); `backend.ts:880-889` (explore `users` `{state: "alive", origin: "local", sort: "+follower"}`); `backend.ts:426-449` (`notes/reactions` rows `{id, createdAt, user, type}` with `untilId` paging); `followRequests.ts:8-33` (`following/requests/*` with `{userId}` accept/reject/cancel); `backend.ts:769-771` (`notes/thread-muting/create` `{noteId}`).
- Description: all match recalled Misskey/Sharkey shapes, but each is recalled from memory, needs live check (no server source in repo; fixtures are synthesised per the 2026-10-25 audit). No code contradiction found in any of them. Record one live fixture per shape (`scripts/fedi-smoke` or recorded fixtures) to close this class for good.

## Looked solid

- Account lists: `backend.ts:282-307` unwraps `follower`/`followee`/`mutee`/`blockee` via `pageOfAccountRows` (`mutes.ts:99-110`), cursor stays on the row id, deleted-user rows skipped, bare-user fork rows tolerated (`mutes.ts:76-92`). `renoteMutes.ts:19-35` consistent.
- Search: `users/search` offset paging both directions (`backend.ts:830-868`, `pageOfOffset` in `adapt.ts:618-632`); cursor never carries `untilId` there.
- Reactions: `adaptReactions` resolves via `lookupPackedEmojis` (`adapt.ts:271-283`); `withReaction` (`wire.ts:535-555`) adjusts counts symmetrically.
- Edit: `editId` param + `{createdNote}`-tolerant parse (`noteEdit.ts:46-56`); explicit-null clears for text/cw/`fileIds: []`/`poll: null`, unknown stays omitted (`noteBody.ts:93-112`); create builder still omits empties (`noteBody.ts:62-82`).
- Poll vote: honestly non-atomic N-writes with `errors.poll.partialVote` `{recorded, total, cause}` (`backend.ts:513-550`); `poll.id` stays null per ADR 0010 (`adapt.ts:251-267`).
- Revoke: internal `sessions.ts:826-837` sends `{i, token}` + optional `tokenId`, returns `response.ok`; external `external.ts:416-419` sends `{token}` through the `i`-injecting call. Network-error best-effort-true is documented, not silent.
- Session ids: `auth.ts:65-67`, `external.ts:137-139` via `randomUuid` (`core/random.ts:77-89`) — CSPRNG-only, throws without one, no `Math.random` fallback anywhere in the package.
- `normalizeHost` (`external.ts:73-128`) routes cleartext through `rejectNonLocalHttp`; MiAuth check/verify paths (`external.ts:260-294`) validate shapes before adapting.
- `isPureRenote` tolerates absent `fileIds` (`wire.ts:426-434`); `countServerDrafts` tolerates empty body (`serverDrafts.ts:50-55`); bookmarks skip note-less rows but page on the row id (`favorites.ts:37-54`); `noteReactions` skips user-less rows (`backend.ts:439-442`); chat adapters are total (nulls, never throws: `chat.ts:108-173`).
- Quote resolver: per-backend maps, adapt crash recorded as TTL failure with `finally` cleanup of inflight (`quote.ts:364-402`); failures suppress for `QUOTE_LOOKUP_FAILURE_TTL_MS` with eviction caps (`quote.ts:301-311`). Translator likewise per-instance with TTL failures and caps (`translate.ts:122-217`).
- Stream: channel dispatch and `noteUpdated` fan-out both isolated per handler (`stream.ts:568-576`, `607-613`); timeline/notification/chat ingress validates shape before adapting and counts drops (`stream.ts:946-961`, `987-1000`, `849-858`); heartbeat with two-missed-pong reconnect, dial watchdog, quick-close fast-fail (`stream.ts:330-407`, `449-479`, `412-447`); `release()` reports `idle`, mapped to `unavailable` (`stream.ts:658-686`, `830-839`); token rotation drops the old socket (`stream.ts:630-656`).
- Capabilities: stock `misskey` leaves `status_editing`/scheduling/drafts unknown until probe evidence raises them (`detect.ts:332-340`, `612`, `649-654`); `sharkey` keeps verified `supported`; `catodon` claims nothing unverified; `like` is never flavor-seeded (`detect.ts:322-324`, `like.ts:29-40`).
- `movedTo` packed as `{id, acct, url}` from the URI string (`adapt.ts:141-149`, `wire.ts:59-62`); `alsoKnownAs` stays in the `Me` ext bag.
- Transport: session-bound, origin guard before I/O, caller `i` wins, 204-tolerant, redirect refusal on JSON paths (`client.ts:249-298`); upload omits null `folderId`, scales deadline, guards cross-origin response URLs (`client.ts:304-449`); permission-denied observer ignores unauthenticated calls and never throws (`client.ts:537-552`).
- Thread walk bounded with repeat-page guard and 404 fallback to packed parent (`backend.ts:328-380`); `reportAccount` requires comment and reports unused fields honestly (`backend.ts:779-805`); `updateProfile`/`uploadProfileImage` send only set fields (`backend.ts:686-724`).
