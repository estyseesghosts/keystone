# API surface for the UI

**Status:** Verified 2026-10-15 against local Misskey (`2026.10.1-alpha.0`,
`http://127.0.1.1` → `127.0.0.1:3101`) and Sharkey (`2025.4.7`,
`http://127.0.1.2` → `127.0.0.1:3102`). Smoke: `/tmp/keystone-smoke.py`
(34/34 relevant checks green after correcting probe assertions) plus
`/tmp/keystone-smoke2.py` (12/12) — see `../state/logs/2026-10-15-stonekey.md`.

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
| Misskey / Sharkey | Keystone-owned, no redirects: `POST /api/signin-flow` `{username, password}` → `{finished:true, id, i}` (native token = **temporary** credential, never stored) → Keystone permission screen → `miauth/gen-token` `{session, name:"Keystone", permission}` (authed with the temporary credential) → `POST /api/miauth/:session/check` → `{ok:true, token, user}`; the scoped app token becomes the session |

`POST /api/signin` does **not** exist on Misskey/Sharkey (404). Scoped
permissions: `read:account`, `write:notes`, `write:reactions`,
`write:following`, `read:notifications`. The scoped token intentionally lacks
`write:drive` (no upload UI yet; the server 403s uploads with it — verified).

## Supported UI capabilities (verified on both Misskey + Sharkey)

| UI capability | Endpoint | Notes |
|---|---|---|
| Instance metadata | `meta` | Public |
| Current account | `i` | Auth; session restore. `myReaction` and other per-user note fields are only packed with a credential — anonymous `notes/show` returns `myReaction: null` |
| Notifications | `i/notifications` | Auth, `kind read:notifications`; `{limit, sinceId?, untilId?}`. **No `isRead` field** — render without read/unread state |
| Home timeline | `notes/timeline` | Auth; `Note[]`; `{limit, sinceId?, untilId?}` only |
| Local timeline | `notes/local-timeline` | Public; same cursor params |
| Global timeline | `notes/global-timeline` | Public on **both**; same cursor params |
| Create / reply / renote / quote | `notes/create` | Auth → `{ createdNote: Note }`; `replyId` / `renoteId`; quote = text + `renoteId` |
| Open note | `notes/show` | `noteId`; missing/invisible → API error, not null |
| Direct replies | `notes/replies` | Public; `{noteId, limit, sinceId?, untilId?}`. Ancestors: `notes/conversation`; replies+quotes: `notes/children` |
| Profile notes | `users/notes` | Public; `{userId, limit, sinceId?, untilId?, withReplies?}` |
| Delete own note | `notes/delete` | Auth; 204 empty |
| React / unreact | `notes/reactions/create`, `notes/reactions/delete` | Create takes `{noteId, reaction}` (required); delete takes `{noteId}`; 204 empty |
| View user / resolve mention | `users/show` | `{userId}` or `{username, host?}` |
| Search users | `users/search` | Users only — never present as note search |
| Follow / unfollow | `following/create`, `following/delete` | `{userId}`; auth; returns the followee as `UserLite` (not empty) — flip `isFollowing` explicitly |

Timelines: `limit` ~20, `sinceId`/`untilId` cursors. Cross-backend rule: send
only `{limit, sinceId, untilId}` (+ endpoint-specific ids like
`noteId`/`userId`/`replyId`/`renoteId`/`reaction`/text fields). In particular
**never send** `includeMyRenotes` / `includeRenotedMyNotes` /
`includeLocalRenotes` (Misskey-only; Sharkey 400s unknown fields), and never
send `sinceDate`/`untilDate` to Sharkey-only-divergent endpoints
(`i/notifications`, `notes/replies`, `notes/children`, `notes/renotes` —
stick to id cursors).

## Deferred (not in the UI yet)

Streaming/live updates (manual refresh + cursors only), media upload UI
(`drive/files/create` is multipart `FormData`, not JSON — backend verified
working), full profile editor (`i/update` common subset is compatible but no
editor is built), note search (no endpoint), follower/following lists.
