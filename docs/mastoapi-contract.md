# Keystodon — MastoAPI Contract

**Status:** Draft/Accepted for the **Mastodon family** only (2026-10-17).
Moved into Keystone in Phase 0 of `docs/unified-keystone-plan.md`. This is
the authoritative MastoAPI contract; it sits **beside** `docs/api-surface.md`
(the authoritative Misskey-family matrix) — the two are not superseding each
other. Product-level summary: `keystone.md` Appendix A. Per-feature audit:
`docs/frontend-parity-inventory.md`.
**Purpose:** authoritative endpoint/behavior contract for the Mastodon-family
transport (Mastodon / Akkoma / Pleroma).
**Status of verification:** endpoint shapes verified from local source
checkouts (not yet from live servers for every row — see "Verification
status").
**Sources (local, verified 2026-10-16):**

- Mastodon `4.8.0-alpha.3` — `~/Local Documents/fedifedifedi/mastodon`
- Akkoma `3.20.1` — `~/Local Documents/fedifedifedi/akkoma`
- akkoma-fe (reference for internal-mode auth) —
  `~/Local Documents/fedifedifedi/akkoma-fe`

Every claim below is cited to those checkouts. Where Mastodon and Akkoma
diverge, both behaviors are recorded; the client must capability-gate, never
assume.

> **Staleness / known gaps (2026-10-17).** Written during the Keystodon fork
> and not revised since; re-check these before implementing:
>
> - **Notifications are the weakest area.** §4 and §6 record the v1
>   `/api/v1/notifications` type sets from source, but the grouped
>   `/api/v2/notifications` shape and the mark-read story (markers +
>   dismiss; there is no v1 mark-as-read) are described only briefly. The
>   fork deferred its notifications adapter, so **none of this was
>   implemented or live-tested**. Use `docs/unified-keystone-plan.md` §6 as
>   the current requirement and treat the rows here as a starting point.
> - **Import/export is not covered.** The contract has no import/export
>   section: Misskey's `i/import-*`/`i/export-*` have no MastoAPI equivalent;
>   Mastodon account data export/import is server-side (CSV through the
>   instance UI). The inventory marks it "later".
> - **Live verification is incomplete.** Only the fork's Phase 1/2 smoke
>   paths were run against a live Akkoma; the rest is source-derived. See
>   "Verification status" below.
> - **Hosting mode is described as build-time (§0, §2), which the unified
>   plan replaces.** `docs/unified-keystone-plan.md` §2.3 resolves
>   first-party vs third-party at **runtime** from `keystone.config.json`
>   with a same-origin NodeInfo probe, so one `dist/` serves every
>   deployment. Treat this document's per-deployment framing as historical.

## 0. Product shape

Keystodon is a SolidJS SPA with two deployment/login modes:

1. **Internal** — Keystodon is served *by the instance itself* (replacing
   masto-fe / mastodon-web). Same-origin; the instance is the only backend.
2. **External** — Keystodon runs standalone and logs into remote servers via
   standard OAuth. The remote instance owns all auth UI.

Mode is per-deployment (build/config), not per-request. External sessions may
coexist (an "account switcher" like Keystone's `external.ts`), but v1 ships
internal-mode login first.

## 1. Transport

- Base URL: the instance origin. Dev proxy via Vite (`/api`, `/streaming`
  ws) like Keystone's existing setup; production = same-origin (internal) or
  absolute per-session origin (external).
- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` as required by endpoint.
  No method is hard-limited.
- Auth header: `Authorization: Bearer <token>` on every authenticated call
  (both backends accept it on REST; CORS allows the header — Mastodon
  `cors.rb:10-28` `headers: :any`, Akkoma `config.exs:478-490` explicit
  `"Authorization"`).
- Bodies: JSON where the server accepts it; `application/x-www-form-urlencoded`
  (URLSearchParams) for OAuth token endpoints; `multipart/form-data`
  (FormData, never a manual Content-Type) for media upload. Note: Akkoma-fe
  sends status-create as FormData; Mastodon accepts JSON — use JSON for
  status create/edit (verified accepted by Mastodon Rails params + Akkoma
  Phoenix params parse JSON), FormData only for uploads.
- Query arrays use repeated keys (`types[]=a&types[]=b`) — both backends
  document `[]`-suffixed array params.
- Responses: 200 JSON entities; `204`/empty-`{}` for some clears (Akkoma
  `dismiss/clear` → `{}`; Mastodon `render_empty` → `{}` 200); Mastodon
  media v2 → **202 while processing**; Mastodon home timeline → **206 while
  regenerating**; Akkoma media v2 → 202 with final body. Never call
  `.json()` unconditionally; tolerate empty bodies.
- IDs are **opaque strings** everywhere. Akkoma uses 128-bit flake IDs
  (18-char strings — `flake_id.ex:8-13`); `Number`/`parseInt` must never
  touch IDs. Cursor pagination via `max_id`/`since_id`/`min_id` strings.
- Errors: JSON `{error: "…"}` (Mastodon `api/base_controller.rb:101-103`;
  Akkoma catch-all 404 `{"error":"Not implemented"}`). Typed client error
  must carry HTTP status + body + request context. 429 → surface with
  `Retry-After`/`X-RateLimit-*` (CORS-exposed on both).
- Idempotency: `Idempotency-Key` header supported on `POST /api/v1/statuses`
  (Mastodon: dup key returns the ORIGINAL status, 1h Redis window,
  `post_status_service.rb:226-255`; Akkoma: header CORS-allowed). Generate
  one key per logical post attempt; keep it across retries of that attempt.
- Timeouts/cancellation on every request. A timeout is NEVER "endpoint
  unsupported".

## 2. Authentication

### 2.1 External mode (standard OAuth) — both backends

1. `POST /api/v1/apps` (unauthenticated): `client_name`, `redirect_uris`
   (exact Keystodon callback URL), `scopes`, optional `website`. Response
   includes `client_id`, `client_secret` (Mastodon also `vapid_key`,
   `client_secret_expires_at: 0`; Akkoma `app_view.ex:25-49`). Cache the
   registration per normalized origin in storage.
2. Redirect to `GET /oauth/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `scope`, random `state`, and PKCE
   `code_challenge`/`code_challenge_method=S256`.
   - Mastodon: PKCE supported (S256 only, `doorkeeper.rb:56`); consent
     screen always shown for non-superapps. `state` enforced by Doorkeeper.
   - Akkoma: **no PKCE** (grep-verified absent); params ignored harmlessly.
     `state` supported (`o_auth_controller.ex:97-129`). OOB redirect
     supported but unused.
   - Do not rely on PKCE for older/compat servers; sending it is safe on
     both.
3. Callback: validate `state` once, reject OAuth `error` responses, strip
   the code from the visible URL (history.replaceState), then
   `POST /oauth/token` form-encoded: `grant_type=authorization_code`,
   `code`, `client_id`, `client_secret`, `redirect_uri`, `code_verifier`
   (if PKCE used).
   - Mastodon treats registered apps as **confidential**: always send
     `client_secret` alongside `code_verifier`. Tokens never expire
     (`access_token_expires_in nil`), `reuse_access_token` on — re-running
     the flow for the same app+user returns the same token.
   - Akkoma returns extra fields: `refresh_token`, `expires_in` (≈100 yr
     default), `me` (AP id). Ignore extras; keep `access_token`.
   - Error shape both: `{error, error_description?}` JSON
     (`invalid_grant`, `invalid_client`, …).
4. Verify: `GET /api/v1/accounts/verify_credentials` with Bearer → Account
   (+ Mastodon `source`/`state`/`role` extras — see §6).
5. Logout: `POST /oauth/revoke` form-encoded `token` (+ client_id/secret —
   Akkoma RFC 7009 always `{}`; Mastodon also deletes push subs).
6. Sessions isolated per (origin, account). Clear on explicit logout or
   confirmed 401. Never log tokens/secrets/codes.

**Scope set (v1):** `read:accounts read:statuses read:notifications
read:search read:follows write:statuses write:favourites write:follows
write:media write:notifications`. Both backends accept granular scopes
(Mastodon `doorkeeper.rb:72-119`; Akkoma scope parsing space/comma
`scopes.ex:20-48`). Older servers may only understand `read`/`write` — the
well-known discovery doc (`/.well-known/oauth-authorization-server`,
Mastodon; absent on Akkoma) tells us which; fall back to `read write follow`
only when discovery is absent AND granular registration fails.

**Scopes not requested until the feature ships:** bookmarks, blocks/mutes
granular (v1 uses `read`/`write` umbrella only if granular rejected),
push.

### 2.2 Internal mode (first-party, no authcode bounce) — per owner decision

Internal login must NOT walk the user through `/oauth/authorize`. Per-backend:

- **Akkoma/Pleroma:** native **password grant** — `POST /oauth/token` with
  `grant_type=password`, `username`, `password`, `client_id`,
  `client_secret` from a runtime-registered app (akkoma-fe pattern:
  `getOrCreateApp` → `oauth.js:49-63`). MFA: 403 with `mfa_token` →
  `POST /oauth/mfa/challenge` (totp|recovery) → retry
  (`o_auth_controller.ex:352-356`). One-step inline login, no redirect.
- **Vanilla Mastodon:** **no password grant exists** (`grant_flows =
  authorization_code + client_credentials`, `doorkeeper.rb:170`;
  `resource_owner_from_credentials` → nil, `:12-15`). Mastodon's own web UI
  bypasses OAuth UI via **server-side session cooperation**: seeded superapp
  "Web" (`db/seeds/01_web_app.rb`) + per-session token minted by Rails
  (`session_activation.rb:61-73`) and injected into the served page
  (`initial_state_serializer.rb:112-114`); the SPA uses it as a Bearer token.
  Keystodon internal-on-Mastodon mirrors this: the instance serves Keystodon
  and injects/authorizes a per-session token (deployment-time patch/seed —
  precedent: Keystone's `KEYSTONE_BACKEND_ONLY` backend patch). No browser
  OAuth redirect, ever.

Never use Akkoma's cookie/Basic-auth API paths as defaults (§5 of research):
they bypass scope checks and are not third-party-client-safe.

### 2.3 Token storage

Browser-held Bearer tokens are XSS-exposed by design; accepted for v1 with:
sanitized rendering (§7), no token logging, per-origin isolation. Client
`client_secret` in internal mode is per-browser (runtime-registered app —
akkoma-fe model: it identifies no trusted party). Never persist passwords.

## 3. Instance discovery & capabilities

Order: `GET /api/v2/instance` → on **404/405 only** fall back to
`GET /api/v1/instance`. Never fall back on timeout/401/403/5xx.

- **Mastodon 4.8:** v2 present. `configuration.urls.streaming` (ws URL),
  `configuration.statuses.{max_characters: 500, max_media_attachments: 4,
  characters_reserved_per_url: 23}`, `configuration.media_attachments.*`
  (size limits + mime list), `configuration.polls.*`,
  `configuration.translation.enabled`, `configuration.accounts.*`,
  `usage.users.active_month`, `api_versions: {mastodon: 12}`,
  `registrations`. **No `features` array.** v1 fallback shape:
  `urls.streaming_api`, `stats`, no `max_toot_chars` (use
  `configuration.statuses.max_characters` — present in BOTH v1 and v2 here).
- **Akkoma 3.20:** **v2 404s** → always v1. `version` =
  `"2.7.2 (compatible; Akkoma <ver>)"` — detect family by substring
  `"Akkoma"`, don't parse strictly. `urls.streaming_api` (ws origin),
  `max_toot_chars` (default 5000), `poll_limits`, `upload_limit` +
  per-type limits, `description_limit`, `pleroma.metadata.features` (incl.
  `quote_posting`, `pleroma_emoji_reactions`, `editing`,
  `akkoma:machine_translation`, `bubble_timeline`…), `pleroma.vapid_public_key`,
  `stats` incl. `remote_user_count`. **No `configuration` object.**
- Normalize into an `InstanceCapabilities` object with `null` for unknown —
  never stringified `"undefined"` (keystodon.md §5 shape still applies).
- Secondary detection: `GET /.well-known/nodeinfo` →
  `/nodeinfo/2.1` — `software.name` (`"mastodon"`/`"akkoma"`/`"pleroma"`),
  `software.version`, plus Akkoma's `metadata.features` and
  `publicTimelineVisibility` (tells us whether public GETs need auth).
- Streaming host: v2 `configuration.urls.streaming` (Mastodon — may be a
  DIFFERENT host); Akkoma v1 `urls.streaming_api` = `ws(s)://<origin>`.
  Never hardcode the REST host as streaming host; Mastodon's Rails
  `/api/v1/streaming` 301-redirects to the right host (or 404s same-host).
- Feature probing must distinguish 404/405 (absent) from 401/403
  (auth/scope) from 200-empty (genuinely empty OR unimplemented — decide
  via family + metadata, e.g. Akkoma `GET /api/v1/trends` returns `[]`).

## 4. Endpoint map

`S` = scope needed. Per-server notes: **M** = Mastodon 4.8, **A** = Akkoma
3.20. "absent" = verified 404 in that checkout.

| UI task | Endpoint | S | Notes |
|---|---|---|---|
| Instance meta | `GET /api/v2/instance`, fallback `/api/v1/instance` | — | §3. A: v2 absent. |
| Session verify | `GET /api/v1/accounts/verify_credentials` | profile/read | Both. M adds `source{privacy,sensitive,language,note,fields,quote_policy,…}`, `state`, `role`. |
| Home timeline | `GET /api/v1/timelines/home` | read:statuses | Both; Link headers; M may 206 (regenerating). Params: `limit,max_id,since_id,min_id` (+M `local,exclude_*`, A `reply_visibility,with_muted` — don't send portably). |
| Local timeline | `GET /api/v1/timelines/public?local=true` | — (may 401 if restricted) | Both. A: public timelines are Create-only (no boosts). |
| Federated timeline | `GET /api/v1/timelines/public` | — | Both; same Create-only on A. |
| Tag timeline | `GET /api/v1/timelines/tag/:id` | — | Both. |
| Status detail | `GET /api/v1/statuses/:id` | read:statuses | Both. |
| Status context | `GET /api/v1/statuses/:id/context` | read:statuses | Both: `{ancestors[], descendants[]}` flat; rebuild tree via `in_reply_to_id`. M unauth caps 40/60/depth20; auth 4096. |
| Create status | `POST /api/v1/statuses` | write:statuses | JSON. Params: `status, in_reply_to_id, media_ids[], sensitive, spoiler_text, visibility, language, scheduled_at, poll{options[],expires_in,multiple,hide_totals}, allowed_mentions[]` (M), `quoted_status_id, quote_approval_policy` (M 4.5+ quote; A accepts `quoted_status_id`/deprecated `quote_id`, no approval policy). M: `Idempotency-Key` honored; 404 if reply/quote target invisible; 422 `{error, unexpected_accounts[]}`. A: 422 `{error}`; visibility enum + **`local`** (A extra); NEVER send `list:` visibility (falls back to public). |
| Edit status | `PUT /api/v1/statuses/:id` | write:statuses | Both (M sets `edited_at`; A `editing` feature flag). |
| Delete status | `DELETE /api/v1/statuses/:id` | write:statuses | Both; returns source `text` JSON of the deleted status. |
| Favourite | `POST /api/v1/statuses/:id/favourite` `/unfavourite` | write:favourites | Both; returns Status with `favourited` + counts. A distinct action — not a generic reaction. |
| Reblog | `POST /api/v1/statuses/:id/reblog` `/unreblog` | write:statuses | Both; reblog returns the WRAPPER Status; unreblog returns original with `reblogged:false`. |
| Bookmark | `POST /api/v1/statuses/:id/bookmark` `/unbookmark` | write:bookmarks | Both. Add scope only when UI ships. |
| Pin/unpin | `POST /api/v1/statuses/:id/pin` `/unpin` | write:statuses | Both. `pinned` field on Status. |
| Account | `GET /api/v1/accounts/:id` | read:accounts | Both. A: `:id` may be nickname for accounts/:id and /statuses. |
| Handle lookup | `GET /api/v1/accounts/lookup?acct=user@host` | read:accounts | Both. M: skip-WebFinger → 404 unknown remote. A: unauth fallback allowed. |
| Relationships | `GET /api/v1/accounts/relationships?id[]=…` | read:follows | Both. Fields verified both; A `blocked_by`/`endorsed` always false, extra `requested_by`, `subscribing`. |
| Follow/unfollow | `POST /api/v1/accounts/:id/follow` `/unfollow` | write:follows | Both return Relationship. Pending → `requested:true`. M follow params `reblogs,notify,languages[]`. Self-follow → 403. |
| Block/mute | `POST /api/v1/accounts/:id/block` `/unblock` `/mute` (`notifications`,`duration` params) `/unmute` | write:blocks / write:mutes | Both return Relationship. |
| Followers/following | `GET /api/v1/accounts/:id/followers` `/following` | read:follows | Both, Link headers, default limit 40. Hidden lists → `[]`/404 per server. |
| Account statuses | `GET /api/v1/accounts/:id/statuses` | read:statuses | Both. Params `only_media,exclude_replies,exclude_reblogs` (+A `pinned,tagged,with_muted`). |
| Notifications | `GET /api/v1/notifications` | read:notifications | Both. Params `types[]/exclude_types[]` (A: `include_types[]` deprecated alias), `account_id`, pagination. M limit default 40, `supported_types[]` → `fallback` field. Type sets differ — see §6. |
| Dismiss/clear notif. | `POST /api/v1/notifications/:id/dismiss`, `/clear` | write:notifications | Both → `{}`. A extra: `POST /api/v1/pleroma/notifications/read`. |
| Read position | `GET/POST /api/v1/markers` | write:notifications | Both (A adds `pleroma.unread_count`). There is NO v1 mark-as-read endpoint on either. |
| Upload media | `POST /api/v2/media` | write:media | multipart `file, description, focus`. M: 202 async — poll `GET /api/v1/media/:id` (206 processing/200 done/422 failed), `url` null until done; limits 16 MB img / 99 MB video. A: 202 but SYNCHRONOUS (body final); `focus` ignored; no size cap server-side (client uses `upload_limit` from instance meta). `PUT /api/v1/media/:id` edits description (both). |
| Search | `GET /api/v2/search` | read:search | Both. `{accounts, statuses, hashtags}` (+M `collections`). M: unauth `offset`/`resolve` → 401; status search needs Elasticsearch. A: may 403 if instance restricts; hashtags `{name,url}` no history. `GET /api/v1/search` absent on BOTH — never use. A extra: `/api/v1/accounts/search`. |
| Poll vote | `POST /api/v1/polls/:id/votes` | write:statuses | Both: body `choices` = int indices. Poll entity: `voted/own_votes` auth-only; A `voters_count` null for single-choice, no `locked`. |
| Custom emoji | `GET /api/v1/custom_emojis` | — | Both: `{shortcode,url,static_url,visible_in_picker,category[,featured]}`. A adds `tags[]`. A alternate: `/api/v1/pleroma/emoji` (object map). |
| Emoji reactions (ext) | A: `GET /api/v1/pleroma/statuses/:id/reactions[/:emoji]`; `PUT/DELETE …/reactions/:emoji` (path segment, URL-encoded) → Status. Fedibird-compat `PUT /api/v1/statuses/:id/emoji_reactions/:emoji` (no DELETE). | read (GET), write:statuses (PUT/DELETE) | **Akkoma/Pleroma extension only.** Status carries `emoji_reactions: [{name,count,url,me,account_ids}]`. M: absent — favourite/reblog are the only reactions. Gate all reaction UI on detected support. |
| Translation | `POST /api/v1/statuses/:id/translate` (M, when `configuration.translation.enabled`); A: `akkoma:machine_translation` feature + `POST /api/v1/statuses/:id/translate` | read:statuses | Verify per server before enabling. |
| Follow requests | `GET /api/v1/follow_requests`; `POST /api/v1/follow_requests/:id/authorize` `/reject` | read:follows / write:follows | Both. (Replaces Misskey `following/requests/*`.) |
| Markers | `POST /api/v1/markers` `{timeline, last_read_id}` | write:notifications | Both. |

### Explicitly absent (do not call, hide controls)

| Endpoint | Mastodon 4.8 | Akkoma 3.20 |
|---|---|---|
| `GET /api/v1/search` | removed (3.0) | absent (404) |
| `GET /api/v2/instance` | present | **absent (404)** |
| `/api/v1/timelines/direct` | present (DMs) | **absent** |
| `GET /api/v1/featured_tags` | present | **absent (404)** |
| `/api/v2/filters`, `/api/v2/trends`, `GET /api/v1/trends` | present | absent (`[]` for v1 trends) |
| `POST /api/v1/accounts/:id/notifications/reads` | present (4.3+) | absent |
| Misskey `i/*`, `notes/*`, `drive/*`, `users/search` etc. | never | never |

## 5. Pagination

- Cursors: `max_id` (older), `since_id`, `min_id` (newer, where supported).
  Both backends emit `Link` headers with `rel="next"`/`rel="prev"`
  (Mastodon `api/pagination.rb:18-23`; Akkoma
  `controller_helper.ex:46-54`) — CORS-exposed on both.
- Prefer parsing Link headers; fall back to `items[last].id` only if
  absent. Validate any absolute next-URL stays on the configured origin
  before attaching the Bearer token.
- `limit` default 20, hard max 40 on both. End-of-feed = empty page or
  absent `next` link — never `length < limit`.
- IDs opaque strings; never sort/compare numerically.

## 6. Wire shapes (normalization targets)

Full field lists are in the research notes (state/logs
`2026-10-16-keystodon-fork.md` + agent transcripts); the client `models.ts`
must preserve at least:

- **Status:** `id, created_at, in_reply_to_id, in_reply_to_account_id,
  sensitive, spoiler_text, visibility, language, uri, url, replies_count,
  reblogs_count, favourites_count, quotes_count, edited_at, account,
  content` (HTML), `media_attachments[], mentions[], tags[], emoji[],
  card, poll, reblog` (wrapper) + auth-only `favourited, reblogged, muted,
  bookmarked, pinned, filtered[]` + quote: M `quote {state, quoted_status}`,
  A `quote` (nested Status, state "accepted") + `quote_id` (A; ghost `"_"`).
  A extras: `emoji_reactions[]`, `pleroma.*`, `akkoma.*`. Reblog wrappers on
  A have empty content and zeroed counts — always render `reblog.reblog`.
- **Account:** `id, username, acct, display_name, locked, bot,
  discoverable, group, created_at, note` (HTML), `url, uri, avatar,
  avatar_static, header, header_static, followers_count, following_count,
  statuses_count, last_status_at, fields[{name,value,verified_at}], emojis[]`
  + conditional `suspended, limited, moved, noindex, roles[]` (M) /
  `fqn, pleroma.*, akkoma.*` (A; A lacks top-level
  `discoverable/suspended/moved/roles`). Self-verify adds M
  `source{privacy,sensitive,language,note,fields,follow_requests_count,…}`
  or A `pleroma.settings_store` + owner-only extras.
- **Notification:** `id, type` (extensible string), `created_at, account`
  + type-dependent `status/report/event/…`. M types (17): `mention, status,
  reblog, follow, follow_request, favourite, poll, update,
  severed_relationships, moderation_warning, annual_report, admin.sign_up,
  admin.report, quote, quoted_update, added_to_collection,
  collection_update`. A types: `mention, follow, follow_request, reblog,
  favourite, move, pleroma:emoji_reaction, pleroma:report, poll, update`.
  Render unknown types via a generic row (+ M `fallback` field when
  `supported_types[]` sent). A adds `pleroma.{is_seen,is_muted}`.
- **MediaAttachment:** `id, type(image|gifv|video|audio|unknown), url,
  preview_url, remote_url, text_url, meta, description, blurhash` (+A
  `pleroma.mime_type`; A `blurhash` may be null; M `url` null while
  processing).
- **Poll:** `id, expires_at, expired, multiple, votes_count, voters_count,
  options[{title,votes_count}], emoji[]` + auth `voted, own_votes[]`.
- **Relationship:** `id, following, followed_by, blocking, blocked_by,
  muting, muting_notifications, requested, requested_by, domain_blocking,
  showing_reblogs, endorsing/endorsed, note` (+A `subscribing`; A
  `blocked_by/endorsed` always false).
- **Visibility:** client enum `public | unlisted | local | private | direct`
  — `local` rendered only when detected (A extra; masked `limited→private`
  on M). Compose sends only values the target advertises.

## 7. Content rendering

- `content` and `note` are **HTML from the server** (both backends). Render
  through a sanitizer (allow-list tags: `p,br,a,span,strong,em,s,del,code,pre,blockquote,ul,ol,li,h1–h6`
  + classes only where whitelisted; protocols http/https/mailto;
  `rel="noopener noreferrer nofollow"`, `target="_blank"`). Preserve
  mention/hashtag/emoji spans (Mastodon emits
  `class="h-card u-url mention"` links; emoji spans
  `class="emoji"`). NO innerHTML without sanitization.
- **MFM (owner decision):** a config setting selects content parsing —
  "HTML" (default for Mastodon-family content) or "MFM" (for
  MFM-capable servers like Akkoma, or user preference). `MfmRenderer`
  stays; an HTML renderer is added; the setting routes note bodies,
  bios, CWs through the chosen parser. Never both on the same string.
- CW = `spoiler_text` gate (same UX as Keystone); sensitive media blurred
  until tapped; `meta` dimensions drive layout.

## 8. Streaming

Matrix (verified):

| | Mastodon 4.8 | Akkoma 3.20 |
|---|---|---|
| SSE | yes (`text/event-stream`, heartbeat `:thump` 15s) | **no** |
| WS | yes | yes (Cowboy, bypasses Phoenix plugs) |
| Auth | `Authorization: Bearer` OR `?access_token=` OR `Sec-WebSocket-Protocol` | `?access_token=` or `Sec-WebSocket-Protocol` only — **Bearer handshake header ignored (401)** |
| Envelope (WS) | `{stream[], event, payload}` (payload double-encoded) | same, except `delete` (no `stream` key, payload = id string) |
| Subscribe | `{type:"subscribe", stream, ...params}` | same; text `ping`→`pong` |

Design: **WebSocket client** (works on both) authenticating via
`Sec-WebSocket-Protocol` (avoids token-in-URL; accepted by both —
Mastodon `streaming/index.js:408-422`, Akkoma
`websocket_handler.ex:24-35,165-181`). Streams: `user`,
`user:notification`, `public:local`, `public`, `hashtag?tag=`. Events
handled defensively: `update` (Status), `status.update`, `delete` (plain id
string), `notification`, `conversation`, `filters_changed`; unknown events
ignored; `kill` closes + reauth check. Reconnect with backoff; streaming is
ALWAYS optional — every feed has REST refresh + cursor paging (Keystone
behavior preserved). Dedupe streamed statuses against REST results by id.
Streaming host from instance metadata (§3), never hardcoded.

## 9. Extension gating (reactions etc.)

Capability = family detection + feature evidence, never 404 alone:

- `emoji_reactions` field present on fetched Statuses, or
  `pleroma_emoji_reactions`/`exposable_reactions` in `pleroma.metadata.features`
  (A), or a 200 from the reactions GET → reaction chips ON.
- Vanilla M: favourite ❤ + reblog 🔁 only. No generic reaction picker.
- Quote composition: gate on `quoted_status_id` acceptance (M 4.5+, A with
  `quote_posting` feature). Absence of approval metadata ≠ rejected.
- Translation: M `configuration.translation.enabled`; A
  `akkoma:machine_translation` feature.

## 10. Verification status

- [x] Contract written from local source checkouts (2026-10-16): Mastodon
  4.8.0-alpha.3, Akkoma 3.20.1, akkoma-fe.
- [ ] Live-server smoke: not yet run (no live Mastodon/Akkoma instance
  configured for Keystodon yet).
- [ ] Internal-mode token injection (Mastodon) — needs deployment patch
  design.
- [ ] Browser QA — owner.

## 11. Open questions

1. Internal-Mastodon token injection mechanism (server-injected per-session
   token like mastodon-web, vs seeded superapp) — owner confirmed
   "bypass authcode"; mechanism TBD in Phase 1.
2. Akkoma internal login: password grant is native — confirm MFA challenge
   UI scope for v1.
3. DMs (`direct` timeline) absent on Akkoma — direct visibility posts still
  composable/viewable in threads; no DM inbox route in v1.
