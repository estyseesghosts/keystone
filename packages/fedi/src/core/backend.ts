// The Backend interface (unified plan §2.2): what the UI talks to. One
// implementation per family — `src/misskey/backend.ts` (Misskey family)
// and, from Phase 3, `src/mastodon/` (Mastodon family). The UI consumes
// ONLY this file plus `core/models.ts`; wire shapes never cross up.
//
// Required methods are exactly plan §2.2; additions beyond that list are
// marked "(addition)" and exist because today's app calls them (Phase 2's
// discipline: today's app is the regression baseline — every behaviour it
// has must be reachable through this interface).
//
// Capability-gated sub-modules (drive, antennas, clips, lists, scheduled,
// serverDrafts, bookmarks) are OPTIONAL members: a backend that cannot
// support one leaves it undefined and the UI shows an honest "not on this
// server" state — never an inert control.

import type {
  Account,
  Cursor,
  Media,
  Notification,
  Page,
  Post,
  PostRevision,
  Relationship,
  VisibilityKind,
} from "./models";
import type { Capabilities, ServerFamily } from "./detect";

// i18n note: this module carries no locale framework (pure-TS rule). UI
// strings below are English fallback data plus stable label-key codes
// (plain `string`, resolved by the UI via its own catalog).

// --- Pagination ------------------------------------------------------------

export interface PageOpts {
  cursor?: Cursor | null;
  limit?: number;
}

// --- Feeds -----------------------------------------------------------------

/** Feed kinds (plan §2.2 `timeline(kind, cursor)`). `global` is the
 * federated/global timeline (Mastodon's `/public` maps here in Phase 3);
 * `social` is the Misskey-family hybrid/social timeline
 * (`notes/hybrid-timeline`, auth + `ltlAvailable` policy) — the Mastodon
 * family answers it as unsupported, never an empty feed. */
export type TimelineKind = "home" | "local" | "social" | "global";

export interface AccountPostsOpts extends PageOpts {
  /** Misskey `users/notes` filters (profile tabs). Sent EXACTLY as given:
   * the `posts` tab sends explicit `false`s because the server defaults
   * differ (withRenotes defaults to true); the `all` tab sends both
   * `true` (replies + renotes, v1 A1). The Mastodon family maps the same
   * flags to `exclude_replies` / `exclude_reblogs` (false = include). */
  withReplies?: boolean;
  withRenotes?: boolean;
  withFiles?: boolean;
  /** Featured/pinned listing (`users/featured-notes`). */
  featured?: boolean;
}

// --- Compose ---------------------------------------------------------------

/** Per-note reaction visibility (Misskey `reactionAcceptance`). `null`
 * (default) means all reactions allowed. The values are wire values with
 * raw passthrough: an unknown string is sent verbatim, never dropped. */
export type ReactionAcceptance =
  | "likeOnly"
  | "likeOnlyForRemote"
  | "nonSensitiveOnly"
  | "nonSensitiveOnlyForLocalLikeOnlyForRemote";

export const REACTION_ACCEPTANCE_LABELS: Record<ReactionAcceptance, string> = {
  likeOnly: "Like only",
  likeOnlyForRemote: "Like only (remote)",
  nonSensitiveOnly: "Non-sensitive only",
  nonSensitiveOnlyForLocalLikeOnlyForRemote: "Non-sensitive local, like-only remote",
};

/** Stable label-key codes for the per-note reaction visibility options,
 * resolved at render time by the UI. The English `LABELS` object above
 * stays as the fallback. */
export const REACTION_ACCEPTANCE_LABEL_KEYS: Record<ReactionAcceptance, string> = {
  likeOnly: "reaction.likeOnly",
  likeOnlyForRemote: "reaction.likeOnlyRemote",
  nonSensitiveOnly: "reaction.nonSensitiveOnly",
  nonSensitiveOnlyForLocalLikeOnlyForRemote: "reaction.nonSensitiveLocal",
};

/** English label for a per-note reaction visibility value (fallback data;
 * the UI localizes via `REACTION_ACCEPTANCE_LABEL_KEYS`). Unknown strings
 * pass through verbatim (raw passthrough). */
export function reactionAcceptanceLabel(value: string | null): string | null {
  if (value == null) return null;
  return (REACTION_ACCEPTANCE_LABELS as Record<string, string>)[value] ?? value;
}

export interface PollDraft {
  choices: string[];
  multiple?: boolean;
  expiresAt?: number;
  expiredAfter?: number;
  /** Mastodon-family `poll[hide_totals]` (capability
   * `polls_hide_totals`). `true` only: the field is omitted otherwise, so
   * a server default is never overwritten by a false. */
  hideTotals?: boolean;
}

/** Multipart upload options (addition). `folderId`/`force` are Misskey-
 * family Drive fields; the Mastodon family ignores them because Drive does
 * not exist there. Root is the default: omit `folderId` rather than
 * sending a null/empty value. */
export interface UploadMediaOpts {
  isSensitive?: boolean;
  comment?: string;
  folderId?: string | null;
  force?: boolean;
}

/** Post-upload media edit (clickstone §1.7). `description` is alt text;
 * `focus` is the Mastodon crop focal point, a `"-0.5,0.5"`-style pair in
 * `[-1, 1]`. A family without a field simply never receives it: the
 * Misskey family has no focus (its caption is `drive/files/update`'s
 * `comment`) and the backend ignores `focus` there — the UI never offers
 * it. `null` clears the description. */
export interface MediaUpdate {
  description?: string | null;
  focus?: string | null;
}

/** A post being composed or edited. `visibility` carries `raw` so an
 * edited `home` post is written back as `home` (plan §2.1) — when `raw` is
 * absent (a fresh compose) the adapter maps `kind` to its own wire value
 * (`quiet` → `home` on the Misskey family). */
export interface PostDraft {
  text?: string | null;
  cw?: string | null;
  visibility?: {
    kind: VisibilityKind;
    localOnly: boolean;
    /** Wire value to write back; omit on fresh compose. */
    raw?: string;
  };
  /** `specified` recipients. */
  visibleUserIds?: string[];
  replyId?: string;
  renoteId?: string;
  mediaIds?: string[];
  poll?: PollDraft | null;
  /** Misskey per-note reaction visibility (capability `reaction_acceptance`). */
  reactionAcceptance?: ReactionAcceptance | null;
  /** Sharkey per-note quote refusal (capability `quote_posting` variants). */
  noQuote?: boolean;
}

// --- Profile ---------------------------------------------------------------

/** Profile update patch for `updateProfile`. Generic fields are typed; the
 * family extras ride in `ext` and are passed through verbatim by the
 * adapter (the profile editor is the only producer and treats the bag as
 * opaque key/values the server round-trips). */
export interface ProfileUpdate {
  name?: string | null;
  /** Bio as MFM source (Misskey family). */
  bio?: string | null;
  location?: string | null;
  birthday?: string | null;
  locked?: boolean;
  bot?: boolean;
  followedMessage?: string | null;
  /** Custom profile fields (Mastodon `fields_attributes`; Misskey `fields`). */
  fields?: Array<{ name: string; value: string }> | null;
  lang?: string | null;
  avatarId?: string | null;
  bannerId?: string | null;
  /** Family extras (`i/update` fields like `mutedWords`, `noCrawle`, …). */
  ext?: Record<string, unknown>;
}

/** Which profile image an upload replaces (clickstone §1.8). */
export type ProfileImageKind = "avatar" | "banner";

// --- Search ----------------------------------------------------------------

export interface SearchPostsOpts extends PageOpts {
  /** Misskey `notes/search-by-tag` for tag queries. */
  tag?: boolean;
}

/** Trending users: pinned by the instance (Misskey family) plus the
 * suggested/popular accounts. Either list may be empty — never null. */
export interface ExploreUsers {
  pinned: Account[];
  suggested: Account[];
}

/** One trending tag. Counts are best-effort per family (Misskey
 * `usersCount`; Mastodon weekly history sums) and may be null. */
export interface TrendingTag {
  name: string;
  users: number | null;
  uses: number | null;
}

/** One trending link (the Explore "News" item, Mastodon-only). */
export interface NewsLink {
  url: string;
  title: string;
  description: string | null;
  providerName: string | null;
  image: string | null;
}

/** Explore-page trending content. Every method degrades honestly: a 404
 * from the server reads as "not on this server" (the page shows the
 * unavailable state, never faked content); auth failures stay auth
 * failures. `news` exists ONLY on the vanilla-Mastodon backend — every
 * other flavor leaves it undefined and the UI hides the tab. */
export interface ExploreApi {
  /** Trending/suggested users. */
  users(opts?: PageOpts): Promise<ExploreUsers>;
  /** Trending tags. */
  tags(opts?: PageOpts): Promise<TrendingTag[]>;
  /** Trending posts (cursor-paged). */
  posts(opts?: PageOpts): Promise<Page<Post>>;
  /** Trending links. Vanilla Mastodon only — undefined elsewhere. */
  news?(opts?: PageOpts): Promise<Page<NewsLink>>;
}

// --- Custom emoji ----------------------------------------------------------

export interface CustomEmoji {
  name: string;
  url: string;
  category?: string | null;
}

// --- Translation -----------------------------------------------------------

export interface Translation {
  sourceLang: string | null;
  text: string;
}

// --- Notifications (addition: the app has flat + grouped listings) ---------

export interface NotificationsOpts extends PageOpts {
  /** Grouped rows (`i/notifications-grouped`) vs flat items. */
  grouped?: boolean;
  /** Misskey includeTypes/excludeTypes presets (never a second list UI). */
  includeTypes?: string[];
  excludeTypes?: string[];
}

// --- Follow requests -------------------------------------------------------

export interface FollowRequest {
  id: string;
  follower: Account;
  /** The followed account (the viewer, for incoming requests). */
  followee: Account;
}

/** Notification filter presets (maps to includeTypes/excludeTypes — no
 * second list UI; blacklist = mutes, whitelist = followingOrFollower
 * scoping, mutuals = mutualFollow, followed = following). The values are
 * core notification KINDS, and each backend maps them to its own wire
 * types (`misskey/backend.ts` `MISSKEY_NOTIFY_TYPES`,
 * `mastodon/backend.ts` `NOTIF_WIRE_TYPES`) — a preset never sends a
 * Misskey spelling to Mastodon. */
export const NOTIFICATION_FILTER_PRESETS: Array<{
  id: string;
  label: string;
  /** Label-key code the UI resolves at render time. */
  labelKey: string;
  includeTypes?: string[];
  excludeTypes?: string[];
  /** Family that has these notification types at all. Absent = both. A
   * preset gated to `misskey` is hidden on Mastodon rather than shown as
   * an always-empty list (clickstone §1.11: the Misskey system rows). */
  family?: "misskey" | "mastodon";
}> = [
  { id: "all", label: "All", labelKey: "notif.filterAll" },
  { id: "mentions", label: "Mentions", labelKey: "notif.filterMentions", includeTypes: ["mention", "reply"] },
  { id: "reactions", label: "Reactions", labelKey: "notif.filterReactions", includeTypes: ["reaction"] },
  { id: "reposts", label: "Reposts", labelKey: "notif.filterReposts", includeTypes: ["renote", "quote"] },
  { id: "follows", label: "Follows", labelKey: "notif.filterFollows", includeTypes: ["follow", "receiveFollowRequest", "followRequestAccepted"] },
  { id: "polls", label: "Polls", labelKey: "notif.filterPolls", includeTypes: ["pollVote", "pollEnded"] },
  // Misskey `note`: new notes from accounts the viewer follows.
  { id: "notes", label: "Notes", labelKey: "notif.filterNotes", includeTypes: ["note"], family: "misskey" },
  // Misskey system rows (clickstone §1.11): the viewer's own scheduling,
  // export, role, achievement, session and token events. No Mastodon
  // equivalents ship yet, so the preset is hidden there.
  {
    id: "system",
    label: "System",
    labelKey: "notif.filterSystem",
    includeTypes: [
      "scheduledNotePosted",
      "scheduledNotePostFailed",
      "exportCompleted",
      "roleAssigned",
      "achievement",
      "login",
      "createToken",
      "test",
      "app",
    ],
    family: "misskey",
  },
];

/** The presets a family can actually serve. Presets without a `family`
 * apply to both; gated ones appear only where the types exist, so the UI
 * never shows a chip that can only ever be empty. */
export function notificationFilterPresets(
  family: "misskey" | "mastodon",
): typeof NOTIFICATION_FILTER_PRESETS {
  return NOTIFICATION_FILTER_PRESETS.filter(
    (preset) => preset.family === undefined || preset.family === family,
  );
}

/** One row of an account's reactions (`users/reactions`). */
export interface UserReaction {
  id: string;
  createdAt: string;
  /** The reaction key verbatim. */
  reaction: string;
  /** The reacted post; null when the server hides it. */
  post: Post | null;
}

/** One row of a note's reactions (`notes/reactions`): who reacted with
 * what. Misskey-family only — the Mastodon family has no per-note
 * reactor listing (favourites are never repackaged as reactions). */
export interface NoteReactionRow {
  id: string;
  createdAt: string;
  /** The reaction key verbatim (`:name@host:` packs the host). */
  reaction: string;
  /** The reacting account. */
  account: Account;
}

// --- Streaming -------------------------------------------------------------

/** Live-update status the UI surfaces ("live updates unavailable" + poll
 * fallback when streaming is blocked, e.g. by CORS). Mirrors the pool's
 * states (`misskey/stream.ts`). `stopped` is the honest dead state: the
 * server killed the channel or the reconnect breaker tripped, so no
 * further dial happens until the user retries (feeds keep polling). */
export type StreamState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "unavailable"
  | "stopped";

/** What a feed subscription follows. `kind` covers the basic timelines
 * (social is Misskey-family only — the Mastodon backend answers it as
 * unsupported); `antennaId`/`listId`/`tag`/`channelId`/`clipId` are the
 * named feeds. Tag feeds ride `search.tags` on both families; lists ride
 * `lists.timeline` on both families (Misskey `notes/user-list-timeline`,
 * Mastodon `/timelines/list/:id`); channels ride Misskey
 * `channels/timeline` with a `channel` live channel (Mastodon: no channel
 * source); clips ride `clips/notes` (Misskey-family only, no live channel —
 * paging + refresh). */
export type FeedSource = { kind: TimelineKind } | { antennaId: string } | { listId: string } | { tag: string } | { channelId: string } | { clipId: string };

/** Per-feed live state for status badges. */
export type FeedChannelState = "disabled" | "pending" | "subscribed" | "unavailable";

export interface FeedSubscription {
  unsubscribe(): void;
  /** The feed channel's own state (badges distinguish "no socket" from
   * "socket up, channel not acked"). */
  status(): FeedChannelState;
}

export interface PostUpdateEvent {
  /** Reaction/reply/renote deltas applied to a captured post. */
  id: string;
  type: string;
  reaction?: string | null;
  userId?: string | null;
}

export interface StreamHandle {
  /** Follow a feed; the subscription carries the per-channel badge state. */
  subscribeTimeline(source: FeedSource, onPost: (post: Post) => void): FeedSubscription;
  /** Follow one post's live updates (reactions/replies/renotes/deleted). */
  subscribePost(
    id: string,
    handlers: {
      onUpdated?: (event: PostUpdateEvent) => void;
      onDeleted?: () => void;
    },
  ): () => void;
  /** Live notifications; returns an unsubscribe function. */
  onNotification(handler: (notification: Notification) => void): () => void;
  /** Current live state + subscription (the StreamBadge reads this). */
  status(): StreamState;
  onStatusChange(handler: (state: StreamState) => void): () => void;
  /** Manual re-dial after a dead state (`kill` or the reconnect
   * breaker). Optional: handles that never go dead (the Misskey pool
   * keeps its own backoff) omit it and the UI remounts instead. */
  retry?(): void;
  /** Server-side filter rules changed (`filters_changed`): the caller
   * invalidates its filter query. Optional — families without the frame
   * omit it. */
  onFiltersChanged?(handler: () => void): () => void;
}

// --- Capability-gated sub-modules -----------------------------------------

export type MediaKindFilter = "image" | "video" | "audio" | "file";

export interface DriveApi {
  /** List files (newest-first cursor paging). `type` is the server-side
   * MIME filter the category views page on. `folderId` scopes the listing
   * to one folder; omitted (or null) means the Drive root — the same
   * default the server takes when the field is absent, so it is never put
   * on the wire for root. */
  files(opts?: PageOpts & { type?: string; folderId?: string | null }): Promise<Page<Media>>;
  /** One file's current metadata (`drive/files/show`). */
  showFile(id: string): Promise<Media>;
  /** Notes that attach this file (`drive/files/attached-notes`),
   * newest-first cursor paging. */
  attachedNotes(id: string, opts?: PageOpts): Promise<Page<Post>>;
  updateFile(
    id: string,
    patch: { name?: string; isSensitive?: boolean; comment?: string | null; folderId?: string | null },
  ): Promise<Media>;
  deleteFile(id: string): Promise<void>;
  /** Drive folders (addition — Misskey `drive/folders/*`). The browser
   * lists/creates/renames/deletes them and scopes file listings and
   * uploads to the selected folder. */
  folders?: DriveFoldersApi;
}

/** One drive folder (Misskey-family only). */
export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** Drive-folder management (addition — optional like every gated
 * sub-module; backends without the endpoints leave it undefined). */
export interface DriveFoldersApi {
  list(): Promise<DriveFolder[]>;
  create(name: string, opts?: { parentId?: string | null }): Promise<DriveFolder>;
  update(id: string, patch: { name?: string; parentId?: string | null }): Promise<DriveFolder>;
  delete(id: string): Promise<void>;
}

export type AntennaSrc = "home" | "all" | "users" | "users_blacklist" | "list";

export interface Antenna {
  id: string;
  name: string;
  src: AntennaSrc;
  userListId: string | null;
  /** Keyword groups, verified against Misskey AntennaService: each inner
   * array is an AND-group, groups are ORed. The nested shape is preserved
   * and never flattened. */
  keywords: string[][];
  excludeKeywords: string[][];
  users: string[];
  caseSensitive: boolean;
  localOnly: boolean;
  excludeBots: boolean;
  withReplies: boolean;
  withFile: boolean;
}

export interface AntennasApi {
  list(): Promise<Antenna[]>;
  create(params: Omit<Antenna, "id">): Promise<Antenna>;
  update(id: string, params: Omit<Antenna, "id">): Promise<Antenna>;
  delete(id: string): Promise<void>;
  /** The antenna's feed (`antennas/notes`). */
  notes(id: string, opts?: PageOpts): Promise<Page<Post>>;
}

export interface ClipSummary {
  id: string;
  name: string;
  isPublic?: boolean;
  description?: string | null;
  /** Packed `notesCount` when the server sent it (list views). */
  notesCount?: number | null;
}

export interface ClipsApi {
  list(): Promise<ClipSummary[]>;
  addNote(clipId: string, noteId: string): Promise<void>;
  removeNote(clipId: string, noteId: string): Promise<void>;
  create(
    name: string,
    opts?: { isPublic?: boolean; description?: string | null },
  ): Promise<ClipSummary>;
  update(
    clipId: string,
    patch: { name?: string; isPublic?: boolean; description?: string | null },
  ): Promise<ClipSummary>;
  delete(clipId: string): Promise<void>;
  /** A clip's notes (`clips/notes`). */
  notes(clipId: string, opts?: PageOpts): Promise<Page<Post>>;
  /** Clips containing a note (`notes/clips`, Misskey `notes/clips`). */
  containing(noteId: string): Promise<ClipSummary[]>;
}

/** Which of the viewer's lists hold an account, and edit that (slice 4.4). */
export interface ListMembershipApi {
  containing(accountId: string): Promise<string[]>;
  add(listId: string, accountId: string): Promise<void>;
  remove(listId: string, accountId: string): Promise<void>;
}

/** Mastodon `replies_policy` values (`List` enum: `none|followed|list`).
 * Misskey-family lists have no equivalent. */
export type ListRepliesPolicy = "none" | "followed" | "list";

/** The optional list row fields (clickstone §1.6). Each one is sent only
 * when the caller chose it AND `capabilities.lists_replies_policy` /
 * `capabilities.lists_exclusive` is `supported` — an unsupported or
 * not-reported server never sees the field. */
export interface ListFields {
  repliesPolicy?: ListRepliesPolicy;
  /** Hide the list's members from the Home feed. */
  exclusive?: boolean;
}

export interface ListSummary {
  id: string;
  name: string;
  /** Current reply policy, when the server reports a known value (the
   * Mastodon family does; the Misskey family has none). */
  repliesPolicy?: ListRepliesPolicy;
  /** Current exclusive flag, when the server reports it. */
  exclusive?: boolean;
}

export interface ListsApi {
  /** Account membership editing; absent when the server cannot do it. */
  membership?: ListMembershipApi;
  list(): Promise<ListSummary[]>;
  /** `notes/user-list-timeline`. */
  timeline(listId: string, opts?: PageOpts): Promise<Page<Post>>;
  /** Create a list (addition — Misskey `lists/create`, Mastodon
   * `POST /api/v1/lists`). The Misskey family ignores `fields` (its
   * server has no such fields); the Mastodon family sends them behind the
   * capability gate. */
  create?(name: string, fields?: ListFields): Promise<ListSummary>;
  /** Rename a list and optionally set its extra fields (addition). */
  update?(id: string, patch: { name: string } & ListFields): Promise<ListSummary>;
  /** Delete a list (addition). */
  delete?(id: string): Promise<void>;
}

export interface ScheduledNote {
  id: string;
  scheduledAt: string;
  /** The post when the server packed one; else the draft payload. */
  post: Post | null;
  draft?: Record<string, unknown> | null;
}

export interface ScheduledApi {
  list(opts?: PageOpts): Promise<ScheduledNote[]>;
  create(draft: PostDraft & { scheduledAt: string }): Promise<ScheduledNote>;
  delete(id: string): Promise<void>;
}

export interface ServerDraft {
  id: string;
  text?: string | null;
  cw?: string | null;
  visibilityRaw?: string;
  visibleUserIds?: string[];
  localOnly?: boolean;
  mediaIds?: string[];
  replyId?: string | null;
  renoteId?: string | null;
  scheduledAt?: string | null;
  poll?: PollDraft;
}

export interface ServerDraftsApi {
  list(opts?: PageOpts): Promise<ServerDraft[]>;
  create(draft: PostDraft & { scheduledAt?: string | null }): Promise<ServerDraft>;
  update(id: string, draft: PostDraft & { scheduledAt?: string | null }): Promise<ServerDraft>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface BookmarksApi {
  /** `i/favorites` — favourite rows are (id, post) pairs; the row id is
   * the paging cursor. */
  list(opts?: PageOpts): Promise<Page<{ id: string; post: Post }>>;
  /** Bookmark a post (Misskey `notes/favorites/create`, Mastodon
   * `/bookmark`). Additive; the Phase-4 write path. */
  add(noteId: string): Promise<void>;
  remove(noteId: string): Promise<void>;
}

/** One matched keyword inside a server filter. Mastodon v2 filters are
 * GROUPS with several keywords; a v1 filter is a single keyword whose id
 * is the filter row's own id (the row and the keyword are one object). */
export interface FilterKeyword {
  id: string;
  keyword: string;
  wholeWord: boolean;
}

export interface Filter {
  id: string;
  /** Primary phrase (the first keyword) — the label the UI edits. */
  phrase: string;
  context: string[];
  expiresAt: string | null;
  irreversible: boolean;
  wholeWord: boolean;
  /** Every keyword in the group, in server order; never empty. A v1 row
   * is `[phrase]`, a v2 group keeps all of its keywords so an edit can
   * write them all back instead of dropping the rest. */
  keywords: FilterKeyword[];
}

export interface FiltersApi {
  list(): Promise<Filter[]>;
  create(phrase: string, context: string[], opts?: { expiresAt?: string | null; irreversible?: boolean; wholeWord?: boolean }): Promise<Filter>;
  /** Rewrites the primary phrase in place. Sibling keywords of a v2 group
   * keep their ids, text and whole-word flags — never dropped, never
   * reordered, never duplicated. */
  update(id: string, phrase: string, context: string[], opts?: { expiresAt?: string | null; irreversible?: boolean; wholeWord?: boolean }): Promise<Filter>;
  delete(id: string): Promise<void>;
}

/** One Misskey-family channel (group timeline). Only the fields the UI
 * can actually render from a packed `Channel`; unknown wire fields are
 * dropped rather than smuggled through. */
export interface Channel {
  id: string;
  name: string;
  description?: string | null;
  /** Banner image URL (the packed `bannerUrl`), when the channel has one. */
  bannerUrl?: string | null;
  /** Does the viewer follow this channel? null/absent means the server did
   * not report it (signed out, or a fork without the field) — never
   * fabricated as `false`. */
  isFollowing?: boolean | null;
  /** Archived channels are read-only and stay out of directory search; the
   * detail screen says so instead of hiding the feed. */
  isArchived?: boolean;
  usersCount?: number;
  notesCount?: number;
}

export interface ChannelListOpts extends PageOpts {
  /** Directory search text (`channels/search`). Empty = the whole
   * directory: the server skips the LIKE filter when the query is empty. */
  query?: string;
}

/** Channel timelines (addition — Misskey `channels/*`, clickstone §1.9).
 * The Mastodon family has no channels, so its backend leaves the member
 * undefined and `capabilities.channels` is `unsupported` — the UI shows an
 * honest unavailable state, never an empty feed. */
export interface ChannelsApi {
  /** Public directory (`channels/search`), newest first, paged. */
  list(opts?: ChannelListOpts): Promise<Page<Channel>>;
  /** One channel with the viewer's `isFollowing` when signed in
   * (`channels/show`). */
  show(channelId: string): Promise<Channel>;
  /** A channel's notes (`channels/timeline`). */
  notes(channelId: string, opts?: PageOpts): Promise<Page<Post>>;
  /** Channels the viewer follows (`channels/followed`, auth + read scope). */
  followed(opts?: PageOpts): Promise<Page<Channel>>;
  /** `channels/follow` (write:channels). */
  follow(channelId: string): Promise<void>;
  /** `channels/unfollow` (write:channels). */
  unfollow(channelId: string): Promise<void>;
}

/** One server announcement (Misskey-family notices). */
export interface Announcement {
  id: string;
  title: string;
  text: string;
  createdAt: string;
}

/** Server announcements (addition — Misskey `announcements`; read-only). */
export interface AnnouncementsApi {
  list(opts?: PageOpts): Promise<Announcement[]>;
}

// --- Hashtag follow / feature / mute (clickstone §1.4) ----------------------

/** One hashtag's server state (`GET /api/v1/tags/:id`). `following` and
 * `featuring` are null when the server did not report them (signed out, or
 * a fork that leaves the fields off) — never fabricated as `false`, so the
 * UI can tell "known off" from "unknown". */
export interface TagInfo {
  /** Display name as the server spells it, without a leading `#`. */
  name: string;
  /** Server-side tag URL when the payload carried one. */
  url: string | null;
  /** Does the viewer follow this tag? null = not reported. */
  following: boolean | null;
  /** Is this one of the viewer's featured (profile-pinned) tags?
   * null = not reported. */
  featuring: boolean | null;
}

/** One profile-pinned tag (`GET /api/v1/featured_tags`). The row id is what
 * `DELETE /api/v1/featured_tags/:id` takes; the word "pin" here means the
 * profile's featured tags, not a post pin. */
export interface FeaturedTag {
  id: string;
  name: string;
  /** Post count as the server counts it, or null when absent. */
  statusesCount: number | null;
  /** ISO day of the last post, or null. */
  lastStatusAt: string | null;
}

/**
 * Hashtag curation (clickstone §1.4). `follow`/`unfollow` exist on the
 * Mastodon family (vanilla + Akkoma, `/api/v1/tags/:id/follow`); the
 * `featured*` surface is vanilla-Mastodon-only — Akkoma/Pleroma have no
 * `/api/v1/featured_tags`, so those methods stay undefined there and the
 * UI renders a disabled row with the reason instead of hiding it.
 *
 * There is NO hashtag mute endpoint on either server (verified: vanilla
 * Mastodon's tag routes expose show/follow/unfollow/feature/unfeature only;
 * Akkoma's `TagController` adds no mute). A tag mute is therefore never
 * faked here — the UI documents the gap.
 */
export interface TagsApi {
  /** `GET /api/v1/tags/:id` — the follow/feature state. Optional so a
   * fork that cannot answer leaves the row in the honest unknown state. */
  show?(name: string): Promise<TagInfo>;
  follow(name: string): Promise<void>;
  unfollow(name: string): Promise<void>;
  /** Followed tags, newest-first Link paging (`GET /api/v1/followed_tags`). */
  followed(opts?: PageOpts): Promise<Page<TagInfo>>;
  /** Profile-pinned tags (`GET /api/v1/featured_tags`). Undefined on
   * forks without the endpoint. */
  featured?(): Promise<FeaturedTag[]>;
  /** Pin/unpin by tag name (`POST /api/v1/tags/:id/feature|unfeature`,
   * with the older `/api/v1/featured_tags` calls as a 404/405 fallback).
   * Undefined on forks without featured tags. */
  feature?(name: string): Promise<void>;
  unfeature?(name: string): Promise<void>;
  /** `DELETE /api/v1/featured_tags/:id` — the row-id form. Undefined on
   * forks without featured tags. */
  deleteFeatured?(id: string): Promise<void>;
}

/**
 * Personal domain blocks (`/api/v1/domain_blocks`, clickstone §1.4):
 * the domains THIS account blocks, not the instance's admin-level blocks.
 * Every MastoAPI server here serves the personal trio; a fork answering
 * 404/405 leaves this module undefined and the UI shows a disabled row.
 */
export interface DomainBlocksApi {
  /** The blocked domains, Link-paged (server caps at 100/page). */
  list(opts?: PageOpts): Promise<Page<string>>;
  /** Block a domain for this account (`POST {domain}`). */
  block(domain: string): Promise<void>;
  /** Unblock (`DELETE` with the domain in the query, as the web client
   * sends it; never elsewhere in the path). */
  unblock(domain: string): Promise<void>;
}

/**
 * Canonicalizes what a user typed into a domain block into the bare host
 * the server stores: trims, drops a pasted `https://` scheme (and anything
 * after the first `/`), strips a leading `@`/`acct@` form, lowercases, and
 * drops a trailing dot. Returns "" for input that is not a plausible host,
 * so callers can refuse instead of sending garbage.
 */
export function normalizeDomainBlock(input: string): string {
  let value = input.trim().toLowerCase();
  if (value.length === 0) return "";
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const slash = value.indexOf("/");
  if (slash !== -1) value = value.slice(0, slash);
  const at = value.lastIndexOf("@");
  if (at !== -1) value = value.slice(at + 1);
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return "";
  }
  return value;
}

// --- The Backend interface -------------------------------------------------

// --- Reports (clickstone §1.5) ---------------------------------------------

/** The categories the Mastodon report chooser offers (`Report` enum:
 * `spam`/`legal`/`violation`/`other`). Mastodon's web client also shows a
 * "dislike" option, but it only thanks the reporter and files nothing —
 * never sent here. The wire values are strings; the server maps them to
 * integers. */
export type ReportCategory = "spam" | "legal" | "violation" | "other";

/** The chooser's payload: every field is optional because only what the
 * reporter actually chose is sent. An absent field means "server default",
 * never an empty array or a false flag. */
export interface ReportOptions {
  /** Reporter's note (Mastodon optional; Misskey REQUIRES it). */
  comment?: string;
  /** Posts backing the report (`status_ids[]`). */
  statusIds?: readonly string[];
  /** Reason category (Mastodon family only). */
  category?: ReportCategory;
  /** Server rules the report violates (`rule_ids[]`; Mastodon family only;
   * the server forces category `violation` when these are present). */
  ruleIds?: readonly string[];
  /** Forward a copy to the account's home server (Mastodon family only;
   * meaningful only for a REMOTE account). */
  forward?: boolean;
}

/** One chooser field a family cannot express, with the honest reason the
 * UI shows. Reporters are never told a field was used when it was not. */
export interface ReportUnsupportedField {
  field: "statusIds" | "category" | "ruleIds" | "forward";
  reason: string;
}

/** What the backend actually sent (normalized, so the caller can render an
 * honest confirmation instead of assuming the chooser was honoured). */
export interface ReportResult {
  comment: string;
  statusIds: string[];
  category: ReportCategory | null;
  ruleIds: string[];
  forward: boolean;
  unsupported: ReportUnsupportedField[];
}

/** One server rule (`GET /api/v1/instance/rules` row). */
export interface InstanceRule {
  id: string;
  text: string;
}

/** Stable order for the UI's category chooser (labels live in the app). */
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "spam",
  "legal",
  "violation",
  "other",
];

/**
 * Normalize caller input into the shape a backend reports back: trimmed
 * comment, deduped non-empty ids, known category only. Pure, shared by both
 * families so "what was sent" means the same thing everywhere.
 */
export function normalizeReportOptions(options: ReportOptions | string = {}): ReportOptions {
  const raw: ReportOptions = typeof options === "string" ? { comment: options } : options;
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  const ids = (values: readonly string[] | undefined): string[] => {
    const out: string[] = [];
    for (const value of values ?? []) {
      const id = typeof value === "string" ? value.trim() : "";
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  const statusIds = ids(raw.statusIds);
  const ruleIds = ids(raw.ruleIds);
  const category =
    raw.category && REPORT_CATEGORIES.includes(raw.category) ? raw.category : null;
  return {
    ...(comment ? { comment } : {}),
    ...(statusIds.length ? { statusIds } : {}),
    ...(ruleIds.length ? { ruleIds } : {}),
    ...(category ? { category } : {}),
    ...(raw.forward === true ? { forward: true } : {}),
  };
}

/** Outcome for a backend that cannot carry the fields it was given. */
export function reportUnsupported(field: ReportUnsupportedField["field"], reason: string): ReportUnsupportedField {
  return { field, reason };
}

export interface Backend {
  /** The family this backend speaks (plan §2: one implementation per
   * family). UI gates on it for family-only services (soft-mute lists,
   * drive) — never on wire shapes. */
  readonly family: ServerFamily;
  readonly capabilities: Capabilities;

  // --- Feeds and posts (plan §2.2) ---
  timeline(kind: TimelineKind, opts?: PageOpts): Promise<Page<Post>>;
  post(id: string): Promise<Post>;
  /** Ancestors of a reply, oldest-first + the incomplete flag. Plan §2.2
   * writes `thread(id)`; this takes the already-loaded post so the chain
   * walk and the packed-parent fallback (servers without
   * `notes/conversation`) need no refetch — exactly today's behaviour. */
  thread(post: Post): Promise<{ ancestors: Post[]; incomplete: boolean }>;
  /** Direct replies page (addition — today's app pages `notes/replies`). */
  threadReplies(id: string, opts?: PageOpts): Promise<Page<Post>>;
  /** Accounts that reposted/boosted a note (addition — the detail
   * "Reposts" tab). Misskey family: derived from `notes/renotes`
   * (one active renote per account, server order); Mastodon family:
   * `reblogged_by`. */
  reposts(id: string, opts?: PageOpts): Promise<Page<Account>>;
  /** Who reacted to a note with what (addition — the detail "Reactions"
   * tab, Misskey `notes/reactions`). Misskey family only; the Mastodon
   * backend answers the honest unsupported state. */
  noteReactions(
    id: string,
    opts?: PageOpts & { reaction?: string },
  ): Promise<Page<NoteReactionRow>>;
  createPost(draft: PostDraft): Promise<Post>;
  /** Delete one post. `keepMedia` asks the server to keep the attachments
   * alive after the post is gone so a redraft can reattach them (Mastodon:
   * `DELETE …?delete_media=false`; the Misskey family never deletes Drive
   * files with a note, so the flag is a documented no-op there). The UI's
   * delete-and-redraft flow always passes it; a plain delete omits it. */
  deletePost(id: string, opts?: { keepMedia?: boolean }): Promise<void>;
  editPost(id: string, draft: PostDraft): Promise<Post>;
  /** One post's revision history (clickstone §1.7), NEWEST-FIRST with the
   * original snapshot last (`PostRevision.original`). Optional: absent on a
   * family with no history endpoint (the Misskey family), where the UI
   * keeps the Edited badge non-interactive instead of faking a history. A
   * 404/405 from a fork surfaces as the typed unsupported `ApiError`. */
  editHistory?(id: string): Promise<PostRevision[]>;
  /** React with `reaction`, or clear with null (set-semantics). */
  react(id: string, reaction: string | null): Promise<void>;
  unreact(id: string): Promise<void>;
  /**
   * Like shortcut (`POST notes/like`, Sharkey-family only). The server
   * toggles: one call likes or unlikes. `override: null` takes the
   * server's `defaultLike`. Throws `LikeUnsupportedError` where the
   * endpoint is absent — the caller falls back to a plain heart
   * reaction, never a "not supported" wall. Absent outside
   * Misskey-family (check before calling).
   */
  like?: {
    like(noteId: string, override?: string | null): Promise<void>;
    /** Endpoint presence: true/false, or null when unprobed. */
    isSupported(): boolean | null;
  };
  favourite(id: string): Promise<void>;
  unfavourite(id: string): Promise<void>;
  boost(id: string): Promise<Post>;
  unboost(id: string): Promise<void>;
  /** Vote in a poll (addition — the app renders polls). */
  votePoll(id: string, choices: number[]): Promise<void>;
  /** Resolve a textual `RE:` quote URI to the post it names (addition —
   * Phase 3, plan item 4). Misskey family: the authed `ap/show` lookup;
   * Mastodon family: `/api/v2/search` with `resolve`. Null when it does
   * not resolve (deleted/hidden/search-restricted) — the caller keeps the
   * raw `RE:` text, never a wrong card. */
  resolveQuoteUri(uri: string): Promise<Post | null>;
  /** Server-featured notes (`notes/featured`) (addition). */
  featuredPosts(opts?: PageOpts): Promise<Page<Post>>;
  /** One account's featured/pinned notes (`users/featured-notes`) (addition). */
  accountFeaturedPosts(id: string, opts?: PageOpts): Promise<Page<Post>>;

  // --- Accounts (plan §2.2 `account(id|acct)`, `accountPosts`) ---
  me(): Promise<Account>;
  account(ref: { id?: string; username?: string; host?: string | null }): Promise<Account>;
  accountPosts(id: string, opts?: AccountPostsOpts): Promise<Page<Post>>;
  /** `users/followers` / `users/following` (addition — the follow lists). */
  followers(id: string, opts?: PageOpts): Promise<Page<Account>>;
  following(id: string, opts?: PageOpts): Promise<Page<Account>>;
  relationships(ids: string[]): Promise<Relationship[]>;
  /** `following/create|delete` return a UserLite, not a relationship —
   * callers re-read `relationships`/`account` for the new state (today's
   * behaviour), so these return nothing. */
  follow(id: string): Promise<void>;
  unfollow(id: string): Promise<void>;
  /** One account's reactions (`users/reactions`): the reaction key + the
   * reacted post. `post` is null when the server hides it (the UI says
   * "a note you cannot see" — never faked). */
  accountReactions(
    id: string,
    opts?: PageOpts,
  ): Promise<Page<UserReaction>>;
  /** Pin/unpin a post on the viewer's profile (addition — `i/pin`). */
  pinPost(id: string): Promise<void>;
  unpinPost(id: string): Promise<void>;
  followRequests(opts?: PageOpts): Promise<FollowRequest[]>;
  acceptFollowRequest(id: string): Promise<void>;
  rejectFollowRequest(id: string): Promise<void>;
  /** Cancel an outgoing pending request (addition). */
  cancelFollowRequest(id: string): Promise<void>;
  updateProfile(patch: ProfileUpdate): Promise<Account>;
  /**
   * Replace one profile image (clickstone §1.8). Both families support it,
   * by different wires: the Mastodon family sends the file as a multipart
   * `PATCH /api/v1/accounts/update_credentials` (`avatar` / `header`), the
   * Misskey family uploads the file to Drive (`drive/files/create`) and
   * writes the returned id through `i/update` (`avatarId` / `bannerId`).
   * The file never becomes a JSON body and a Misskey Drive id never reaches
   * the Mastodon family. The server's refreshed self account is returned —
   * callers show its URL, never an optimistic local guess.
   *
   * Optional like every capability-gated member: a family (or fork) with no
   * image endpoint leaves it undefined and the editor disables the row WITH
   * a reason. Present on both shipped families.
   */
  uploadProfileImage?(kind: ProfileImageKind, file: File): Promise<Account>;

  // --- Mutes and blocks (plan §2.2) ---
  mutes(opts?: PageOpts): Promise<Page<Account>>;
  blocks(opts?: PageOpts): Promise<Page<Account>>;
  mute(id: string): Promise<void>;
  unmute(id: string): Promise<void>;
  muteRenotes(id: string): Promise<void>;
  unmuteRenotes(id: string): Promise<void>;
  /** Accounts the viewer renote-mutes (addition — the listing behind the
   * mute list; without it the row cannot show state). */
  renoteMutes?(opts?: PageOpts): Promise<Page<Account>>;
  block(id: string): Promise<void>;
  unblock(id: string): Promise<void>;
  /** Mute one post's thread (addition — `notes/thread-muting/create`). */
  muteThread(noteId: string): Promise<void>;
  /** Report an account with the chooser's fields (clickstone §1.5). Each
   * family sends only the fields it supports: Mastodon `POST
   * /api/v1/reports` (comment/status_ids/category/rule_ids/forward),
   * Misskey `users/report-abuse` (comment only, REQUIRED by the server).
   * The result states what was actually sent, so an option a family cannot
   * express is never silently dropped. A bare string stays accepted as the
   * comment-only shorthand (pre-chooser call shape). */
  reportAccount(id: string, options?: ReportOptions | string): Promise<ReportResult>;
  /** The server's rule list for the report chooser (`GET
   * /api/v1/instance/rules`). Optional: absent when the family has no such
   * endpoint (Misskey), and a 404/405 from a fork surfaces as the honest
   * unsupported state — the sheet hides the rules step with a reason,
   * never an error. */
  instanceRules?(): Promise<InstanceRule[]>;

  // --- Search (plan §2.2) ---
  search: {
    posts(query: string, opts?: SearchPostsOpts): Promise<Page<Post>>;
    tags(tag: string, opts?: PageOpts): Promise<Page<Post>>;
    accounts(query: string, opts?: PageOpts): Promise<Page<Account>>;
    /** `#` autocomplete: tag-name candidates for a prefix. Undefined
     * when the server offers no tag search (no popup, never an error). */
    suggestTags?(query: string, opts?: PageOpts): Promise<string[]>;
    /** `@` autocomplete: account candidates for a prefix. Undefined
     * when unavailable; auth failures stay auth failures. */
    suggestAccounts?(query: string, opts?: PageOpts): Promise<Page<Account>>;
  };

  // --- Notifications (plan §2.2) ---
  notifications(opts?: NotificationsOpts): Promise<Page<Notification>>;
  markNotificationsRead(): Promise<void>;
  /** Dismiss ONE notification (`POST /api/v1/notifications/:id/dismiss` on
   * the Mastodon family; clickstone §1.11). Optional: absent where the
   * family has no per-row dismiss (Misskey), and a 404/405 from a fork
   * surfaces as the typed unsupported `ApiError` instead of a throw-wall —
   * the UI hides the action with a reason, never an error. */
  dismissNotification?(id: string): Promise<void>;
  /** Clear EVERY notification (`POST /api/v1/notifications/clear` on the
   * Mastodon family). Optional for the same reason as `dismissNotification`;
   * destructive, so the UI always confirms first. */
  clearNotifications?(): Promise<void>;

  // --- Server services (plan §2.2) ---
  customEmojis(): Promise<CustomEmoji[]>;
  uploadMedia(file: File, opts?: UploadMediaOpts): Promise<Media>;
  /** Edit an uploaded attachment's description (alt text) — and, on the
   * Mastodon family, its crop focus. Returns the server's media row.
   * Optional: absent where the family has no endpoint, which leaves the
   * composer's alt field locked with an honest reason. */
  updateMedia?(id: string, patch: MediaUpdate): Promise<Media>;
  /** Translate one post's text to the viewer's language (`notes/translate`
   * takes the note id; the server derives the source). */
  translate(id: string, targetLang: string): Promise<Translation>;
  stream(): StreamHandle | null;

  // --- Capability-gated sub-modules (plan §2.2) ---
  drive?: DriveApi;
  antennas?: AntennasApi;
  clips?: ClipsApi;
  lists?: ListsApi;
  channels?: ChannelsApi;
  announcements?: AnnouncementsApi;
  scheduled?: ScheduledApi;
  serverDrafts?: ServerDraftsApi;
  bookmarks?: BookmarksApi;
  filters?: FiltersApi;
  /** Explore-page trending content (both families implement it; backends
   * without the endpoints leave it undefined and the page degrades to
   * search-only with honest unavailable states). */
  explore?: ExploreApi;
  /** Hashtag follow/feature curation (Mastodon family; clickstone §1.4).
   * Undefined on the Misskey family, which has no tag-follow endpoint. */
  tags?: TagsApi;
  /** Personal domain blocks (Mastodon family; clickstone §1.4). Undefined
   * where the server has no `/api/v1/domain_blocks`. */
  domainBlocks?: DomainBlocksApi;
}
