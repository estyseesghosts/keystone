# Domain models (`core/`)

The only types `src/` may import from `packages/fedi`. Everything below
lives in `packages/fedi/src/core/` and is written in the adapter's own
words — wire shapes are adapted at the backend boundary, never in the UI.

## `Post` and friends (`core/models.ts`)

| Model                               | Owns                                      | Key fields                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content`                           | One parsed body (`models.ts:38`)          | `kind: "mfm" \| "html" \| "plain"`, parsed AST nodes, `plain` fallback                                                                                                                                         |
| `VisibilityKind`                    | Normalized visibility (`models.ts:98`)    | `public \| quiet \| followers \| direct`                                                                                                                                                                       |
| `Visibility`                        | Visibility + local-only (`models.ts:100`) | `kind`, `localOnly`                                                                                                                                                                                            |
| `Account`                           | A user, either family (`models.ts:145`)   | `id`, `username`, `host`, `acct`, `displayName`, `avatar`, `bio` (`Content`), `followersCount`/`followingCount`/`statusesCount`, `isBot`, `isLocked`, `fields[]`                                               |
| `AccountExt`                        | Adapter extras (`models.ts:222`)          | Flavor-specific remainder (e.g. grouped notification counts)                                                                                                                                                   |
| `Media`                             | One attachment (`models.ts:240`)          | `id`, `kind: image \| gifv \| video \| audio \| file \| unknown`, `url`, `previewUrl`, dimensions, `description` (alt), `blurhash`                                                                             |
| `PollOption` / `Poll`               | A poll (`models.ts:280/290`)              | Options with vote counts, `multiple`, `expiresAt`, `voted`/`ownVotes` (auth-only), poll `id` (Mastodon votes by it directly)                                                                                   |
| `ReactionEntry` / `ReactionSummary` | Misskey reactions (`models.ts:311/321`)   | Per-emoji counts, packed emoji URLs; never merged with favourites                                                                                                                                              |
| `FavouriteState`                    | Mastodon favourite (`models.ts:333`)      | `mine` boolean; kept separate from `reactions` on purpose                                                                                                                                                      |
| `Post`                              | A note/status (`models.ts:464`)           | `id`, `author: Account`, `content: Content`, `visibility`, `createdAt`, `replyToId`, `renote` (boosted post), `media[]`, `poll?`, `reactions?`, `favourite`, counts, `sensitive`/`spoilerText`, `ext: PostExt` |
| `PostExt`                           | Adapter extras (`models.ts:519`)          | Quote refs, grouped-notification ids, reblog flags, family remainder                                                                                                                                           |
| `PostRevision`                      | Edit-history entry (`models.ts:651`)      | Newest-first snapshots with the original last                                                                                                                                                                  |
| `Relationship`                      | Viewer↔account state (`models.ts:671`)    | `following`, `followedBy`, `blocking`, `muted`, `requested`, `showingReblogs`, `mutingNotifications`, …                                                                                                        |
| `NotificationKind`                  | Notification type union (`models.ts:687`) | `mention`, `follow`, `reblog`, `favourite`, `poll`, `update`, family extensions; unknown types render a generic row, never crash                                                                               |
| `Notification`                      | One notification (`models.ts:746`)        | `id`, `kind`, `createdAt`, `actor?`, `post?`, `ext: NotificationExt`                                                                                                                                           |
| `Page<T>` / `Cursor`                | Paged results (`models.ts:811`)           | `items`, `cursor?` (opaque string, never parsed), `end`; helpers `endPage`, `appendOlder`                                                                                                                      |
| `LinkCard`                          | Unfurled URL preview (`models.ts:444`)    | `url`, `title`, `description`, provider, image                                                                                                                                                                 |

Helpers: `appearNoteOf`/`isPureRenote`/`collapseReposts` (`models.ts:566+`)
unwrap boost wrappers for rendering; `acctFromBridgeUrl`/`isBridgedPost`
(`models.ts:876+`) handle bridged accounts.

## Capabilities (`core/detect.ts`)

`Capabilities` is `Record<FeatureKey, FeatureSupport>` where each flag is
`supported | unsupported | unknown`. Unknown never unlocks UI. The full key
list (`detect.ts:49`) with what each gates:

| Flag                                                   | Gates                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `reactions`                                            | React/unreact controls, reaction tabs                                                                                     |
| `reaction_acceptance`                                  | Composer reaction-acceptance control                                                                                      |
| `like`                                                 | Misskey-family `notes/like` shortcut (probed per origin, never flavor-guessed)                                            |
| `mfm`                                                  | MFM content path (vs HTML)                                                                                                |
| `quote_posting`                                        | Quote compose                                                                                                             |
| `status_editing`                                       | Edit post + edit history                                                                                                  |
| `polls_multi`                                          | Multi-choice poll toggle                                                                                                  |
| `polls_hide_totals`                                    | Poll hide-totals field (Mastodon only)                                                                                    |
| `scheduled_posts`                                      | Scheduled-posts API                                                                                                       |
| `server_drafts`                                        | Server-drafts API                                                                                                         |
| `local_only`                                           | Local-only post toggle                                                                                                    |
| `no_quote`                                             | Per-note quote refusal (Misskey family)                                                                                   |
| `media_sensitivity`                                    | Per-file sensitivity at upload (Misskey family)                                                                           |
| `drive` / `antennas` / `clips` / `channels`            | Optional `Backend` members (Misskey family)                                                                               |
| `announcements`                                        | Announcements surface                                                                                                     |
| `chats`                                                | Misskey-family `chat/*` surface                                                                                           |
| `direct_messages`                                      | DM/chat inbox surface (client gate: only flavors that ship it read `supported`)                                           |
| `lists` / `lists_replies_policy` / `lists_exclusive`   | Lists API + list timeline feed                                                                                            |
| `bookmarks`                                            | Bookmarks API                                                                                                             |
| `favourites_distinct_from_reactions`                   | Favourite kept separate from reactions (Mastodon family)                                                                  |
| `notification_requests`                                | Filtered-notifications inbox (probe-backed only, never flavor-seeded)                                                     |
| `translation`                                          | Translate action                                                                                                          |
| `streaming`                                            | Live `stream()` handle vs paging-only                                                                                     |
| `password_grant` / `mfa_challenge` / `pkce` / `miauth` | Which login flows exist                                                                                                   |
| `admin_read` / `admin_write`                           | Server-insight reads / reports-queue mutations (default `unknown`; role comes from `verify_credentials`, never detection) |

Flavor defaults live in `FLAVOR_FEATURES` (`detect.ts:318`); per-origin
probe evidence can raise `unknown` via `buildCapabilities`
(`detect.ts:594`): Pleroma feature flags, Mastodon ≥4.5 version check,
family-scoped translation evidence, and Misskey endpoint probes
(`notesEditAvailable`, `scheduledAvailable`, `serverDraftsAvailable`).

## Feed addressing (`core/feedDescriptor.ts`)

Feeds are addressed by opaque descriptor strings from day one; deck columns
are `{descriptor, sessionId, options}`:

| Descriptor                                                                     | Feed                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `timeline\|home` / `timeline\|local` / `timeline\|social` / `timeline\|global` | Family timelines (social = Misskey `hybrid-timeline`; absent on Mastodon — honest unsupported, never public-as-social) |
| `list\|<id>`                                                                   | Mastodon list timeline                                                                                                 |
| `antenna\|<id>`                                                                | Misskey antenna feed                                                                                                   |
| `channel\|<id>`                                                                | Misskey channel timeline                                                                                               |
| `clip\|<id>`                                                                   | Clip notes                                                                                                             |
| `tag\|<tag>`                                                                   | Tag timeline                                                                                                           |
| `user\|<id>\|<tab>`                                                            | Profile tabs (`posts \| all \| replies \| media \| featured`)                                                          |
| `search\|<query>`                                                              | Search results feed                                                                                                    |
| `explore\|posts`                                                               | Trending-posts feed                                                                                                    |
| `bookmarks` / `mentions` / `recommendations`                                   | Special feeds                                                                                                          |

Parsed by `parseFeedDescriptor` (`feedDescriptor.ts:79`), formatted back
by `formatFeedDescriptor` (`feedDescriptor.ts:132`). Invalid strings are the
typed `errors.feeds.invalidDescriptor` error — never a guessed feed.

## Supporting core modules

| Module             | Owns                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/backend.ts`  | The `Backend` interface: every feed/post/account/mute/search/notification/stream capability, most as optional members (absent member = hidden surface) |
| `core/errors.ts`   | `FediError` (`{code, params}`) and `ApiError` (adds HTTP `status`); the full code union `FEDI_ERROR_CODES`                                             |
| `core/sessions.ts` | `Session` (`{id, origin, family, flavor, accountId, token, grant, hosting}`), per-origin key-value store, app cache, revocation                        |
| `core/http.ts`     | Transport seam: timeouts, redirect/cross-origin guards, empty-body tolerance                                                                           |
| `core/graph.ts`    | `gateGraph` follow/list/soft-mute gates with stable `gate.*` reason codes                                                                              |
| `core/detect.ts`   | Family/flavor detection + capabilities (above)                                                                                                         |
| `core/content/`    | The one allow-listed AST for MFM + HTML (`ast`, `fromMfm`, `fromHtml`)                                                                                 |
| `api/`             | Pure ports: MFM fold, tag blocks, link previews, composer helpers, emoji data/assets                                                                   |

## Coverage

| Area                                                 | Status                | Evidence                                                                                   |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `Post` / `Account` / `Notification` / `Capabilities` | Supported             | `core/models.ts`, `core/detect.ts`; ported suites pin per-file counts                      |
| `FeedDescriptor` addressing                          | Supported             | `core/feedDescriptor.ts`; grammar + dispatch round-trip tests                              |
| `PostRevision` history                               | Partial               | Mastodon backend serves it; Misskey family has no history endpoint (badge non-interactive) |
| Wire types in `src/`                                 | Unsupported (by rule) | `no-wire-in-app` lint; adapters convert at the boundary                                    |

Gaps: none in the model layer itself — family gaps (e.g. no Misskey edit
history) are recorded on the endpoint pages.

## Sources

- `packages/fedi/src/core/models.ts:38` (`Content`), `:98` (`VisibilityKind`), `:145` (`Account`), `:240` (`Media`), `:290` (`Poll`), `:464` (`Post`), `:671` (`Relationship`), `:687` (`NotificationKind`), `:746` (`Notification`), `:811` (`Page`)
- `packages/fedi/src/core/detect.ts:49` (`FeatureKey`), `:138` (`FEATURE_KEYS`), `:318` (`FLAVOR_FEATURES`), `:594` (`buildCapabilities`)
- `packages/fedi/src/core/feedDescriptor.ts:15` (`FeedDescriptor`), `:79` (`parseFeedDescriptor`)
- `packages/fedi/src/core/backend.ts:1318` (`Backend`)
- `packages/fedi/src/core/errors.ts:24` (`FEDI_ERROR_CODES`)
