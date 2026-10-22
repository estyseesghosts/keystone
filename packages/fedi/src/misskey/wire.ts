// Wire types for the Keystone API targets (Pinetree + Misskey/Sharkey,
// all Misskey-compatible JSON POST at /api/{endpoint}, camelCase fields).
// The shared endpoints used by Keystone behave the same across backends;
// see docs/api-surface.md for the verified compatibility matrix.
//
// Pure-TS rule: no locale framework here. Label maps keep their English
// fallback strings plus stable key codes (plain `string`) the UI resolves
// at render time.

export interface UserLite {
  id: string;
  name: string | null;
  username: string;
  host: string | null;
  avatarUrl: string | null;
  avatarBlurhash: string | null;
  isBot: boolean;
  isCat: boolean;
  emojis: Record<string, string>;
  onlineStatus: string;
}

export interface UserDetailed extends UserLite {
  url: string | null;
  uri: string | null;
  createdAt: string;
  updatedAt: string;
  lastFetchedAt: string | null;
  bannerUrl: string | null;
  bannerBlurhash: string | null;
  isLocked: boolean;
  isSilenced: boolean;
  isSuspended: boolean;
  description: string | null;
  location: string | null;
  birthday: string | null;
  followersCount: number;
  followingCount: number;
  notesCount: number;
  isFollowing?: boolean;
  isFollowed?: boolean;
  /** Present when the caller is authenticated. Distinguishes an accepted
   * follow from a pending request on locked accounts: never infer
   * acceptance from a successful following/create alone. */
  hasPendingFollowRequestFromYou?: boolean;
  hasPendingFollowRequestToYou?: boolean;
  /** Follower/following list visibility (Misskey-family; absent on older
   * servers and Pinetree until its slice lands): `public` (default),
   * `followers` (followers only), `private` (owner only). Absent means
   * unknown — the list UI renders without a privacy gate. */
  ffVisibility?: "public" | "followers" | "private" | null;
  /** Pinned notes (Misskey-family; absent until the backend packs them —
   * the Featured tab ships absent, never faked). */
  pinnedNoteIds?: string[] | null;
  pinnedNotes?: Note[] | null;
}

export interface MeDetailed extends UserDetailed {
  [key: string]: unknown;
}

export interface DriveFile {
  id: string;
  createdAt: string;
  name: string;
  type: string;
  md5: string;
  size: number;
  isSensitive: boolean;
  blurhash: string | null;
  properties: Record<string, unknown>;
  url: string;
  thumbnailUrl: string | null;
  comment: string | null;
  folderId: string | null;
  userId: string | null;
}

/** Packed Misskey drive folder (`drive/folders/*` responses). `parentId`
 * is null at the drive root; only id/name/parentId surface in core. */
export interface DriveFolder {
  id: string;
  createdAt: string;
  name: string;
  parentId: string | null;
}

export type NoteVisibility = "public" | "home" | "followers" | "specified";

export interface PollChoice {
  text: string;
  votes: number;
  isVoted: boolean;
}

export interface Poll {
  multiple: boolean;
  expiresAt: string | null;
  expiredAfter: number | null;
  choices: PollChoice[];
}

export interface Note {
  id: string;
  createdAt: string;
  userId: string;
  user: UserLite;
  text: string | null;
  cw: string | null;
  visibility: NoteVisibility;
  localOnly: boolean;
  reactionAcceptance: string | null;
  renoteCount: number;
  repliesCount: number;
  reactionCount: number;
  reactions: Record<string, number>;
  reactionEmojis: Record<string, string>;
  fileIds: string[];
  files: DriveFile[];
  replyId: string | null;
  renoteId: string | null;
  reply: Note | null;
  renote: Note | null;
  /** Canonical ActivityPub identifiers packed by Misskey-family servers.
   * Used only to recognize a duplicate textual `RE:` suffix of the
   * structured quote target — never fetched directly. */
  uri?: string | null;
  url?: string | null;
  /** Pinetree-only quote extensions (absent on Misskey/Sharkey).
   * `quoteTargetUri` preserves a safe-to-disclose target URI when the
   * target itself is unresolved; `quoteTargetUnavailable` signals the
   * relationship exists but its target cannot safely be exposed.
   * `quoteAuthorizationStatus` is display metadata only and never gates
   * rendering — a missing status is normal, not a rejection. */
  quoteTargetUri?: string | null;
  quoteTargetUnavailable?: boolean | null;
  quoteAuthorizationStatus?: string | null;
  /** Present on notes that carry a poll (Misskey-family; Pinetree rejects
   * polls at create time, so this stays null there). */
  poll: Poll | null;
  mentions: string[];
  visibleUserIds?: string[];
  tags: string[];
  emojis: Record<string, string>;
  myReaction: string | null;
  /** Sharkey packs the last edit time here (`Note.updatedAt` is set by
   * `NoteEditService`); upstream Misskey sends no field at all. Read as
   * `Post.editedAt` — absent means "not edited, or this server does not
   * say", never a guess. */
  updatedAt?: string | null;
}

export interface CreatedNoteResponse {
  createdNote: Note;
}

export interface SigninResponse {
  id: string;
  token: string;
  i: string;
  user: MeDetailed;
}

export interface PinetreeNotification {
  id: string;
  createdAt: string;
  type: string;
  /** Pinetree packs `isRead`; Misskey/Sharkey omit it. */
  isRead?: boolean;
  userId?: string;
  user: UserLite | null;
  note: Note | null;
  reaction?: string | null;
  /** `roleAssigned` packs the granted role (upstream `Notification`
   * schema); `user` is absent on these system rows. */
  role?: {id: string; name?: string | null; iconUrl?: string | null} | null;
  /** `achievementEarned`: the achievement token verbatim. */
  achievement?: string;
  /** `exportCompleted`: which entity was exported and the Drive file. */
  exportedEntity?: string;
  fileId?: string;
  /** `scheduledNotePostFailed`: the draft the server kept. */
  noteDraft?: {id?: string} | null;
  /** `chatRoomInvitationReceived` (not mapped until chat ships). */
  invitation?: {room?: {id?: string; name?: string | null} | null} | null;
}

/** Preferred alias: the same shape is served by all three backends
 * (modulo the optional Pinetree-only `isRead`). */
export type NotificationItem = PinetreeNotification;

export interface CreateNoteParams {
  text?: string | null;
  cw?: string | null;
  visibility?: NoteVisibility;
  visibleUserIds?: string[];
  replyId?: string;
  renoteId?: string;
  localOnly?: boolean;
  fileIds?: string[];
  /** Per-note reaction visibility (Misskey-family; omitted when null).
   * Server errors surface verbatim; 404 means the backend does not
   * store it yet and the picker stays hidden. */
  reactionAcceptance?: ReactionAcceptance | null;
  /** Per-note quote refusal (Sharkey `noQuote`; omitted when false).
   * 404 means unsupported — the toggle stays hidden. */
  noQuote?: boolean;
  poll?: {
    choices: string[];
    multiple?: boolean;
    expiredAfter?: number;
    expiresAt?: number;
  } | null;
}

/** Per-note reaction visibility (Misskey `reactionAcceptance`).
 * `null` (default) means all reactions allowed. */
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

/** i18n keys for the per-note reaction visibility options, resolved at
 * render time by the UI. The English `LABELS` object above stays as the
 * fallback. */
export const REACTION_ACCEPTANCE_LABEL_KEYS: Record<ReactionAcceptance, string> = {
  likeOnly: "reaction.likeOnly",
  likeOnlyForRemote: "reaction.likeOnlyRemote",
  nonSensitiveOnly: "reaction.nonSensitiveOnly",
  nonSensitiveOnlyForLocalLikeOnlyForRemote: "reaction.nonSensitiveLocal",
};

export function reactionAcceptanceLabel(value: string | null): string | null {
  if (value == null) return null;
  return (REACTION_ACCEPTANCE_LABELS as Record<string, string>)[value] ?? value;
}

/** Relation of the viewer to one user (`users/relation`). All flags
 * optional — absent means unknown (relation endpoint unsupported). */
export interface UserRelation {
  id: string;
  isFollowing?: boolean;
  isFollowed?: boolean;
  isBlocking?: boolean;
  isBlocked?: boolean;
  isMuted?: boolean;
  isRenoteMuted?: boolean;
}

/** Full `i/update` profile payload (§1). Every field optional: the editor
 * sends only fields the user touched, the server trims/empties. Client
 * validates lengths only; server errors show verbatim. Fields the backend
 * rejects (400 unknown / 404) are left out of the form until it accepts
 * them — never sent blind on retry. */
export interface ProfileUpdateParams {
  name?: string | null;
  description?: string | null;
  location?: string | null;
  birthday?: string | null;
  isLocked?: boolean;
  isBot?: boolean;
  followedMessage?: string | null;
  lang?: string | null;
  avatarId?: string | null;
  bannerId?: string | null;
  avatarDecorations?: Array<{ id?: string; angle?: number; flipH?: boolean; url?: string }>;
  hideOnlineStatus?: boolean;
  publicReactions?: boolean;
  carefulBot?: boolean;
  autoAcceptFollowed?: boolean;
  followApprovalRequired?: boolean;
  followApprovalBeforeSeconds?: number | null;
  followApprovalAutoExpirationSeconds?: number | null;
  noCrawle?: boolean;
  preventAiLearning?: boolean;
  requireSigninToViewContents?: boolean;
  requireSigninToViewContentsOfCutContent?: boolean;
  makeNotesFollowersOnlyBefore?: number | null;
  makeNotesHiddenBefore?: number | null;
  injectFeaturedNote?: boolean;
  receiveAnnouncementEmail?: boolean;
  alwaysMarkNsfw?: boolean;
  autoSensitive?: boolean;
  chatScope?: string | null;
  pinnedPageId?: string | null;
  mutedWords?: Array<string | string[]>;
  hardMutedWords?: Array<string | string[]>;
  mutedInstances?: string[] | null;
  notificationRecieveConfig?: Record<string, unknown>;
  emailNotificationTypes?: string[];
  alsoKnownAs?: string[] | null;
  /** Sharkey quote refusal (account-wide). Absent/404 = unsupported. */
  rejectQuotes?: boolean;
}

/** Field spec for the grown profile editor: key + label + kind drive the
 * shared renderer so the 30+ field form stays declarative. */
export interface ProfileFieldSpec {
  key: keyof ProfileUpdateParams;
  label: string;
  hint?: string;
  kind: "text" | "textarea" | "boolean" | "number-nullable" | "list" | "word-groups";
}

/** Scheduled note (`notes/schedule/*`). `scheduledAt` is an ISO string;
 * `isActuallyScheduled` mirrors the backend's draft-vs-scheduled flag. */
export interface ScheduledNote {
  id: string;
  scheduledAt: string;
  note?: Note | null;
  draft?: Record<string, unknown> | null;
}

/** Server draft (`notes/drafts/*`). Shape mirrors `notes/create` params
 * plus the draft id; the local store stays as the offline cache. */
export interface ServerDraft {
  id: string;
  text?: string | null;
  cw?: string | null;
  visibility?: NoteVisibility;
  visibleUserIds?: string[];
  localOnly?: boolean;
  fileIds?: string[];
  replyId?: string | null;
  renoteId?: string | null;
  scheduledAt?: string | null;
  poll?: CreateNoteParams["poll"];
}

/** Grouped notification rows (`i/notifications-grouped`). Flat items keep
 * the `NotificationItem` shape; grouped rows aggregate one actor set. */
export interface GroupedReaction {
  userId: string;
  reaction: string;
}

export interface GroupedNotificationItem {
  id: string;
  createdAt: string;
  type: string;
  note?: Note | null;
  user?: UserLite | null;
  users?: UserLite[];
  reactions?: GroupedReaction[];
  userIds?: string[];
}

/** Notification type filter presets (maps to includeTypes/excludeTypes —
 * no second list UI; blacklist = mutes, whitelist = followingOrFollower
 * scoping, mutuals = mutualFollow, followed = following). `label` is the
 * English fallback; `labelKey` is what the UI resolves at render time
 * (`i18n.t(labelKey)`) — the wire `includeTypes`/`excludeTypes` tokens are
 * unaffected. */
export const NOTIFICATION_FILTER_PRESETS: Array<{
  id: string;
  label: string;
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

export type AntennaSrc = "home" | "all" | "users" | "users_blacklist" | "list";

export interface Antenna {
  id: string;
  name: string;
  src: AntennaSrc;
  userListId: string | null;
  /** Keyword groups, verified against Misskey AntennaService: each inner
   * array is an AND-group, groups are ORed (`some(and => and.every(...))`),
   * matched against text+CW (case-insensitive unless caseSensitive).
   * Keystone preserves the nested shape and never flattens it. */
  keywords: string[][];
  excludeKeywords: string[][];
  users: string[];
  caseSensitive: boolean;
  localOnly: boolean;
  excludeBots: boolean;
  withReplies: boolean;
  withFile: boolean;
}

export interface FollowRequest {
  id: string;
  follower: UserLite;
  followee: UserLite;
}

export function handleOf(user: Pick<UserLite, "username" | "host">): string {
  return user.host ? `@${user.username}@${user.host}` : `@${user.username}`;
}

/** Mirror of Misskey `is-renote.ts` (packed-note variants): a pure renote
 * (repost) carries `renoteId` with no own content — no text, CW, reply,
 * poll, or files. Anything else with `renoteId` is a quote: its own note
 * with an embedded original. */
export function isPureRenote(note: Note): boolean {
  return (
    note.renoteId != null &&
    note.text == null &&
    note.cw == null &&
    note.replyId == null &&
    note.poll == null &&
    note.fileIds.length === 0
  );
}

/** The note whose content and actions apply: the renoted original for a
 * pure repost, the note itself otherwise (a quote is its own note — the
 * server rejects renoting or replying to a pure-renote wrapper, so every
 * action must target the original). Falls back to the wrapper when the
 * original is unavailable (deleted/invisible). */
export function appearNoteOf(note: Note): Note {
  return isPureRenote(note) && note.renote ? note.renote : note;
}

export interface CollapsedFeed {
  /** Item ids with a visible row. */
  reps: Set<string>;
  /** Representative wrapper id -> aggregated renoters (feed order). */
  renotersByRep: Map<string, UserLite[]>;
}

/** Collapse pure reposts in a feed: an original plus its reposts shows
 * only the first repost (input order), with renoters aggregated for the
 * banner. Quotes never collapse — they carry their own commentary.
 * Grouping is by effective target (a wrapper's `renoteId`, which survives
 * even a deleted/unpacked original; otherwise the item's own id). Pure:
 * returns fresh sets/maps, never mutates the input. */
export function collapseReposts(items: Note[]): CollapsedFeed {
  const groups = new Map<
    string,
    { rep: string; repIsWrapper: boolean; users: UserLite[]; userIds: Set<string> }
  >();
  for (const n of items) {
    if (isPureRenote(n)) {
      const key = n.renoteId ?? n.id;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          rep: n.id,
          repIsWrapper: true,
          users: [n.user],
          userIds: new Set([n.user.id]),
        });
      } else {
        // The first repost displaces a previously seen original.
        if (!g.repIsWrapper) {
          g.rep = n.id;
          g.repIsWrapper = true;
        }
        if (!g.userIds.has(n.user.id)) {
          g.userIds.add(n.user.id);
          g.users.push(n.user);
        }
      }
    } else if (!groups.has(n.id)) {
      groups.set(n.id, {
        rep: n.id,
        repIsWrapper: false,
        users: [],
        userIds: new Set(),
      });
    }
  }
  const reps = new Set<string>();
  const renotersByRep = new Map<string, UserLite[]>();
  for (const g of groups.values()) {
    reps.add(g.rep);
    if (g.repIsWrapper) renotersByRep.set(g.rep, g.users);
  }
  return { reps, renotersByRep };
}

export function displayNameOf(user: Pick<UserLite, "name" | "username">): string {
  return user.name && user.name.length > 0 ? user.name : user.username;
}

/** True when the profile carries a real display name — not empty, and not
 * just the username/handle echoed back (`pndc`, `@pndc`,
 * `@pndc@host` all count as absent). Pure. */
export function hasRealDisplayName(
  user: Pick<UserLite, "name" | "username" | "host">,
): boolean {
  const raw = (user.name ?? "").trim();
  if (raw.length === 0) return false;
  const low = raw.replace(/^@+/, "").toLowerCase();
  if (low === user.username.toLowerCase()) return false;
  const full = user.host ? `${user.username}@${user.host}` : user.username;
  if (low === full.toLowerCase()) return false;
  return true;
}

/** Head-line name: the display name when real, else the whole handle
 * (`@pndc@host`) — never a bare `@pndc` stuttering next to a duplicate
 * handle span. Callers hide the handle span when this falls back. Pure. */
export function headNameOf(
  user: Pick<UserLite, "name" | "username" | "host">,
): string {
  return hasRealDisplayName(user) ? displayNameOf(user) : handleOf(user);
}

/** Local end-state of setting one reaction: removes the previous entry
 * (if any) and adds the new one, adjusting the total. Pure — feeds apply
 * it optimistically, then reconcile with the server response. */
export function withReaction(note: Note, reaction: string | null): Note {
  if (note.myReaction === reaction) return note;
  const reactions = { ...note.reactions };
  let reactionCount = note.reactionCount;
  if (note.myReaction) {
    const left = (reactions[note.myReaction] ?? 1) - 1;
    if (left <= 0) delete reactions[note.myReaction];
    else reactions[note.myReaction] = left;
    reactionCount -= 1;
  }
  if (reaction) {
    reactions[reaction] = (reactions[reaction] ?? 0) + 1;
    reactionCount += 1;
  }
  return {
    ...note,
    myReaction: reaction,
    reactions,
    reactionCount: Math.max(0, reactionCount),
  };
}

// --- Server insight (Wave 3, clickstone §3.1 — read-only) -------------------
//
// Wire shapes for the four Misskey-family admin reads, verified against the
// local Misskey + Sharkey + Catodon checkouts (endpoint files, not prose).
// Field names are exact wire spellings (camelCase); every field is optional
// + unknown-typed here so fork drift degrades in the adapter, never at the
// type boundary.

/** `admin/server-info` row (moderator role, `read:admin:server-info`):
 * machine/os/node/psql strings, `cpu{model,cores}`, byte-count `mem` /
 * `fs`, and `net{interface}`. */
export interface AdminServerInfo {
  machine?: unknown;
  os?: unknown;
  node?: unknown;
  psql?: unknown;
  cpu?: unknown;
  mem?: unknown;
  fs?: unknown;
  net?: unknown;
}

/** `admin/meta` row (admin role, `read:admin:meta`): the full instance
 * settings object (133 properties upstream, including server secrets).
 * Only the display/policy subset is named here — the adapter reads exactly
 * these and drops the rest, so secrets can never cross into the UI. */
export interface AdminMeta {
  name?: unknown;
  shortName?: unknown;
  description?: unknown;
  maintainerName?: unknown;
  maintainerEmail?: unknown;
  version?: unknown;
  uri?: unknown;
  disableRegistration?: unknown;
  emailRequiredForSignup?: unknown;
  [key: string]: unknown;
}

/** `admin/queue/stats` row (moderator role, `read:admin:queue`): one
 * BullMQ `getJobCounts()` object per queue (`waiting/active/completed/
 * failed/delayed/paused`, all numbers). */
export interface AdminQueueStats {
  deliver?: unknown;
  inbox?: unknown;
  db?: unknown;
  objectStorage?: unknown;
}

/** `get-online-users-count` row (public, no credential): `{count}`. */
export interface OnlineUsersCount {
  count?: unknown;
}

// --- Reports queue (Wave 3, clickstone §3.2) ---------------------------------
//
// Wire shape of one `admin/abuse-user-reports` row (moderator role,
// `read:admin:abuse-user-reports`; verified in the local Misskey +
// Sharkey + Catodon checkouts). Field names are exact wire spellings
// (camelCase); every field is optional + unknown-typed here so fork
// drift degrades in the adapter, never at the type boundary.
// `reporter`/`targetUser`/`assignee` pack `UserDetailedNotMe` rows;
// `assignee` is null when unassigned. `resolvedAs` is `accept`/`reject`
// when the moderator recorded a verdict (`update`/`resolve` pack it),
// null otherwise. `moderationNote` is the moderator's private note
// (empty string when none — never null upstream, but read tolerantly).

export interface AbuseUserReport {
  id?: unknown;
  createdAt?: unknown;
  comment?: unknown;
  resolved?: unknown;
  reporterId?: unknown;
  targetUserId?: unknown;
  assigneeId?: unknown;
  reporter?: unknown;
  targetUser?: unknown;
  assignee?: unknown;
  forwarded?: unknown;
  resolvedAs?: unknown;
  moderationNote?: unknown;
}
