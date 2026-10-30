# Misskey-family endpoints

Transport: `POST {origin}/api/{endpoint}` with JSON. Auth rides the `i`
body field on most Misskey-family servers; some Misskey clones use
`Authorization: Bearer` instead (`authStyleFor`, `misskey/client.ts:63`). Public endpoints use
`callPublic` (no credential). Every row below is a real call site — no
endpoint is listed that the code does not call.

Params shown are what the code sends; the standing cross-backend rule is to
send only `{limit, sinceId, untilId}` (+ endpoint-specific ids) and never
extras that strict servers answer with 400 (unknown/empty fields).

## Session and auth

| Adapter method                        | Endpoint                                         | Params / notes                                                                                      |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `fetchSessionMe`                      | `i`                                              | `{}` — session restore (`misskey/auth.ts:22`)                                                       |
| `verifyAppToken`                      | `i`                                              | `{i: token}` — scoped-token verification before store (`misskey/auth.ts:27`)                        |
| `signinNative` (Misskey-clone native) | `signin`                                         | `{username, password}` → `{token, user}` (`misskey/auth.ts:32`)                                     |
| `signinFlow`                          | `signin-flow`                                    | `{username, password}` → finished (`{id, i}`) or pending (`misskey/auth.ts:57`)                     |
| `mintAppToken`                        | `miauth/gen-token` then `miauth/{session}/check` | `{i: nativeToken, session, name, permission[]}`; check returns `{ok, token}` (`misskey/auth.ts:78`) |
| `revokeSessionToken`                  | `i/revoke-token`                                 | `{i, token, tokenId?}` — best-effort at sign-out (`core/sessions.ts:831`)                           |

App identity: name `Keystone`, permission set `KEYSTONE_PERMISSIONS`
(`misskey/auth.ts:102`) — read/write account, notes, reactions,
following, notifications, drive, votes, blocks, mutes, favorites,
report-abuse, clips, channels, chat, and read-only admin/report kinds.

## Timelines, notes, reactions

| Adapter method              | Endpoint                                                                                         | Params / notes                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `timeline(home)`            | `notes/timeline`                                                                                 | Auth; `{limit, sinceId?, untilId?}` (`misskey/backend.ts:168`)                            |
| `timeline(local)`           | `notes/local-timeline`                                                                           | Public; same cursors                                                                      |
| `timeline(social)`          | `notes/hybrid-timeline`                                                                          | Auth; same cursors                                                                        |
| `timeline(global)`          | `notes/global-timeline`                                                                          | Public; same cursors                                                                      |
| `post`                      | `notes/show`                                                                                     | `{noteId}` (`misskey/backend.ts:325`)                                                     |
| `thread`                    | `notes/conversation`                                                                             | Ancestors of a reply (`misskey/backend.ts:340`)                                           |
| `threadReplies`             | `notes/replies`                                                                                  | `{noteId, limit, sinceId?, untilId?}` (`misskey/backend.ts:384`)                          |
| `reposts`                   | `notes/renotes`                                                                                  | One active renote per account, server order (`misskey/backend.ts:401`)                    |
| `noteReactions`             | `notes/reactions`                                                                                | `{noteId, type?, limit, sinceId?}` (`misskey/backend.ts:435`)                             |
| `createPost`                | `notes/create`                                                                                   | Draft body (`misskey/noteBody.ts:62`); → `{createdNote}` (`misskey/backend.ts:452`)       |
| `deletePost`                | `notes/delete`                                                                                   | `{noteId}`; 204 tolerated (`misskey/backend.ts:460`)                                      |
| `react` / `unreact`         | `notes/reactions/create` / `notes/reactions/delete`                                              | `{noteId, reaction}` / `{noteId}` (`misskey/backend.ts:473`)                              |
| `favourite` / `unfavourite` | `notes/favorites/create` / `notes/favorites/delete`                                              | `{noteId}` (`misskey/backend.ts:497`)                                                     |
| `boost` / `unboost`         | `notes/create` `{renoteId}` / `notes/unrenote` `{noteId}`                                        | (`misskey/backend.ts:505`)                                                                |
| `votePoll`                  | `notes/polls/vote`                                                                               | `{noteId, choice}` (`misskey/backend.ts:536`)                                             |
| `like.like`                 | `notes/like`                                                                                     | Toggle endpoint on forks that serve it; per-origin 404 probe cache (`misskey/like.ts:48`) |
| `pinPost` / `unpinPost`     | `i/pin` / `i/unpin`                                                                              | `{noteId}` (`misskey/featured.ts:12`)                                                     |
| `editNote`                  | `notes/edit`                                                                                     | Gated on `status_editing` probe evidence (`misskey/noteEdit.ts:46`)                       |
| `muteThread`                | `notes/thread-muting/create`                                                                     | `{noteId}` (`misskey/backend.ts:770`)                                                     |
| `featuredPosts`             | `notes/featured`                                                                                 | `{limit, untilId?}` (`misskey/featured.ts:25`)                                            |
| `accountFeaturedPosts`      | `users/featured-notes`                                                                           | Pinned notes (`misskey/featured.ts:37`)                                                   |
| `resolveQuoteUri`           | `ap/show`                                                                                        | `{uri}` → `Note` renders a card, anything else is null (`misskey/quote.ts:364`)           |
| `translate`                 | `notes/translate`                                                                                | `{noteId, targetLang}` (`misskey/backend.ts:1021`)                                        |
| `recommendations`           | `notes/recommendations` + `notes/recommendations/dwell` + `notes/recommendations/not-interested` | Fork feed; support probed per origin (`misskey/recommendations.ts:98`)                    |
| `listClipsContaining`       | `notes/clips`                                                                                    | `{noteId}` (`misskey/clips.ts:86`)                                                        |

Poll create: `choices` (2–10 × ≤50 chars), `multiple` (gated on
`polls_multi`), `expiredAfter`/`expiresAt`. Quote = text + `renoteId`;
`cw` (1–100), `localOnly`, `visibleUserIds` (required iff `specified`),
`fileIds` (1–16). Reactions normalize `❤️` → `❤`; custom keys pack the
host (`:name@host:`).

## Accounts, follows, mutes, lists

| Adapter method                   | Endpoint                                                                   | Params / notes                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`                        | `users/show`                                                               | `{userId}` or `{username, host?}` (`misskey/backend.ts:598`)                                                                                        |
| `accountPosts`                   | `users/notes`                                                              | `{userId, limit, sinceId?, untilId?, withReplies?}` (`misskey/backend.ts:612`)                                                                      |
| `followers` / `following`        | `users/followers` / `users/following`                                      | Wrapper rows unwrapped to users, paged on row id (`misskey/backend.ts:616`)                                                                         |
| `accountReactions`               | `users/reactions`                                                          | `{userId, …}` (`misskey/backend.ts:628`)                                                                                                            |
| `relationships`                  | `users/relation`                                                           | `{userId: string[]}` (`misskey/backend.ts:647`)                                                                                                     |
| `follow` / `unfollow`            | `following/create` / `following/delete`                                    | `{userId}` (`misskey/backend.ts:655`)                                                                                                               |
| Follow requests                  | `following/requests/list`, `…/accept`, `…/reject`, `…/cancel`              | (`misskey/followRequests.ts:8`)                                                                                                                     |
| `updateProfile` / avatar+ banner | `i/update`                                                                 | Bounded subset (`name, description, location, birthday, isLocked, isBot`); images ride Drive ids (`avatarId`/`bannerId`) (`misskey/backend.ts:700`) |
| `mutes` / `mute` / `unmute`      | `mute/list` / `mute/create` / `mute/delete`                                | `{userId}` (`misskey/mutes.ts:124`, `misskey/backend.ts:735`)                                                                                       |
| `blocks` / `block` / `unblock`   | `blocking/list` / `blocking/create` / `blocking/delete`                    | (`misskey/mutes.ts:112`, `misskey/backend.ts:762`)                                                                                                  |
| `renoteMutes` etc.               | `renote-mute/list` / `renote-mute/create` / `renote-mute/delete`           | (`misskey/renoteMutes.ts:19`, `misskey/backend.ts:743`)                                                                                             |
| Word/instance mutes              | `i/update` (`mutedWords`, `hardMutedWords`, `mutedInstances`)              | Array-of-AND-groups filters; some Misskey clones reject them                                                                                        |
| Lists                            | `users/lists/list`, `…/create`, `…/update`, `…/delete`, `…/pull`, `…/push` | Name-only params; list timeline feeds via `notes/user-list-timeline` where wired                                                                    |
| `reportAccount`                  | `users/report-abuse`                                                       | `{userId, comment}` — comment required by the server (`misskey/backend.ts:796`)                                                                     |

## Search and explore

| Adapter method       | Endpoint                                | Params / notes                                                                           |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `search.posts`       | `notes/search` or `notes/search-by-tag` | 400 `UNAVAILABLE` is policy denial, never a missing endpoint (`misskey/backend.ts:810`)  |
| `search.accounts`    | `users/search`                          | `{query, limit, offset?}` — always authed (anonymous 500s) (`misskey/backend.ts:838`)    |
| `suggestTags`        | `hashtags/search`                       | `{query, limit}` → names (`misskey/backend.ts:847`)                                      |
| Trending tags        | `hashtags/trend`                        | Top 10 (`misskey/backend.ts:913`)                                                        |
| Trending posts       | `notes/featured`                        | Same endpoint as featured posts (`misskey/backend.ts:929`)                               |
| Pinned users         | `pinned-users`                          | (`misskey/backend.ts:879`)                                                               |
| Popular users        | `users`                                 | `{state: "alive", origin: "local", sort: "+follower", limit}` (`misskey/backend.ts:881`) |
| Custom emoji listing | `emojis`                                | Public (`misskey/backend.ts:973`, store at `misskey/customEmoji.ts:179`)                 |

## Notifications

| Adapter method          | Endpoint                                         | Params / notes                                                                                                |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `notifications`         | `i/notifications-grouped` then `i/notifications` | Grouped rows with flat fallback; `{limit, sinceId?, untilId?}` — no `isRead` field (`misskey/backend.ts:955`) |
| `markNotificationsRead` | `notifications/mark-all-as-read`                 | Void (`misskey/backend.ts:968`)                                                                               |

## Drive, antennas, clips, channels, chat

| Adapter method                               | Endpoint                                                                                                                                                                                                                                                  | Params / notes                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `drive.files` / `showFile` / `attachedNotes` | `drive/files`, `drive/files/show`, `drive/files/attached-notes`                                                                                                                                                                                           | `{limit, sinceId?, untilId?, type?, folderId?}` (`misskey/drive.ts:31`)                                                  |
| `uploadMedia`                                | `drive/files/create`                                                                                                                                                                                                                                      | Multipart `FormData` (never JSON); `isSensitive?`, `folderId?`, `force?` (`misskey/client.ts:330`)                       |
| `updateMedia` / delete                       | `drive/files/update` / `drive/files/delete`                                                                                                                                                                                                               | `{fileId, name?, isSensitive?, comment?, folderId?}` (`misskey/drive.ts:52`)                                             |
| Folders                                      | `drive/folders`, `…/create`, `…/update`, `…/delete`                                                                                                                                                                                                       | (`misskey/drive.ts:64`)                                                                                                  |
| Antennas                                     | `antennas/list`, `antennas/notes`, `antennas/create`, `antennas/update`, `antennas/delete`                                                                                                                                                                | Required: `name, src, keywords, excludeKeywords, users, caseSensitive, withReplies, withFile` (`misskey/antennas.ts:54`) |
| Clips                                        | `clips/list`, `clips/notes`, `clips/create`, `clips/update`, `clips/delete`, `clips/add-note`, `clips/remove-note`                                                                                                                                        | (`misskey/clips.ts:36`)                                                                                                  |
| Channels                                     | `channels/search`, `channels/show`, `channels/followed`, `channels/follow`, `channels/unfollow`, `channels/timeline`                                                                                                                                      | Follow needs `read:channels`/`write:channels` (`misskey/channels.ts:64`)                                                 |
| Chat                                         | `chat/rooms/create`, `chat/rooms/joining`, `chat/rooms/show`, `chat/messages/create-to-room`, `chat/messages/create-to-user`, `chat/messages/room-timeline`, `chat/messages/user-timeline`, `chat/messages/show`, `chat/messages/delete`, `chat/read-all` | Needs `read:chat`/`write:chat`; unknown releases degrade via 404→unsupported (`misskey/chat.ts`)                         |
| Scheduled                                    | `notes/schedule/create`, `notes/schedule/list`, `notes/schedule/delete`                                                                                                                                                                                   | (`misskey/schedule.ts:16`)                                                                                               |
| Server drafts                                | `notes/drafts/create`, `notes/drafts/list`, `notes/drafts/update`, `notes/drafts/delete`, `notes/drafts/count`                                                                                                                                            | (`misskey/serverDrafts.ts:15`)                                                                                           |
| Import                                       | Drive upload then `i/import-following`, `i/import-blocking`, `i/import-muting`, `i/import-notes`                                                                                                                                                          | `{fileId}`, never `{file}` (`misskey/importExport.ts:43`)                                                                |
| Export                                       | `i/export-following`, `i/export-blocking`, `i/export-mute`, `i/export-notes`, `i/export-clips`, `i/export-favorites`, `i/export-antennas`, `i/export-user-lists`                                                                                          | Enqueue-only; completion arrives via notification (`misskey/importExport.ts:215`)                                        |

## Announcements and admin

| Adapter method  | Endpoint                                                                                                                           | Params / notes                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `announcements` | `announcements` (public) + `i/read-announcement`                                                                                   | (`misskey/announcements.ts:79`)                                                        |
| `adminInsight`  | `admin/server-info`, `admin/meta`, `admin/queue/stats`, `get-online-users-count`                                                   | Exact-kind grants (`read:admin:*`); `admin/meta` is admin-only (`misskey/admin.ts:73`) |
| `reportsQueue`  | `admin/abuse-user-reports`, `admin/resolve-abuse-user-report`, `admin/update-abuse-user-report`, `admin/forward-abuse-user-report` | One shared mutation kind (`misskey/admin.ts`)                                          |

## Coverage

| Area                                                                | Status      | Evidence                                            |
| ------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| Timelines / notes / replies / reactions / follows                   | Supported   | Backend + smoke (`timeline`, `post` rows)           |
| Drive / antennas / clips / channels / chat / scheduled / drafts     | Supported   | Modules above; smoke `sub:*` list-only probes       |
| Polls / emoji listing / search / explore                            | Supported   | Rows above; note search is policy-dependent         |
| Import/export / admin insight / reports queue                       | Supported   | Modules above                                       |
| Thread muting / favorites / report-abuse                            | Supported   | Rows above                                          |
| Full profile editor (avatar decorations, fields), folder navigation | Unsupported | No endpoints wired; rows stay disabled with reasons |

Gaps: `users/lists/*` names unverified live; vanilla-Misskey `notes/edit`
presence is probe-gated (unknown until probed); some Misskey clones lack drive
listing, antennas, polls, Miauth, chat (404 → honest unavailable).

## Sources

- `packages/fedi/src/misskey/auth.ts:22` (`i`), `:32` (`signin`), `:57` (`signin-flow`), `:78` (`miauth/*`), `:102` (`KEYSTONE_PERMISSIONS`)
- `packages/fedi/src/misskey/backend.ts:168` (timeline map), `:325` (`notes/show`), `:452` (`notes/create`), `:700` (`i/update`), `:955` (notifications), `:1021` (`notes/translate`)
- `packages/fedi/src/misskey/client.ts:63` (`authStyleFor`), `:330` (upload)
- `packages/fedi/src/misskey/drive.ts:31`, `antennas.ts:54`, `clips.ts:36`, `channels.ts:64`, `chat.ts`, `schedule.ts:16`, `serverDrafts.ts:15`, `importExport.ts:43`, `admin.ts:73`, `announcements.ts:79`, `featured.ts:12`, `followRequests.ts:8`, `recommendations.ts:98`, `quote.ts:364`, `like.ts:48`, `noteEdit.ts:46`
- `packages/fedi/src/core/sessions.ts:831` (`i/revoke-token`)
