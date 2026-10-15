# API surface for the UI

**Status:** Draft (tracks backend Frozen manifest @ `pinetree/ff651d6`, 2026-10-15)

The frozen manifest (`pinetree/docs/endpoint-manifest.md`) is definitive.
This file is only the UI-relevant subset plus the hard limits. On any
conflict, the manifest wins — update this file and log it.

## Transport

- JSON `POST` at `/api/{endpoint}`. Auth: `i` body field consistently
  (backend also accepts `Authorization: Bearer`; we standardize on `i`).
- Errors: `{ error: { message, code, kind } }` envelope; surface
  `error.message`, fall back to HTTP status.
- Writes may return **204 No Content** (e.g. reactions, deletes): read body as
  text first, treat empty as `undefined`, never blind `response.json()`.
- Same-origin relative paths in the browser via the Vite proxy (`/api`,
  `/files` → `http://127.0.0.1:3000`). Media: use API-returned URLs only.

## Supported (first UI)

| UI capability | Endpoint | Notes |
|---|---|---|
| Instance metadata | `meta` | Public; optional |
| Sign in | `signin` | `username` + `password` → `token`, `i`, `user`; store token only |
| Current account | `i` | Auth; session restore |
| Notifications | `i/notifications` | Auth; confirm fields vs manifest before rendering each kind |
| Home timeline | `notes/timeline` | Auth; `Note[]`, cursor IDs |
| Local timeline | `notes/local-timeline` | Public; `Note[]` |
| Hybrid timeline | `notes/hybrid-timeline` | Auth; optional, not exposed in v1 UI |
| Create / reply / renote | `notes/create` | Auth → `{ createdNote: Note }`; `replyId` / `renoteId`; text-only v1. Quote = text + `renoteId` together (backend allows; packed `renote` comes back one level, no quote metadata) |
| Open note | `notes/show` | `noteId`; missing/invisible → API error, not null |
| Delete own note | `notes/delete` | Auth; may be 204 |
| React / unreact | `notes/reactions/create`, `notes/reactions/delete` | Delete takes `noteId`; may be 204; honor `myReaction` |
| View user | `users/show` | Exactly one of `userId` / `userIds` / `username` (+ optional `host`) |
| Search users | `users/search` | Users only — never present as note search |
| Follow / unfollow | `following/create`, `following/delete` | `userId`; auth |
| Edit basic profile | `i/update` | Documented subset only; no full profile editor v1 |

Timelines: `limit` 1–100 (start ~20), `sinceId`/`untilId` cursors.
Wire types: API camelCase per `pinetree/docs/domain-types.md`.

## Unsupported — do not depend on these

No streaming route (`src/streaming` stubbed): manual refresh + cursors only.
No `users/notes`, `users/followers`, `users/following`, `notes/renotes`,
`notes/replies`, `notes/global-timeline`, `notes/search`, lists, antennas,
clips, channels, polls, quote metadata, custom-emoji endpoints, Mastodon REST.
Unknown endpoints → 404; unknown fields on supported endpoints → 400, so send
only documented fields (no speculative Misskey fields).
