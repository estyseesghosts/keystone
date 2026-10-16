# API surface for the UI

**Status:** Verified 2026-10-15/16 against local Misskey (`2026.10.1-alpha.0`,
`http://127.0.1.1` → `127.0.0.1:3101`) and Sharkey (`2025.4.7`,
`http://127.0.1.2` → `127.0.0.1:3102`). Suites (all green, checked in under
`scripts/`): `smoke_flows.py` (44/44 core journeys), `smoke_writes.py`
(14/14 write round-trips), `smoke_features.py` (44/44: drive, antennas,
polls, search, profile, follow-requests) — see `../state/logs/2026-10-16-roadmap.md`.
Browser QA is still pending (no browser in this environment).

Keystone targets **Misskey and Sharkey** (Misskey-family) first; Pinetree
remains supported via the same transport. The backends run in
`KEYSTONE_BACKEND_ONLY=1` mode (built-in web UI disabled; API/files/streaming
live). Never assume a Pinetree limitation applies to Misskey/Sharkey or
vice versa.

## Transport (all three backends)

- JSON `POST` at `/api/{endpoint}`. Auth: `i` body field consistently
  (backends also accept `Authorization: Bearer`; we standardize on `i`).
- Errors: `{ error: { message, code, id } }` (`kind` sometimes present);
  surface `error.message`, fall back to HTTP status. Unknown **POST** paths on
  Misskey-family answer 404 with a non-JSON body — the client keeps the HTTP
  status on the thrown `ApiError` so callers can probe support via 404.
- Writes may return **204 No Content** (reactions, deletes): read body as
  text first, treat empty as `undefined`, never blind `response.json()`.
- Same-origin relative paths in the browser via the Vite proxy (`/api`,
  `/files`, `/proxy`, `/streaming` → `KEYSTONE_BACKEND_URL`).
  Media: use API-returned URLs only. Tokens are stored per-backend
  (`keystone_token_misskey` / `keystone_token_sharkey` / `keystone_token_pinetree`)
  so a token is never sent to the wrong origin.

## Auth

| Backend | Flow |
|---|---|
| Pinetree | `POST signin` `{username, password}` → `{token, user}`; store token |
| Misskey / Sharkey | Keystone-owned, no redirects, **one step**: `POST /api/signin-flow` `{username, password}` → `{finished:true, id, i}` → `miauth/gen-token` `{session, name:"Keystone", permission}` (authed with the native credential) → `POST /api/miauth/:session/check` → `{ok:true, token, user}`; verify with `i`, then store the scoped app token |

`POST /api/signin` does **not** exist on Misskey/Sharkey (404).

The `i` from `signin-flow` is the user's **full-authority native token**
(`SigninService` returns `user.token` verbatim — permanent, not short-lived).
Keystone holds it in module memory only for the exchange and never persists
it. A non-`finished` flow (2FA/passkey/captcha) is an explicit unsupported
state — Keystone never sends users to instance pages.

Scoped permissions: `read:account`, `write:notes`, `write:reactions`,
`write:following`, `read:following`, `read:notifications`,
`write:notifications`, `read:drive`, `write:drive`, `write:account`,
`write:votes`. Sessions minted before a scope existed get 403
`PERMISSION_DENIED` on its endpoints — the UI answers with a re-sign-in
hint, never a bare error.

## Supported UI capabilities (verified on both Misskey + Sharkey)

| UI capability | Endpoint | Notes |
|---|---|---|
| Instance metadata | `meta` | Public; `maxNoteTextLength` (3000 on all three backends) drives the composer limit with a 3000 fallback |
| Current account | `i` | Auth; session restore. Per-user note fields (`myReaction`, `poll`/`isVoted`) are only packed **with** a credential — anonymous `notes/show` strips them (Misskey) or 403s non-public notes (Sharkey) |
| Notifications | `i/notifications` | Auth, `kind read:notifications`; `{limit, sinceId?, untilId?}`. **No `isRead` field** — render without read/unread state |
| Mark all read | `notifications/mark-all-as-read` | Auth, `kind write:notifications`; void. Pre-scope sessions get 403 → re-sign-in hint |
| Home timeline | `notes/timeline` | Auth; `Note[]`; `{limit, sinceId?, untilId?}` only |
| Local timeline | `notes/local-timeline` | Public; same cursor params |
| Global timeline | `notes/global-timeline` | Public on **both**; same cursor params |
| Create / reply / renote / quote | `notes/create` | Auth → `{ createdNote: Note }`; `replyId` / `renoteId`; quote = text + `renoteId`; `cw` (1–100), `localOnly`, `visibleUserIds` (required iff `specified`), `fileIds` (1–16), `poll` (`choices` 2–10 × ≤50 chars, `multiple`, `expiredAfter`/`expiresAt`) |
| Open note | `notes/show` | `noteId`; missing/invisible → API error, not null |
| Direct replies | `notes/replies` | Public; `{noteId, limit, sinceId?, untilId?}`. Ancestors: `notes/conversation`; replies+quotes: `notes/children` |
| Profile notes | `users/notes` | Public; `{userId, limit, sinceId?, untilId?, withReplies?}` |
| Delete own note | `notes/delete` | Auth; 204 empty |
| React / unreact | `notes/reactions/create`, `notes/reactions/delete` | Create takes `{noteId, reaction}` (required); delete takes `{noteId}`; 204 empty. **Reactions normalize:** `❤️` (U+2764 U+FE0F) is stored/returned as `❤` (U+2764) — the client sends the normalized form |
| Undo repost | `notes/unrenote` | Auth, `kind write:notes`; takes the **original** note's `noteId`, deletes my renotes of it |
| Vote in poll | `notes/polls/vote` | Auth, `kind write:votes`; `{noteId, choice}` |
| View user / resolve mention | `users/show` | `{userId}` or `{username, host?}`; authed reads add `isFollowing`, `hasPendingFollowRequestFromYou/ToYou` |
| Search users | `users/search` | `{query, limit}` — always authenticated (Misskey 500s anonymous searches) |
| Search notes | `notes/search` | **Implemented but policy-dependent:** these servers answer 400 `UNAVAILABLE` ("Search of notes unavailable"). Never present a policy denial as a missing endpoint |
| Search by tag | `notes/search-by-tag` | `{tag, limit}` works with the scoped token |
| Follow / unfollow | `following/create`, `following/delete` | `{userId}`; auth; returns the followee as `UserLite` (not empty) — follow state is re-derived from `users/show`, never optimistic (locked accounts yield pending requests) |
| Cancel follow request | `following/requests/cancel` | `{userId}`; auth |
| Incoming follow requests | `following/requests/list` | Auth, `kind read:following` |
| Followers / following | `users/followers`, `users/following` | `{userId, limit, sinceId?, untilId?}` |
| Upload file | `drive/files/create` | Auth, `kind write:drive`; **multipart `FormData`** (`file*`, `i`, `name?`, `comment?`, `isSensitive?`) — never JSON; returns `DriveFile` |
| Resolve quote URL | `ap/show` | Auth, `kind read:account`; `{uri}` → `{type: "User"\|"Note", object}`. Only `type: "Note"` renders a quote card; anything else (User, missing, private) is a null result and the `RE:` text stays. Anonymous calls fail closed (401). Verified live 2026-10-16: canonical note URLs 200 `Note` on both servers; missing is 400 `NO_SUCH_OBJECT` (Misskey) / 500 (Sharkey) — the client treats every error as null, never branching on codes |
| List files | `drive/files` | Auth, `kind read:drive`; `{limit, sinceId?, untilId?, type? ("image/*"…), folderId?}` → `DriveFile[]` |
| Update file | `drive/files/update` | Auth, `kind write:drive`; `{fileId, name?, isSensitive?, comment?, folderId?}` |
| Delete file | `drive/files/delete` | Auth, `kind write:drive`; `{fileId}` |
| Antennas list / feed | `antennas/list`, `antennas/notes` | Auth, `kind read:account`; feed takes `{antennaId, limit, sinceId?, untilId?}` |
| Antennas create/update/delete | `antennas/create`, `antennas/update`, `antennas/delete` | Auth, `kind write:account`. Required create fields: `name`, `src` (`home`/`all`/`users`/`users_blacklist`; `list` omitted — needs the user-list subset), `keywords`, `excludeKeywords` (nested AND-groups OR-ed, verified in AntennaService), `users` (acct strings), `caseSensitive`, `withReplies`, `withFile`; optional `localOnly`, `excludeBots`, `userListId` |
| Edit profile | `i/update` | Auth, `kind write:account`; bounded common subset: `name`, `description`, `location`, `birthday`, `isLocked`, `isBot` (+ `avatarId`/`bannerId` deferred) |
| Revoke session | `i/revoke-token` | No params revokes the calling app token; best-effort at sign-out (unsupported servers 404 — local state clears regardless) |
| Link preview | `url-preview` | **Absent on Sharkey 2025.4.7** (verified 404, same shape as bogus endpoints — the route is not registered). Keystone fetches OpenGraph tags client-side instead (direct, then CORS proxy, then basic domain card). **Pinetree workstream:** implement a first-party `url-preview`-compatible endpoint (`{url}` → `{title?, description?, siteName?, image?, icon?}`) and swap the client fetcher to it |

Timelines: `limit` ~20, `sinceId`/`untilId` cursors. Cross-backend rule: send
only `{limit, sinceId, untilId}` (+ endpoint-specific ids like
`noteId`/`userId`/`replyId`/`renoteId`/`reaction`/text fields). In particular
**never send** `includeMyRenotes` / `includeRenotedMyNotes` /
`includeLocalRenotes` (Misskey-only; Sharkey 400s unknown fields), and never
send `sinceDate`/`untilDate` to Sharkey-only-divergent endpoints
(`i/notifications`, `notes/replies`, `notes/children`, `notes/renotes` —
stick to id cursors).

## Deferred (not in the UI yet)

Streaming/live updates (manual refresh + cursors only — a deliberate
choice, feeds never depend on a socket), full profile editor beyond the
bounded `i/update` subset (`avatarId`/`bannerId`, decorations, fields),
follower/following beyond the basic lists, user-list management (blocks
`list`-source antennas — that source option is hidden until the subset
lands), folder navigation in Drive, dark mode.

## Backend capability contract (roadmap §9)

Status values: `implemented and tested`, `implemented but policy-dependent`,
`not implemented`, `not yet verified`.

| Capability | Misskey | Sharkey | Pinetree |
|---|---|---|---|
| Timelines, notes, replies, reactions, follows | implemented and tested (API suites green; browser QA pending) | implemented and tested (API suites green; browser QA pending) | existing subset; Keystone journey tests against current checkout not yet verified |
| Drive upload + serve | implemented and tested (multipart) | implemented and tested (multipart) | implemented and tested (manifest + prior smoke) |
| Drive listing/folders | implemented and tested (`drive/files` list/update/delete) | implemented and tested | **not implemented** (`drive/files` → 404; upload-only degradation) |
| Antennas list/config/feed | implemented and tested (CRUD + keyword feed matching) | implemented and tested | **not implemented** (404; honest unavailable state) |
| Note search | **implemented but policy-dependent** (400 `UNAVAILABLE` on these servers) | **implemented but policy-dependent** | not implemented |
| Tag search | implemented and tested (`notes/search-by-tag`) | implemented and tested | not implemented |
| Polls | implemented and tested (create + vote) | implemented and tested | not implemented (create rejects; UI hidden) |
| Streaming | implemented and tested (Stage A client; API probes green; browser QA pending) | implemented and tested (Stage A client; API probes green; browser QA pending) | **not implemented** (stub modules only, `NoopStreamingSink`, no `/streaming` route; the client never opens a socket in pinetree mode) |

## Streaming (Misskey / Sharkey only)

Stage A client (`frontend/src/api/stream.ts`, native `WebSocket`, no extra
dependencies) wires `main`, `homeTimeline`, `localTimeline`,
`hybridTimeline`, `globalTimeline`, and `antenna` channels plus
`subNote`/`unsubNote` note capture into timelines, note detail, and
notifications. Pinetree has no `/streaming` route (its `src/streaming/`
modules are empty stubs behind a `NoopStreamingSink` — verified in source),
so the client stays fully disabled there: no socket, no UI change, feeds
work exactly as before.

- URL: same-origin `/streaming` through the Vite proxy (`ws:true`) with
  `?i=<token>` (browsers cannot set WS headers; the server also accepts
  `Authorization: Bearer` for non-browser clients). No token = guest
  connection (public channels only).
- Handshake gate (verified in `StreamingApiServerService.ts` on both):
  app tokens **without `read:account` get HTTP 401**; suspended users get
  403. The browser surfaces this as an opaque close, so after 5 consecutive
  opens-closed-within-2s the client stops retrying and shows an explicit
  error with a retry button instead of spinning forever.
- Client → server: `connect {channel, id, params?, pong:true}`,
  `disconnect {id}`, `subNote {id}` / `unsubNote {id}` (refcounted per note;
  max ~1536 captured notes and 32 channels per connection — the client stays
  far below both). Server → client: `connected {id}` (ack, only because
  `pong:true` was sent), `channel {id, type, body}`, broadcast `noteUpdated
  {id, type: reacted|unreacted|deleted|pollVoted, body}`.
- Channel auth (identical on both — verified in each `channels/*.ts`):
  `main`, `homeTimeline`, `hybridTimeline`, `antenna` require a credential
  with `read:account`; `localTimeline`, `globalTimeline` are public.
  Connecting to a channel the server won't serve is **silently ignored**
  (no ack, socket stays open — e.g. a bogus `antennaId`, whose `init`
  returns false). The client therefore treats a missing `connected` ack
  after 10s as a stale subscription and reports "Live updates unavailable".
  Unknown channel names log a server-side unhandled rejection but also
  leave the connection open.
- `noteUpdated` arrives only for captured notes; `deleted` carries
  `{deletedAt}`. React/poll events carry the new reaction / vote choice,
  but the client always re-reads the note from the API before rendering
  (server reconciliation, not optimistic counts).
- Server stale policy (verified in source): the server pings every 60s and
  terminates connections idle >2min. Browsers answer ping/pong
  automatically; the client additionally re-sends every subscribe on
  reconnect with capped exponential backoff (1s → 30s + jitter).
- Client rules: feeds never depend on the socket (paging + refresh are
  unchanged); streamed notes prepend with an in-updater id check, so a
  stream event racing a pending API response can never double-insert;
  notifications only raise a "N new — Refresh" count (no unread model —
  the backends pack no `isRead`). Suite: `scripts/smoke_streaming.py`.
