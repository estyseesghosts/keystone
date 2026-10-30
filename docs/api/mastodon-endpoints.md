# Mastodon-family endpoints

Transport: REST on `{origin}` with `Authorization: Bearer <token>` on every
authenticated call. Bodies are JSON except OAuth token calls
(`application/x-www-form-urlencoded`) and media upload (`multipart`).
Query arrays use repeated `key[]` encoding. IDs are opaque strings — never
parsed or compared numerically. Pagination is Link-header driven
(`rel="next"`/`"prev"`), origin-checked before reuse; `limit` default 20,
hard max 40; end-of-feed = no next link or an empty page.

Endpoint functions throw the raw `MastoHttpError`; the backend adapts it to
the shared `ApiError` at the boundary (`mastodon/endpoints.ts:5`).
`isAbsent` (404/405 only) gates every fallback (`mastodon/endpoints.ts:183`).

## Instance and session

| Adapter method                                                                      | Endpoint                                                                | Notes                                                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fetchInstanceCapabilities`                                                         | `GET /api/v2/instance`, fallback `GET /api/v1/instance` on 404/405 only | Never falls back on timeout/401/403/5xx (`mastodon/instance.ts`)                                  |
| `verifyCredentials` / `verifySessionAccount`                                        | `GET /api/v1/accounts/verify_credentials`                               | Session restore; adds `source`/`role` extras (`mastodon/auth.ts:32`, `mastodon/endpoints.ts:897`) |
| `fetchNodeinfo`                                                                     | `GET /.well-known/nodeinfo` → `/nodeinfo/2.1`                           | Family detection, `publicTimelineVisibility`                                                      |
| `fetchInstanceRules`                                                                | `GET /api/v1/instance/rules`                                            | Report chooser; Akkoma 404s → rules step hidden (`mastodon/endpoints.ts:1059`)                    |
| `fetchInstancePeers` / `fetchInstanceExtendedDescription` / `fetchInstanceActivity` | `GET /api/v1/instance/peers`, `…/extended_description`, `…/activity`    | Admin-insight reads (`mastodon/admin.ts:150`)                                                     |
| `fetchAdminMeasures` / `fetchAdminDimensions`                                       | `POST /api/v1/admin/measures`, `POST /api/v1/admin/dimensions`          | `{keys[]}`; needs `admin:read` (`mastodon/admin.ts:113`)                                          |
| `fetchCustomEmojis`                                                                 | `GET /api/v1/custom_emojis`                                             | Public (`mastodon/endpoints.ts:1363`)                                                             |

## Timelines and statuses

| Adapter method                | Endpoint                                                       | Notes                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchTimelinePage(home)`     | `GET /api/v1/timelines/home`                                   | May 206 while regenerating (`mastodon/endpoints.ts:74`)                                                                                                       |
| `fetchTimelinePage(local)`    | `GET /api/v1/timelines/public?local=true`                      |                                                                                                                                                               |
| `fetchTimelinePage(global)`   | `GET /api/v1/timelines/public`                                 |                                                                                                                                                               |
| social                        | —                                                              | No endpoint; throws `errors.unsupported.social` rather than serving public as social (`mastodon/endpoints.ts:81`)                                             |
| List feed                     | `GET /api/v1/timelines/list/:id`                               | (`mastodon/backend.ts:1551`)                                                                                                                                  |
| `fetchTagTimelinePage`        | `GET /api/v1/timelines/tag/:id`                                | (`mastodon/endpoints.ts:334`)                                                                                                                                 |
| `getStatus`                   | `GET /api/v1/statuses/:id`                                     | (`mastodon/endpoints.ts:350`)                                                                                                                                 |
| `getStatusContext`            | `GET /api/v1/statuses/:id/context`                             | Flat `{ancestors[], descendants[]}`; tree rebuilt client-side (`mastodon/endpoints.ts:378`)                                                                   |
| `createStatus`                | `POST /api/v1/statuses`                                        | JSON body + one `Idempotency-Key` per attempt (`mastodon/statusActions.ts:133`)                                                                               |
| `editStatus`                  | `PUT /api/v1/statuses/:id`                                     | Empty body re-read (`mastodon/endpoints.ts:902`)                                                                                                              |
| `deleteStatus`                | `DELETE /api/v1/statuses/:id`                                  | `?delete_media=false` keeps attachments for redraft (`mastodon/endpoints.ts:807`)                                                                             |
| `fetchStatusHistory`          | `GET /api/v1/statuses/:id/history`                             | Oldest-first wire order (`mastodon/endpoints.ts:827`)                                                                                                         |
| `setStatusPinned`             | `POST /api/v1/statuses/:id/pin` / `/unpin`                     | (`mastodon/endpoints.ts:916`)                                                                                                                                 |
| `voteInPoll`                  | `POST /api/v1/polls/:id/votes`                                 | Body `{choices: number[]}`; votes the loaded poll id directly (`mastodon/endpoints.ts:936`)                                                                   |
| `setStatusToggle` (favourite) | `POST /api/v1/statuses/:id/favourite` / `/unfavourite`         | (`mastodon/statusActions.ts:23`)                                                                                                                              |
| `setStatusToggle` (reblog)    | `POST /api/v1/statuses/:id/reblog` / `/unreblog`               | Reblog returns the wrapper status (`mastodon/statusActions.ts:23`)                                                                                            |
| Emoji reactions (Akkoma)      | `PUT` / `DELETE /api/v1/pleroma/statuses/:id/reactions/:emoji` | Extension only; vanilla Mastodon has no reaction endpoint (`mastodon/statusActions.ts:77`)                                                                    |
| `muteStatusThread`            | `POST /api/v1/statuses/:id/mute`                               | Thread mute (`mastodon/endpoints.ts:994`)                                                                                                                     |
| `translateStatus`             | `POST /api/v1/statuses/:id/translate`                          | `{lang}`; reads both Mastodon and nested shapes (`mastodon/endpoints.ts:1600`)                                                                                |
| `reportAccount`               | `POST /api/v1/reports`                                         | Only chosen fields (`account_id, comment, status_ids, category, rule_ids, forward`); `rule_ids` forces `category: "violation"` (`mastodon/endpoints.ts:1034`) |

## Accounts and relationships

| Adapter method             | Endpoint                                                                                                                      | Notes                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `getAccount`               | `GET /api/v1/accounts/:id`                                                                                                    | `:id` may be a nickname on Akkoma (`mastodon/endpoints.ts:161`)                             |
| `resolveAccountByHandle`   | `GET /api/v1/accounts/lookup?acct=` → fallback `GET /api/v1/accounts/search` → fallback `GET /api/v2/search` (`resolve=true`) | Fallbacks on 404/405 only; exact-match rule (`mastodon/endpoints.ts:205`)                   |
| `getRelationships`         | `GET /api/v1/accounts/relationships?id[]=…`                                                                                   | (`mastodon/endpoints.ts:271`)                                                               |
| `setFollowing`             | `POST /api/v1/accounts/:id/follow` / `/unfollow`                                                                              | Follow params carry `reblogs` for the boost-visibility toggle (`mastodon/endpoints.ts:949`) |
| `setShowingReblogs`        | `POST /api/v1/accounts/:id/follow` `{reblogs}`                                                                                | (`mastodon/endpoints.ts:973`)                                                               |
| `setBlocked` / `setMuted`  | `POST /api/v1/accounts/:id/block` / `unblock`, `/mute` / `/unmute`                                                            | (`mastodon/endpoints.ts:961`)                                                               |
| `fetchAccountStatusesPage` | `GET /api/v1/accounts/:id/statuses`                                                                                           | `exclude_replies`, `exclude_reblogs`, `only_media`, `pinned` (`mastodon/endpoints.ts:711`)  |
| `fetchAccountListPage`     | `GET /api/v1/accounts/:id/followers` / `/following`, `GET /api/v1/mutes`, `GET /api/v1/blocks`                                | (`mastodon/endpoints.ts:743`)                                                               |
| `fetchStatusAccountPage`   | `GET /api/v1/statuses/:id/reblogged_by` / `/favourited_by`                                                                    | (`mastodon/endpoints.ts:773`)                                                               |
| `answerFollowRequest`      | `POST /api/v1/follow_requests/:id/authorize` / `/reject`                                                                      | Row id is the account id (`mastodon/endpoints.ts:1113`)                                     |
| `fetchFollowRequestsPage`  | `GET /api/v1/follow_requests`                                                                                                 | (`mastodon/endpoints.ts:761`)                                                               |
| `updateCredentialImage`    | `PATCH /api/v1/accounts/update_credentials`                                                                                   | Multipart, one key (`avatar`/`header`) per request (`mastodon/endpoints.ts:853`)            |
| Profile text fields        | `PATCH /api/v1/accounts/update_credentials`                                                                                   | Display name, bio, fields (multipart/form at `mastodon/backend.ts:840`)                     |
| `updateMediaAttachment`    | `PUT /api/v1/media/:id`                                                                                                       | `description`/`focus` only (`mastodon/endpoints.ts:875`)                                    |

## Search, explore, tags

| Adapter method               | Endpoint                                                                                                     | Notes                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchV2`                   | `GET /api/v2/search`                                                                                         | `{q, type?, resolve?, offset?, max_id?, min_id?}`; `resolve=true` only for URL/handle queries on authed sessions (`mastodon/endpoints.ts:456`) |
| `fetchTrendingTags`          | `GET /api/v1/trends/tags`                                                                                    | Weekly-use sums (`mastodon/endpoints.ts:551`)                                                                                                  |
| `fetchTrendingStatuses`      | `GET /api/v1/trends/statuses`                                                                                | Offset-paged, empty page ends (`mastodon/endpoints.ts:574`)                                                                                    |
| `fetchTrendingLinks`         | `GET /api/v1/trends/links`                                                                                   | Vanilla Mastodon only (`mastodon/endpoints.ts:605`)                                                                                            |
| `fetchSuggestions`           | `GET /api/v2/suggestions`                                                                                    | Auth-required (`mastodon/endpoints.ts:641`)                                                                                                    |
| Tag info / follow / unfollow | `GET /api/v1/tags/:name`, `POST /api/v1/followed_tags`, `POST /api/v1/tags/:name/unfollow`                   | (`mastodon/tags.ts:97`)                                                                                                                        |
| Featured tags                | `GET /api/v1/featured_tags`, `POST /api/v1/featured_tags`, `DELETE /api/v1/featured_tags/:id`                | Falls back across v1/v2 on 404/405 (`mastodon/tags.ts:163`)                                                                                    |
| Domain blocks                | `GET /api/v1/domain_blocks`, `POST /api/v1/domain_blocks` `{domain}`, `DELETE /api/v1/domain_blocks?domain=` | (`mastodon/domainBlocks.ts:47`)                                                                                                                |

## Notifications, markers, requests

| Adapter method                                       | Endpoint                                                                                                                                    | Notes                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `fetchNotificationsPage`                             | `GET /api/v1/notifications`                                                                                                                 | `types[]`/`exclude_types[]` (`mastodon/endpoints.ts:1127`)                                             |
| `fetchV2NotificationRows`                            | `GET /api/v2/notifications`                                                                                                                 | Grouped envelope with flat fallback; null when neither envelope matches (`mastodon/endpoints.ts:1183`) |
| `dismissNotification` / group / `clearNotifications` | `POST /api/v1/notifications/:id/dismiss`, `DELETE /api/v2/notifications/:group_key`, `POST /api/v1/notifications/clear`                     | V1 tried first; v2 only after a v1 404/405 (`mastodon/endpoints.ts:1294`)                              |
| `markNotificationsRead`                              | `POST /api/v1/markers`                                                                                                                      | `{notifications: {last_read_id}}` — no v1 mark-as-read endpoint exists (`mastodon/endpoints.ts:1241`)  |
| `fetchNotificationMarkers`                           | `GET /api/v1/markers?timeline[]=notifications`                                                                                              | 404/405 = no read state (`mastodon/endpoints.ts:1272`)                                                 |
| Notification requests + policy                       | `GET /api/v1/notifications/requests`, `POST …/requests/:id/accept`, `POST …/requests/:id/dismiss`, `GET/PATCH /api/v2/notifications/policy` | Probe-gated per origin (`mastodon/notificationRequests.ts:148`)                                        |

## Lists, filters, bookmarks, conversations, media, scheduled

| Adapter method           | Endpoint                                                                                                                                     | Notes                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Lists                    | `GET/POST /api/v1/lists`, `GET/PUT/DELETE /api/v1/lists/:id`, `GET /api/v1/accounts/:id/lists`, `POST/DELETE /api/v1/lists/:id/accounts`     | `replies_policy`/`exclusive` sent only when supported (`mastodon/lists.ts:16`, `mastodon/backend.ts:1545`)                 |
| Filters                  | `GET/POST /api/v2/filters` with `GET/POST /api/v1/filters` fallback; item `GET/PUT/DELETE /api/v1/filters/:id` (+ v2 equivalents)            | V2 edit rewrites every sibling keyword (`mastodon/backend.ts:1413`, `mastodon/filters.ts:91`)                              |
| Bookmarks                | `GET /api/v1/bookmarks` (Link-paged), `POST /api/v1/statuses/:id/bookmark` / `/unbookmark`                                                   | (`mastodon/backend.ts:1612`)                                                                                               |
| Conversations (DM inbox) | `GET /api/v1/conversations` (index scan — no show route exists), `DELETE /api/v1/conversations/:id`, `POST /api/v1/conversations/:id/read`   | (`mastodon/conversations.ts:89`)                                                                                           |
| Upload                   | `POST /api/v2/media` (multipart)                                                                                                             | 202 async on Mastodon — poll `GET /api/v1/media/:id` until done; synchronous body on Akkoma (`mastodon/endpoints.ts:1413`) |
| Scheduled                | `GET /api/v1/scheduled_statuses`, `DELETE /api/v1/scheduled_statuses/:id`                                                                    | Create rides `POST /api/v1/statuses` with `scheduled_at` (`mastodon/endpoints.ts:1080`, `mastodon/backend.ts:1676`)        |
| Admin reports queue      | `GET /api/v1/admin/reports`, `GET /api/v1/admin/reports/:id`, `POST …/:id/assign_to_self`, `/unassign`, `/reopen`, `/resolve`, `PATCH …/:id` | Mutations need `admin:write` (`mastodon/admin.ts:362`)                                                                     |

## Explicitly absent (never called)

`GET /api/v1/search` (removed/absent), `GET /api/v2/instance` on Akkoma
(404), `/api/v1/timelines/direct`, `/api/v1/featured_tags` on Akkoma, all
Misskey `i/*`, `notes/*`, `drive/*` paths. `social` timeline has no mapping
by design.

## Coverage

| Area                                                            | Status      | Evidence                                                              |
| --------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| Timelines / statuses / context / accounts / relationships       | Supported   | `mastodon/endpoints.ts`; smoke `timeline`/`post`/`account` rows       |
| Writes (post/edit/delete/favourite/reblog/poll/bookmark/pin)    | Supported   | `mastodon/statusActions.ts`, `endpoints.ts` write section             |
| Search v2 / trends / suggestions / tags / domain blocks         | Supported   | `endpoints.ts`, `tags.ts`, `domainBlocks.ts`                          |
| Notifications v1+v2 / markers / requests+policy                 | Supported   | `endpoints.ts:1122`, `notificationRequests.ts`                        |
| Lists / filters / bookmarks / conversations / scheduled / media | Supported   | `backend.ts`, module files                                            |
| Mastodon translation / emoji reactions                          | Partial     | Gated on `translationAdvertised` / `pleroma_emoji_reactions` evidence |
| DMs on Pleroma, server drafts, `social` timeline                | Unsupported | No verified endpoint; honest unavailable states                       |

Gaps: quote composition gated on `quoted_status_id` acceptance per server;
translation needs per-server enablement; Akkoma media `focus` ignored;
Pleroma conversations unverified.

## Sources

- `packages/fedi/src/mastodon/endpoints.ts:74` (timelines), `:205` (lookup), `:456` (`searchV2`), `:1080` (scheduled), `:1127` (notifications), `:1413` (upload), `:1600` (translate)
- `packages/fedi/src/mastodon/statusActions.ts:23` (toggles), `:77` (emoji reactions), `:133` (create)
- `packages/fedi/src/mastodon/backend.ts:1545` (lists), `:1413` (filters), `:1612` (bookmarks)
- `packages/fedi/src/mastodon/conversations.ts:89`, `tags.ts:97`, `domainBlocks.ts:47`, `notificationRequests.ts:148`, `admin.ts:113`, `instance.ts`
- `packages/fedi/src/mastodon/stream.ts:1` (protocol), `:183` (stream names)
