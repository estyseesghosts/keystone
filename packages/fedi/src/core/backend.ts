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
  Content,
  Cursor,
  Media,
  Notification,
  Page,
  Poll,
  Post,
  PostRevision,
  Relationship,
  VisibilityKind,
} from "./models";
import type { AdminInsightApi } from "./adminInsight";
import type {
  InstanceRule,
  ReportOptions,
  ReportResult,
  ReportsQueueApi,
} from "./reportsQueue";
import type { TransferApi } from "./transfer";
import type { Capabilities, ServerFamily } from "./detect";

// i18n note: this module carries no locale framework (pure-TS rule). UI
// strings below are English fallback data plus stable label-key codes
// (plain `string`, resolved by the UI via its own catalog).

// --- Pagination ------------------------------------------------------------

export interface PageOpts {
  cursor?: Cursor | null;
  limit?: number;
  /** Caller cancellation (repair X3.1): react-query's `signal` threads
   * down to the transport, which aborts the fetch. Reads abort; mutations
   * never take a signal (unmount must not cancel a write). */
  signal?: AbortSignal;
}

/** Cancellation-only opts for single-shot reads (`post`, `account`,
 * `thread`, `relationships`, `me` — repair X3.1). Paged reads carry the
 * same field on `PageOpts`; mutations never take it. */
export interface SignalOpts {
  signal?: AbortSignal;
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
 * sending a null/empty value. `signal` aborts the upload (repair X3.1:
 * explicit Cancel only — unmount never cancels a write). */
export interface UploadMediaOpts {
  isSensitive?: boolean;
  comment?: string;
  folderId?: string | null;
  force?: boolean;
  signal?: AbortSignal;
  /** Byte progress for multipart uploads (repair X7.4): called with bytes
   * sent and the total when known (null when the transport cannot know
   * it — e.g. chunked fetch on native). Transports that cannot observe
   * bytes never call it; the UI then shows an honest indeterminate state.
   * Never throws (a throwing listener must not fail the upload). */
  onProgress?: UploadProgress;
  /** Injectable multipart sender (repair X7.4): the app provides the
   * web XHR sender (byte progress via `upload.onprogress`) per call; the
   * transports default to fetch (no byte events). Pure function type —
   * `packages/fedi` never names `XMLHttpRequest` itself. */
  uploadImpl?: UploadRequestImpl;
}

/** React Native upload reference (repair X7.4): native uploads append the
 * `{uri, name, type}` FormData form (no whole-file `fetch(uri).blob()`
 * into JS memory). `size` carries the picker's byte count when known
 * (null/unknown leaves the verdict to the server); the upload deadline
 * scales from it (see `uploadTimeoutForBytes`). Plain data — pure TS. */
export interface UploadFileRef {
  uri: string;
  name: string;
  type: string;
  size?: number | null;
}

/** True for a native `{uri, name, type}` reference (as opposed to a web
 * `File`). Duck-typed on `uri` so Hermes (which may lack the `File`
 * global) never needs an `instanceof` check. Pure. */
export function isUploadFileRef(file: File | UploadFileRef): file is UploadFileRef {
  return (
    typeof file === "object" &&
    file !== null &&
    typeof (file as { uri?: unknown }).uri === "string"
  );
}

/** Byte size of an upload source, or null when unknown (native reference
 * without a count). Unknown sizes are never blocked client-side — the
 * server stays the verdict. Pure. */
export function uploadSizeOf(file: File | UploadFileRef): number | null {
  if (isUploadFileRef(file)) {
    return typeof file.size === "number" && Number.isFinite(file.size) && file.size > 0
      ? file.size
      : null;
  }
  return typeof file.size === "number" && Number.isFinite(file.size) && file.size > 0
    ? file.size
    : null;
}

/** Size-scaled multipart deadline (repair X7.4, networking M8): min 60 s,
 * +30 s per 10 MB (rounded up, so a small photo still gets 90 s of
 * headroom), max 15 min. Unknown sizes take the 60 s floor. Pure. */
export function uploadTimeoutForBytes(size: number | null | undefined): number {
  const MIN_MS = 60_000;
  const STEP_MS = 30_000;
  const STEP_BYTES = 10 * 1024 * 1024;
  const MAX_MS = 15 * 60_000;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return MIN_MS;
  return Math.min(MAX_MS, MIN_MS + Math.ceil(size / STEP_BYTES) * STEP_MS);
}

/** Byte-progress callback: bytes sent + total (null when unknowable). */
export type UploadProgress = (loaded: number, total: number | null) => void;

/** One multipart request, as the injectable sender sees it. The transport
 * owns auth headers, the URL, and the deadline/stall timers; the sender
 * only moves the bytes, reports progress, and honours `signal`. Pure. */
export interface UploadRequestOpts {
  url: string;
  method: "POST" | "PATCH";
  headers: Record<string, string>;
  body: FormData;
  signal?: AbortSignal;
  timeoutMs: number;
  onProgress?: UploadProgress;
}

/** What the injectable sender answers: HTTP status, the raw body text
 * (the transport parses it), and the final URL when the sender follows
 * redirects itself (XHR always does) so the transport can refuse a
 * cross-origin hop with credentials. Pure. */
export interface UploadRequestResult {
  status: number;
  bodyText: string;
  responseUrl?: string;
}

/** Injectable multipart sender (see `UploadMediaOpts.uploadImpl`). */
export type UploadRequestImpl = (req: UploadRequestOpts) => Promise<UploadRequestResult>;

/** Append an upload source to multipart form data under `field`: a native
 * reference goes on as `{uri, name, type}` (never read into JS), a web
 * `File` as-is with its name. Pure. */
export function appendUploadFile(
  form: FormData,
  field: string,
  file: File | UploadFileRef,
  fallbackName: string,
): void {
  if (isUploadFileRef(file)) {
    form.append(field, {
      uri: file.uri,
      name: file.name || fallbackName,
      type: file.type,
    } as unknown as Blob);
    return;
  }
  form.append(field, file, file.name || fallbackName);
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
  /** Mastodon-family status-level sensitivity (repair X4.4 finding 11):
   * marks every attached medium sensitive (`POST /api/v1/statuses`
   * `sensitive`). Sent only when a boolean (absent keeps the server
   * default). The composer toggle is X6.2. */
  sensitive?: boolean;
  /** Mastodon-family post language (repair X4.4 finding 11: `language`).
   * Sent only when a non-empty string. The composer picker is X6.2. */
  language?: string;
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

// --- Recommendations (fork `notes/recommendations`, dvd-sharkey) --------

/**
 * Recommendation feed options. `offset` pages the server-maintained
 * relevance queue (not an id cursor); `refresh` forces a re-rank.
 * `lang` is the viewer's UI language; `withSensitive`/`withRenotes`
 * mirror the NSFW and show-boosts prefs.
 */
export interface RecommendationFeedOpts extends PageOpts {
  lang?: string;
  withSensitive?: boolean;
  withRenotes?: boolean;
  offset?: number;
  refresh?: boolean;
}

export interface RecommendationDwellItem {
  noteId: string;
  dwellMs: number;
}

export interface RecommendationInterests {
  interested: string[];
  disinterested: string[];
}

/**
 * Recommendation settings patch (`i/update {recommendationSettings}`).
 * Every field optional; absent fields keep the server value.
 */
export interface RecommendationSettingsPatch {
  enabled?: boolean;
  recommendNsfw?: boolean;
  factors?: Partial<Record<string, number>>;
  engagement?: Partial<Record<string, number>>;
  interestTopics?: string[];
  disinterestTopics?: string[];
  languages?: string[];
  followedRatio?: number;
}

/**
 * Fork recommendation surface (dvd-sharkey `notes/recommendations*`,
 * `i/recommendation-interests`, `i/update {recommendationSettings}`).
 *
 * Optional like every capability-gated member: the Misskey family
 * provides it; the Mastodon family leaves it undefined. A Misskey-family
 * server WITHOUT the fork endpoints answers 404/405 — the UI treats
 * that as "not on this server" (the tab hides), never an error page.
 * Support is probed once per origin and cached; a flavor label never
 * proves absence (a backport may add the endpoints).
 */
export interface RecommendationsApi {
  /** The recommendation queue, offset-paged (limit default 10). */
  feed(opts?: RecommendationFeedOpts): Promise<Page<Post>>;
  /** Visible-time report (best-effort impression log). Batched to 50/call. */
  dwell(items: RecommendationDwellItem[]): Promise<void>;
  /** Explicit "not interested" (strong negative + hide). */
  notInterested(noteId: string): Promise<void>;
  /** The recommender's current interest overlay (activity-derived + saved). */
  interests(): Promise<RecommendationInterests>;
  /** Save settings (`i/update`); answers the refreshed viewer account. */
  updateSettings(patch: RecommendationSettingsPatch): Promise<Account>;
  /** Endpoint presence by origin: true/false, or null when unprobed. */
  isSupported(): boolean | null;
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

// --- Filtered notification requests (Mastodon 4.3+, repair X4.5) ----------
//
// Mastodon 4.3+ files notifications from filtered accounts under "requests"
// instead of the main list. The domain rows are deliberately thin: the
// request carries who asked (null when the server packed no usable
// account — never an invented profile); the policy carries the four
// server-side filter switches plus the pending counters the entry badge
// reads. A null switch/count means the server did not say — the UI
// disables that row with a reason instead of guessing, and `updatePolicy`
// never sends it back.

/** One row of the filtered-notifications inbox. */
export interface NotificationRequest {
  id: string;
  /** Server timestamp when sent; null when the server omitted it. */
  createdAt: string | null;
  /** The requesting account; null when unpacked/unusable. */
  account: Account | null;
}

/** The viewer's notification filter policy. */
export interface NotificationPolicy {
  filterNotFollowing: boolean | null;
  filterNotFollowers: boolean | null;
  filterNewAccounts: boolean | null;
  filterPrivateMentions: boolean | null;
  pendingRequestsCount: number | null;
  pendingNotificationsCount: number | null;
}

/** Policy update: only defined fields are sent (never a guessed switch). */
export interface NotificationPolicyPatch {
  filterNotFollowing?: boolean;
  filterNotFollowers?: boolean;
  filterNewAccounts?: boolean;
  filterPrivateMentions?: boolean;
}

/**
 * Filtered-notifications inbox + filter policy (Mastodon 4.3+).
 *
 * Optional like every capability-gated member: present on the
 * Mastodon-family backend (every flavor — the probe decides, never the
 * flavor label), absent on the Misskey family (no such endpoints). A
 * server without the routes answers 404/405 and the member reports the
 * honest unsupported verdict — the UI hides the entry with a reason,
 * never an error wall. Support is probed once per origin and cached; a
 * flavor label never proves absence (a backport may add the endpoints).
 */
export interface NotificationRequestsApi {
  /** One inbox page, newest first (Link-paged, same end rule as feeds). */
  list(opts?: PageOpts): Promise<Page<NotificationRequest>>;
  /** Merge one request into the main notifications. */
  accept(id: string): Promise<void>;
  /** Drop one request. */
  dismiss(id: string): Promise<void>;
  /** The current filter policy (this call also probes support). */
  policy(opts?: SignalOpts): Promise<NotificationPolicy>;
  /** Save policy switches; answers the server's stored policy. */
  updatePolicy(patch: NotificationPolicyPatch): Promise<NotificationPolicy>;
  /** Endpoint presence by origin: true/false, or null when unprobed. */
  isSupported(): boolean | null;
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

/** Live chat handlers (Misskey family, P6.2 clickstone §2.2). `message`
 * carries the adapted chat message (any lite pack); `deleted` carries
 * the removed message id so the caller drops the row. Reaction deltas
 * (`react`/`unreact`) are not surfaced — the open thread refetches them. */
export interface ChatStreamHandlers {
  onMessage?: (message: ChatMessage) => void;
  onDeleted?: (id: string) => void;
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
  /** Live chat for one room (Misskey family ONLY — the `chatRoom`
   * stream channel, `read:chat`). Undefined on the Mastodon family and
   * everywhere the chat endpoints are absent: the thread screens page +
   * refresh without it. */
  subscribeChatRoom?(roomId: string, handlers: ChatStreamHandlers): () => void;
  /** Live 1-on-1 chat with one user (Misskey `chatUser` channel,
   * params `{otherId}`). Same absence rule as `subscribeChatRoom`. */
  subscribeChatUser?(userId: string, handlers: ChatStreamHandlers): () => void;
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

/** Drive sort orders (`drive/files` `sort`, newer upstream; absent on
 * Sharkey/older Misskey — never sent when the `drive_sort` probe says
 * unsupported). */
export type DriveSort =
  | "+createdAt"
  | "-createdAt"
  | "+name"
  | "-name"
  | "+size"
  | "-size";

export interface DriveApi {
  /** List files (newest-first cursor paging). `type` is the server-side
   * MIME filter the category views page on. `folderId` scopes the listing
   * to one folder; omitted (or null) means the Drive root — the same
   * default the server takes when the field is absent, so it is never put
   * on the wire for root. `sort` is sent only when the `drive_sort`
   * probe verdict for the origin is not `false`. */
  files(
    opts?: PageOpts & { type?: string; folderId?: string | null; sort?: DriveSort },
  ): Promise<Page<Media>>;
  /** Storage usage (`drive`, `{capacity, usage}` bytes). */
  usage(): Promise<{ capacity: number; usage: number }>;
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
  /** Move files (`drive/files/move-bulk`, newer upstream) with fallback to
   * per-file `updateFile` when the `drive_move_bulk` probe says
   * unsupported (plan DC-7; the member is always present so callers never
   * branch — the fallback is inside). */
  moveMany(fileIds: string[], folderId: string | null): Promise<void>;
  /** Probe verdict accessors (the `like.ts` pattern): true/false, or null
   * when unprobed. The UI gates sort UI and bulk paths on these. */
  isSortSupported(): boolean | null;
  isMoveBulkSupported(): boolean | null;
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

/** One drive folder path element (root → self) with sibling counts. */
export interface DriveFolderDetail {
  folder: DriveFolder;
  /** Ancestor chain, root first, self last (partial when a parent 404s). */
  path: DriveFolder[];
  /** Packed counts when the server sends them, else null (the UI walks
   * the tree for exact counts when it needs them). */
  filesCount: number | null;
  foldersCount: number | null;
}

/** Drive-folder management (addition — optional like every gated
 * sub-module; backends without the endpoints leave it undefined). */
export interface DriveFoldersApi {
  /** List one level (B2: `parentId` scopes; null = root) with paging. */
  list(opts: { parentId: string | null } & PageOpts): Promise<Page<DriveFolder>>;
  /** One folder with `detail: true` (parent chain + counts) for
   * breadcrumbs and the delete confirm (DC-9). */
  show(id: string): Promise<DriveFolderDetail>;
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
  /** `lastClippedAt` when packed (owner views). */
  lastClippedAt?: string | null;
  createdAt?: string | null;
  /** Packed author (owner views); null for others' clips. */
  owner?: Account | null;
  /** True when the viewer owns the clip. */
  isOwn?: boolean;
}

export interface ClipsApi {
  /** Own clips, paged (B3: no silent 100-cap). */
  list(opts?: PageOpts): Promise<Page<ClipSummary>>;
  /** One clip (`clips/show`); null when missing (the screen renders the
   * honest not-found state instead of crashing on `list().find`). */
  show(id: string): Promise<ClipSummary | null>;
  addNote(clipId: string, noteId: string): Promise<void>;
  removeNote(clipId: string, noteId: string): Promise<void>;
  create(
    name: string,
    opts?: { isPublic?: boolean; description?: string | null },
  ): Promise<ClipSummary>;
  /** Full body (DC-6/B1): all of `name`, `isPublic`, `description` —
   * the server wipes omitted fields (`description || null`). */
  update(
    clipId: string,
    patch: { name: string; isPublic: boolean; description: string | null },
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

/** Misskey-family announcement severity (`icon` in the packed row). */
export type AnnouncementIcon = "info" | "warning" | "error" | "success";

/**
 * One server announcement (clickstone §1.12).
 *
 * The two families publish notices in different shapes and the model keeps
 * only what the UI can render honestly:
 * - the Misskey family sends `title` + MFM `text` + `imageUrl` + `icon` and,
 *   when signed in, `isRead`;
 * - Mastodon sends HTML `content` only — no title and no severity — and a
 *   `read` flag only for an authenticated request.
 *
 * `content` is the family's SOURCE (MFM or server HTML), parsed through the
 * one allow-listed AST at render time; no raw server string ever reaches
 * the UI as markup. `isRead` is `null` when the server did not report it
 * (signed out, or a fork without the field) — never fabricated as `false`.
 */
export interface Announcement {
  id: string;
  /** Misskey sends one; Mastodon announcements have none (`null`). */
  title: string | null;
  /** Body source: `mfm` on the Misskey family, `html` on Mastodon. */
  content: Content;
  /** Publication time as the server reports it (Mastodon `published_at`). */
  createdAt: string;
  updatedAt: string | null;
  /** Misskey `imageUrl`; `null` when the notice has no image. */
  imageUrl: string | null;
  /** Misskey severity; `null` on Mastodon (which has no such field). */
  icon: AnnouncementIcon | null;
  /** Misskey `needConfirmationToRead`: stays unread until dismissed. */
  needConfirmationToRead: boolean;
  /** Mastodon window (`starts_at`/`ends_at`/`all_day`); null/false where
   * the family has no such fields. */
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  /** Has the viewer read/dismissed this one? null = not reported. */
  isRead: boolean | null;
}

/**
 * Server announcements (clickstone §1.12 — read + dismiss).
 *
 * Both families serve a read path and a per-row dismiss:
 * - Misskey family: public `POST /api/announcements` (paged
 *   `limit`/`sinceId`/`untilId`, `isActive` defaults to true) and
 *   `POST /api/i/read-announcement {announcementId}` — the endpoint the
 *   reference client calls, replacing the older `announcements/dismiss`
 *   name this slice was scoped against (verified in the local checkout).
 * - Mastodon family: `GET /api/v1/announcements` (auth-required on vanilla)
 *   and `POST /api/v1/announcements/:id/dismiss` (`write:accounts`); both
 *   Akkoma and Pleroma serve the same routes.
 *
 * `dismiss` stays optional: a fork without the endpoint leaves it undefined,
 * and a 404/405 from a fork that claims it surfaces as the typed
 * unsupported `ApiError` (the UI disables the action with a reason — never
 * an error page, never an inert button).
 */
export interface AnnouncementsApi {
  /** Server announcements in server order. `limit` caps the request on the
   * Misskey family; Mastodon answers its whole published list (it has no
   * cursor), so callers must not infer "more" from a full page. */
  list(opts?: PageOpts): Promise<Announcement[]>;
  /** Mark one announcement read (Misskey) / dismissed (Mastodon). */
  dismiss?(id: string): Promise<void>;
}

// --- Split modules (repair D3.2 — re-exported so no importer changes) ---------
export * from "./adminInsight";
export * from "./reportsQueue";
export * from "./transfer";

// --- Direct messages (P6.2, clickstone §2.1) -------------------------------

/**
 * One DM inbox row (both Mastodon-family servers pack the same four
 * keys — Mastodon `REST::ConversationSerializer`, Akkoma
 * `participation.json`).
 *
 * Only the fields the thread view can render honestly:
 * - `accounts` are the OTHER participants (the viewer's own row is never
 *   in the list — both servers exclude it, except a self-only thread),
 *   adapted like any other accounts;
 * - `lastPost` is the conversation's latest post, or null when the
 *   server sent none (never a fabricated placeholder);
 * - `unread` is the server's own flag, never derived client-side.
 */
export interface Conversation {
  id: string;
  accounts: Account[];
  lastPost: Post | null;
  unread: boolean;
}

/**
 * The DM inbox (P6.2 — Mastodon family only; Misskey chat is slice 2.2).
 *
 * Replies reuse the existing status-post path (`createPost` with
 * `visibility: direct` + `in_reply_to_id`) — there is deliberately no
 * compose method here, and the composer already sends direct+recipients.
 * History for a thread comes from `thread(lastPost)` (the DM chain is a
 * reply chain), not from a statuses endpoint neither server exposes on
 * `/api/v1`.
 */
export interface ConversationsApi {
  /** The inbox, newest first, Link-paged (contract §5 end rule). */
  list(opts?: PageOpts): Promise<Page<Conversation>>;
  /** One inbox row by id (a terminating inbox scan — neither server has
   * a show route). A scan miss reads like any other absent row (the
   * typed 404 the UI renders as unavailable, never a crash). */
  get(id: string): Promise<Conversation>;
  /** Leave a conversation (`DELETE /api/v1/conversations/:id`). */
  delete(id: string): Promise<void>;
  /** Mark a conversation read (`POST .../:id/read`); answers the
   * updated row so the caller mirrors the server flag, never a guess. */
  markRead(id: string): Promise<Conversation>;
}

// --- Misskey chat (P6.2, clickstone §2.2) ----------------------------------

/**
 * One Misskey chat message — room or 1-on-1 (upstream `ChatMessage` /
 * `ChatMessageLite*` packs, `ChatEntityService`).
 *
 * Only the fields every surface can render honestly:
 * - `text` is the message body (null when file-only — never an empty
 *   placeholder);
 * - `fromAccount` is the sender ONLY when the server packed one (room
 *   timelines + detailed packs do; the 1-on-1 lite deliberately packs no
 *   users, so it stays null and the UI resolves the id against the
 *   session/participants — never an invented account);
 * - `reactions` keep `{reaction, accountId}` (a null accountId means the
 *   server omitted the reactor — the count stays honest without naming);
 * - `file` is the Drive attachment when the message carries one;
 * - `read` is the `chat/history` overview flag; timelines mark read on
 *   fetch and omit it (null = "not reported here", never "unread").
 */
export interface ChatMessage {
  id: string;
  createdAt: string;
  text: string | null;
  fromAccountId: string;
  fromAccount: Account | null;
  /** 1-on-1 counterpart (null on room messages). */
  toUserId: string | null;
  /** Room target (null on 1-on-1 messages). */
  toRoomId: string | null;
  fileId: string | null;
  file: Media | null;
  reactions: Array<{ reaction: string; accountId: string | null }>;
  read: boolean | null;
}

/**
 * One Misskey chat room (upstream packed `ChatRoom`).
 *
 * `owner` is null only when the server did not pack one; `isMuted` is
 * null for the owner view (the server reports it for members only) —
 * never fabricated as `false`, so the UI can tell "known off" from
 * "unknown".
 */
export interface ChatRoom {
  id: string;
  createdAt: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: Account | null;
  isMuted: boolean | null;
}

/**
 * One room membership (upstream `packRoomMembership`).
 *
 * `chat/rooms/joining` (the room list) populates `room`, not `user`;
 * `chat/rooms/members` (a follow-up slice) populates the reverse. The
 * unpopulated side stays null — never an invented row.
 */
export interface ChatRoomMembership {
  id: string;
  createdAt: string;
  userId: string;
  user: Account | null;
  roomId: string;
  room: ChatRoom | null;
}

/**
 * Misskey-family chat (P6.2, clickstone §2.2) — rooms + 1-on-1 threads.
 *
 * Deliberately NOT folded into `ConversationsApi`: the shapes genuinely
 * differ. Conversations are inbox rows (`{participants, lastPost,
 * unread}`) whose threads are reply chains; chat has rooms with an
 * owner/member/invitation lifecycle, two server-paged timelines (room +
 * 1-on-1), per-message reactions and Drive files, and server-side read
 * markers (`chat/history` `isRead`, auto-mark on timeline fetch,
 * `chat/read-all`). Forcing rooms into `Conversation` would drop the
 * lifecycle and fake threads the server already pages properly.
 *
 * Out of scope (follow-up slices): members/invitations inbox/join/leave,
 * room update/delete/mute, message search, message reactions UI.
 */
export interface ChatApi {
  /** Rooms the viewer joined (`chat/rooms/joining`), newest membership
   * first, cursor-paged both ways. */
  rooms(opts?: PageOpts): Promise<Page<ChatRoomMembership>>;
  /** The overview (`chat/history`): latest message per counterpart.
   * `rooms: true` scopes to rooms, `false` (default) to 1-on-1.
   * Limit-only (the server offers no cursor) — callers refetch. */
  history(opts?: { limit?: number; rooms?: boolean }): Promise<ChatMessage[]>;
  /** One room (`chat/rooms/show`). A 404 reads as no-such-room (or no
   * access) — the typed unsupported error the UI renders as unavailable. */
  showRoom(roomId: string): Promise<ChatRoom>;
  /** Create a room (`chat/rooms/create`). Answers the packed room. */
  createRoom(name: string, opts?: { description?: string | null }): Promise<ChatRoom>;
  /** One room's messages (`chat/messages/room-timeline`), cursor-paged
   * both ways. Fetching marks the room read server-side. */
  roomMessages(roomId: string, opts?: PageOpts): Promise<Page<ChatMessage>>;
  /** One 1-on-1 thread (`chat/messages/user-timeline`), cursor-paged
   * both ways. Fetching marks the thread read server-side. */
  userMessages(userId: string, opts?: PageOpts): Promise<Page<ChatMessage>>;
  /** One message, detailed (`chat/messages/show`). */
  showMessage(messageId: string): Promise<ChatMessage>;
  /** Send to a room (`chat/messages/create-to-room`). Text or file —
   * both absent throws before any network I/O. */
  sendToRoom(roomId: string, text?: string | null, opts?: { fileId?: string | null }): Promise<ChatMessage>;
  /** Send to a user (`chat/messages/create-to-user`). Same text-or-file
   * rule; the server refuses self-sends. */
  sendToUser(userId: string, text?: string | null, opts?: { fileId?: string | null }): Promise<ChatMessage>;
  /** Delete an own message (`chat/messages/delete`). */
  deleteMessage(messageId: string): Promise<void>;
  /** Mark every chat read (`chat/read-all`). The per-thread mark is the
   * timeline fetch itself; this is the sweep. */
  readAll(): Promise<void>;
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

export interface Backend {
  /** The family this backend speaks (plan §2: one implementation per
   * family). UI gates on it for family-only services (soft-mute lists,
   * drive) — never on wire shapes. */
  readonly family: ServerFamily;
  readonly capabilities: Capabilities;

  // --- Feeds and posts (plan §2.2) ---
  timeline(kind: TimelineKind, opts?: PageOpts): Promise<Page<Post>>;
  post(id: string, opts?: SignalOpts): Promise<Post>;
  /** Ancestors of a reply, oldest-first + the incomplete flag. Plan §2.2
   * writes `thread(id)`; this takes the already-loaded post so the chain
   * walk and the packed-parent fallback (servers without
   * `notes/conversation`) need no refetch — exactly today's behaviour. */
  thread(post: Post, opts?: SignalOpts): Promise<{ ancestors: Post[]; incomplete: boolean }>;
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
  /** Vote in a poll (addition — the app renders polls).
   *
   * `id` is the post/note id; `poll` is the already-loaded `Post.poll`
   * (ADR 0010 — never refetched). The Mastodon family votes the poll id
   * straight from the model: a null/missing `poll?.id` throws the typed
   * `errors.shape.noPoll` with zero requests (callers holding a bare
   * status id with no loaded poll get that honest error, never a
   * transparent refetch). The Misskey family keys on the note id — a
   * present poll's null id never blocks it — but an explicit null `poll`
   * (voting with no poll at all) is the same typed error with no request
   * on both families. Omit `poll` only from legacy two-arg callers. */
  votePoll(id: string, choices: number[], poll?: Poll | null): Promise<void>;
  /** Resolve a textual `RE:` quote URI to the post it names (addition —
   * Phase 3, plan item 4). Misskey family: the authed `ap/show` lookup;
   * Mastodon family: `/api/v2/search` with `resolve`. Null when it does
   * not resolve (deleted/hidden/search-restricted) — the caller keeps the
   * raw `RE:` text, never a wrong card. */
  resolveQuoteUri(uri: string): Promise<Post | null>;
  /** Seed the session quote cache with an already-rendered note
   * (addition — R2.4/D3.6 restoration of the R1.2-removed seen
   * optimization, now session-scoped). A seeded note is one the session
   * already rendered, so serving it later reveals nothing new (same or
   * stricter visibility). Optional: backends without a seen set omit it
   * and the UI skips seeding. Never crosses sessions. */
  seedSeenQuote?(note: Post): void;
  /** Server-featured notes (`notes/featured`) (addition). */
  featuredPosts(opts?: PageOpts): Promise<Page<Post>>;
  /** One account's featured/pinned notes (`users/featured-notes`) (addition). */
  accountFeaturedPosts(id: string, opts?: PageOpts): Promise<Page<Post>>;

  // --- Accounts (plan §2.2 `account(id|acct)`, `accountPosts`) ---
  me(opts?: SignalOpts): Promise<Account>;
  account(ref: { id?: string; username?: string; host?: string | null }, opts?: SignalOpts): Promise<Account>;
  accountPosts(id: string, opts?: AccountPostsOpts): Promise<Page<Post>>;
  /** `users/followers` / `users/following` (addition — the follow lists). */
  followers(id: string, opts?: PageOpts): Promise<Page<Account>>;
  following(id: string, opts?: PageOpts): Promise<Page<Account>>;
  relationships(ids: string[], opts?: SignalOpts): Promise<Relationship[]>;
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
  uploadProfileImage?(kind: ProfileImageKind, file: File | UploadFileRef): Promise<Account>;

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
  /** Authoritative unread count. Optional: servers without a count source
   * leave it off and the UI falls back to a presence dot. Throws a typed
   * unsupported `ApiError` when the endpoint is absent on this server. */
  notificationsUnreadCount?(opts?: SignalOpts): Promise<number>;
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
  /** Filtered-notifications inbox + filter policy (Mastodon 4.3+,
   * repair X4.5). Optional: present on the Mastodon-family backend, absent
   * on the Misskey family (no such endpoints) — the UI hides the surface
   * with a reason, never an error wall. Support is probed per origin
   * (`isSupported()`), never flavor-guessed. */
  notificationRequests?: NotificationRequestsApi;

  // --- Server services (plan §2.2) ---
  customEmojis(): Promise<CustomEmoji[]>;
  uploadMedia(file: File | UploadFileRef, opts?: UploadMediaOpts): Promise<Media>;
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
  /** Read-only server insight (Wave 3 slice 3.1 — no mutations).
   * Undefined where the family has no insight endpoints (the Misskey
   * family — its admin reads are a later slice) — the UI hides the
   * surface, never an empty screen. */
  adminInsight?: AdminInsightApi;
  /** Moderation reports queue (Wave 3 slice 3.2 — list + confirm-gated
   * mutations). Undefined where the family has no queue endpoints — the
   * UI hides the surface, never an empty list. */
  reportsQueue?: ReportsQueueApi;
  /** DM inbox (P6.2, Mastodon family only). Undefined where the flavor
   * has no conversations endpoint (or it is unverified) and everywhere
   * on the Misskey family — the UI shows the honest unavailable state,
   * never an empty inbox. */
  conversations?: ConversationsApi;
  /** Misskey-family chat: rooms + 1-on-1 threads (P6.2, clickstone
   * §2.2). Undefined where the flavor has no (or unverified) `chat/*`
   * endpoints and everywhere on the Mastodon family — same honest
   * unavailable state, never an empty room list. */
  chat?: ChatApi;
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
  /** Fork recommendation feed (dvd-sharkey `notes/recommendations*`).
   * Misskey family only; undefined on the Mastodon family. A
   * Misskey-family server without the fork endpoints keeps the member
   * but answers 404/405 — the UI hides the tab, never an error. */
  recommendations?: RecommendationsApi;
  /** Personal domain blocks (Mastodon family; clickstone §1.4). Undefined
   * where the server has no `/api/v1/domain_blocks`. */
  domainBlocks?: DomainBlocksApi;
  /** Account data import/export (clickstone §2.3). Undefined where the
   * family has no import/export API (the Mastodon family) — the UI
   * disables those rows with a reason, never faked. */
  transfer?: TransferApi;
}
