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
 * the family's notification type strings; the adapter sends them
 * verbatim. */
export const NOTIFICATION_FILTER_PRESETS: Array<{
  id: string;
  label: string;
  /** Label-key code the UI resolves at render time. */
  labelKey: string;
  includeTypes?: string[];
  excludeTypes?: string[];
}> = [
  { id: "all", label: "All", labelKey: "notif.filterAll" },
  { id: "mentions", label: "Mentions", labelKey: "notif.filterMentions", includeTypes: ["mention", "reply"] },
  { id: "reactions", label: "Reactions", labelKey: "notif.filterReactions", includeTypes: ["reaction"] },
  { id: "reposts", label: "Reposts", labelKey: "notif.filterReposts", includeTypes: ["renote", "quote"] },
  { id: "follows", label: "Follows", labelKey: "notif.filterFollows", includeTypes: ["follow", "receiveFollowRequest", "followRequestAccepted"] },
  { id: "polls", label: "Polls", labelKey: "notif.filterPolls", includeTypes: ["pollVote", "pollEnded"] },
];

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
 * unsupported); `antennaId`/`listId`/`tag`/`clipId` are the named feeds.
 * Tag feeds ride `search.tags` on both families; lists ride
 * `lists.timeline` on both families (Misskey `notes/user-list-timeline`,
 * Mastodon `/timelines/list/:id`); clips ride `clips/notes`
 * (Misskey-family only, no live channel — paging + refresh). */
export type FeedSource = { kind: TimelineKind } | { antennaId: string } | { listId: string } | { tag: string } | { clipId: string };

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

export interface ListsApi {
  /** Account membership editing; absent when the server cannot do it. */
  membership?: ListMembershipApi;
  list(): Promise<Array<{ id: string; name: string }>>;
  /** `notes/user-list-timeline`. */
  timeline(listId: string, opts?: PageOpts): Promise<Page<Post>>;
  /** Create a list (addition — Misskey `lists/create`, Mastodon
   * `POST /api/v1/lists`). */
  create?(name: string): Promise<{ id: string; name: string }>;
  /** Rename a list (addition). */
  update?(id: string, patch: { name: string }): Promise<{ id: string; name: string }>;
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

/** One Misskey-family channel (group timeline). */
export interface Channel {
  id: string;
  name: string;
  description?: string | null;
}

/** Channel timelines (addition — Misskey `channels/*`; the browser UI
 * lands in a later slice). */
export interface ChannelsApi {
  list(opts?: PageOpts): Promise<Page<Channel>>;
  /** A channel's notes (`channels/timeline`). */
  notes(channelId: string, opts?: PageOpts): Promise<Page<Post>>;
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

// --- The Backend interface -------------------------------------------------

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
  deletePost(id: string): Promise<void>;
  editPost(id: string, draft: PostDraft): Promise<Post>;
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
  /** Report an account (addition — `users/report-abuse`). */
  reportAccount(id: string, comment: string): Promise<void>;

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

  // --- Server services (plan §2.2) ---
  customEmojis(): Promise<CustomEmoji[]>;
  uploadMedia(file: File, opts?: UploadMediaOpts): Promise<Media>;
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
}
