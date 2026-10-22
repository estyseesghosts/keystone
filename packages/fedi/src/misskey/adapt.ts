// Misskey-family wire → core model mappings (plan §3 Phase 2 item 3).
// This is the ONLY place that reads wire field names: every Note, User,
// DriveFile and NotificationItem becomes a `core/models.ts` value here.
//
// Mapping table (wire → core), for the Phase 2 UI migration:
//   Note.text              -> Post.content.mfm (absent when null; plain derived)
//   Note.cw                -> Post.cw
//   Note.visibility        -> Post.visibility.raw (+ kind; `home` reads `quiet`)
//   Note.localOnly         -> Post.visibility.localOnly
//   Note.renoteCount       -> Post.counts.boosts
//   Note.repliesCount      -> Post.counts.replies
//   Note.reactionCount     -> Post.reactions.total
//   Note.reactions         -> Post.reactions.entries (order preserved)
//   Note.reactionEmojis    -> Post.reactions.urls
//   Note.myReaction        -> Post.reactions.mine (+ ext.myReactionPacked)
//   Note.files / fileIds   -> Post.media / Post.mediaIds
//   Note.reply / replyId   -> Post.reply / Post.replyToId
//   Note.renote / renoteId -> Post.renote / Post.renoteId
//   Note.quoteTarget*      -> Post.ext.quoteTarget* (+ quoteUnavailable)
//   Note.reactionAcceptance-> Post.ext.reactionAcceptance
//   User.name/username/host-> Account.name/username/host (+ acct, displayName)
//   User.description       -> Account.bio (MFM)
//   User.bannerUrl         -> Account.headerUrl
//   User.notesCount        -> Account.statusesCount
//   DriveFile.*            -> Media.* (properties -> meta verbatim)
//   DriveFolder.*          -> core DriveFolder (id/name/parentId only)
//   NotificationItem.type  -> Notification.kind (+ rawType verbatim)
//
// Discipline: unknown wire values are never rounded up (visibility, kind
// enums fall back to the most restrictive / "unknown"); fields the server
// does not send stay null/absent and are never faked.

import type {
  Account,
  AccountFieldModel,
  Content,
  Cursor,
  Media,
  MediaKind,
  Notification,
  NotificationActor,
  NotificationExt,
  Page,
  Poll,
  Post,
  ReactionEntry,
  ReactionSummary,
  Relationship,
} from "../core/models";
import {
  plainFromMfm,
  visibilityOf,
} from "../core/models";
import type {
  FollowRequest as CoreFollowRequest,
  DriveFolder as CoreDriveFolder,
} from "../core/backend";
import type {
  DriveFile,
  DriveFolder as WireDriveFolder,
  GroupedNotificationItem,
  NotificationItem,
  Note,
  Poll as WirePoll,
  UserLite,
  UserDetailed,
  MeDetailed,
  UserRelation,
  FollowRequest as WireFollowRequest,
} from "./wire";
import { isPureRenote as isPureRenoteNote } from "./wire";

// --- Accounts --------------------------------------------------------------

/** Wire `UserLite`/`UserDetailed` -> core Account. A packed lite account
 * reports no counts or bio: those read as 0/empty exactly where the UI
 * already treated them as absent (display sites read counts from detailed
 * fetches). Never invents fields the server did not send. */
export function adaptAccount(user: UserLite | UserDetailed): Account {
  const detailed = user as Partial<UserDetailed>;
  const name = user.name != null && user.name.length > 0 ? user.name : null;
  return {
    id: user.id,
    username: user.username,
    acct: user.host ? `${user.username}@${user.host}` : user.username,
    host: user.host ?? null,
    name,
    displayName: name ?? user.username,
    bio: bioContent(detailed.description),
    url: detailed.url ?? null,
    uri: detailed.uri ?? null,
    avatarUrl: user.avatarUrl ?? null,
    avatarBlurhash: user.avatarBlurhash ?? null,
    headerUrl: detailed.bannerUrl ?? null,
    headerBlurhash: detailed.bannerBlurhash ?? null,
    followersCount: detailed.followersCount ?? 0,
    followingCount: detailed.followingCount ?? 0,
    statusesCount: detailed.notesCount ?? 0,
    locked: detailed.isLocked ?? false,
    bot: user.isBot,
    cat: user.isCat,
    silenced: detailed.isSilenced ?? false,
    suspended: detailed.isSuspended ?? false,
    onlineStatus: user.onlineStatus ?? null,
    location: detailed.location ?? null,
    birthday: detailed.birthday ?? null,
    createdAt: detailed.createdAt ?? null,
    updatedAt: detailed.updatedAt ?? null,
    lastFetchedAt: detailed.lastFetchedAt ?? null,
    emojis: user.emojis ?? {},
    fields: accountFields(detailed),
    movedTo: null,
    ffVisibility: detailed.ffVisibility ?? null,
    pinnedPostIds: detailed.pinnedNoteIds ?? null,
    pinnedPosts: detailed.pinnedNotes
      ? detailed.pinnedNotes.map(adaptNote)
      : null,
    isFollowing: detailed.isFollowing,
    isFollowed: detailed.isFollowed,
    hasPendingFollowRequestFromYou: detailed.hasPendingFollowRequestFromYou,
    hasPendingFollowRequestToYou: detailed.hasPendingFollowRequestToYou,
    ext: {},
  };
}

/** `MeDetailed` -> Account with the raw `i` bag in `ext.me` (the profile
 * editor round-trips it verbatim). */
export function adaptMe(me: MeDetailed): Account {
  return {
    ...adaptAccount(me),
    ext: {
      me: { ...(me as unknown as Record<string, unknown>) },
    },
  };
}

function bioContent(description: string | null | undefined): Content {
  if (description == null) return { plain: "" };
  return {
    mfm: description.length > 0 ? description : undefined,
    plain: plainFromMfm(description),
  };
}

function accountFields(user: Partial<UserDetailed>): AccountFieldModel[] {
  const fields = (user as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const out: AccountFieldModel[] = [];
  for (const f of fields) {
    if (typeof f !== "object" || f === null) continue;
    const rec = f as { name?: unknown; value?: unknown; verifiedAt?: unknown };
    if (typeof rec.name !== "string" || typeof rec.value !== "string") continue;
    out.push({
      name: rec.name,
      value: rec.value,
      verifiedAt: typeof rec.verifiedAt === "string" ? rec.verifiedAt : null,
    });
  }
  return out;
}

// --- Media -----------------------------------------------------------------

const MEDIA_KINDS: ReadonlyArray<[prefix: string, kind: MediaKind]> = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
];

/** Wire `DriveFile` -> core Media. `kind` derives from the MIME prefix;
 * anything else is `file` (the Drive's catch-all), never guessed. */
export function adaptDriveFile(file: DriveFile): Media {
  const mime = file.type ?? "";
  let kind: MediaKind = "file";
  for (const [prefix, k] of MEDIA_KINDS) {
    if (mime.startsWith(prefix)) {
      kind = k;
      break;
    }
  }
  return {
    id: file.id,
    kind,
    mimeType: mime,
    url: file.url ?? null,
    previewUrl: file.thumbnailUrl ?? null,
    name: file.name,
    description: file.comment ?? null,
    blurhash: file.blurhash ?? null,
    isSensitive: file.isSensitive ?? false,
    size: typeof file.size === "number" ? file.size : null,
    md5: file.md5 ?? null,
    meta: file.properties ?? null,
    createdAt: file.createdAt ?? null,
    folderId: file.folderId ?? null,
    userId: file.userId ?? null,
  };
}

// --- Drive folders -----------------------------------------------------------

/** Wire `DriveFolder` -> core DriveFolder. Only id/name/parentId surface;
 * packed parents/counts never cross into `src/`. */
export function adaptDriveFolder(folder: WireDriveFolder): CoreDriveFolder {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId ?? null,
  };
}

// --- Polls -----------------------------------------------------------------

/** Wire Poll -> core Poll. `expired` derives from `expiresAt` against the
 * clock at adapt time (the wire sends no closed flag); a poll without an
 * expiry is never expired. `votesCount` is the sum of choice votes;
 * `votersCount` stays null — the server sends none, and it is never
 * coerced. */
export function adaptPoll(poll: WirePoll | null, now = Date.now()): Poll | null {
  if (!poll) return null;
  const options = (poll.choices ?? []).map((c) => ({
    text: c.text,
    votesCount: c.votes,
    voted: c.isVoted === true,
  }));
  return {
    multiple: poll.multiple === true,
    expiresAt: poll.expiresAt ?? null,
    expired: poll.expiresAt != null && Date.parse(poll.expiresAt) <= now,
    votesCount: options.reduce((sum, o) => sum + o.votesCount, 0),
    votersCount: null,
    options,
  };
}

// --- Reactions -------------------------------------------------------------

function adaptReactions(note: Note): ReactionSummary | null {
  const counts = note.reactions;
  const myReaction = note.myReaction ?? null;
  if (counts == null && myReaction == null) return null;
  const urls = note.reactionEmojis ?? {};
  const entries: ReactionEntry[] = [];
  for (const [key, count] of Object.entries(counts ?? {})) {
    entries.push({
      key,
      count,
      mine: key === myReaction,
      url: urls[key] ?? null,
    });
  }
  return {
    total: note.reactionCount ?? entries.reduce((sum, e) => sum + e.count, 0),
    entries,
    mine: myReaction,
    myReactions: myReaction ? [myReaction] : [],
    urls,
  };
}

// --- Posts -----------------------------------------------------------------

/** Wire Note -> core Post (recursive for packed reply/renote). A packed
 * renote on a note WITH own content is a quote (Misskey `is-renote.ts`
 * semantics, mirrored by `isPureRenote`): it maps to `Post.quote` so the
 * card renders. Pure reposts keep `quote: null` (`appearNoteOf` folds
 * them). Unpacked unavailable targets stay `quoteUnavailable`. */
export function adaptNote(note: Note): Post {
  const renote = note.renote ? adaptNote(note.renote) : null;
  return {
    id: note.id,
    createdAt: note.createdAt,
    author: adaptAccount(note.user),
    accountId: note.userId,
    content: {
      mfm: note.text == null ? undefined : note.text,
      plain: plainFromMfm(note.text),
    },
    cw: note.cw ?? null,
    visibility: visibilityOf(note.visibility, note.localOnly === true),
    counts: {
      replies: note.repliesCount ?? 0,
      boosts: note.renoteCount ?? 0,
      // Misskey reports no separate quote count.
      quotes: 0,
      reactions: note.reactionCount ?? 0,
      favourites: 0,
    },
    reactions: adaptReactions(note),
    // Misskey has no favourites distinct from reactions (plan §2.1).
    favourite: null,
    media: (note.files ?? []).map(adaptDriveFile),
    mediaIds: note.fileIds ?? [],
    poll: adaptPoll(note.poll ?? null),
    card: null,
    quote: !isPureRenoteNote(note) && renote ? renote : null,
    quoteState: null,
    quoteUnavailable: note.quoteTargetUnavailable === true,
    renote,
    reply: note.reply ? adaptNote(note.reply) : null,
    replyToId: note.replyId ?? null,
    renoteId: note.renoteId ?? null,
    uri: note.uri ?? null,
    url: note.url ?? null,
    emojis: note.emojis ?? {},
    mentions: note.mentions ?? [],
    tags: note.tags ?? [],
    // Edit timestamp: Sharkey packs `Note.updatedAt` and sets it on every
    // `notes/edit` (`core/NoteEditService.ts`); upstream Misskey packs no
    // such field, and absent stays null — no badge, never a guess.
    editedAt: note.updatedAt ?? null,
    filtered: [],
    pinned: false,
    ext: {
      reactionAcceptance: note.reactionAcceptance ?? null,
      visibleUserIds: note.visibleUserIds,
      quoteTargetUri: note.quoteTargetUri ?? null,
      quoteTargetUnavailable: note.quoteTargetUnavailable ?? null,
      quoteAuthorizationStatus: note.quoteAuthorizationStatus ?? null,
      myReactionPacked: note.myReaction != null,
    },
  };
}

// --- Relationships ---------------------------------------------------------

/** Wire `users/relation` -> core Relationship. Absent flags stay absent
 * (unknown), never false. */
export function adaptUserRelation(relation: UserRelation): Relationship {
  return {
    id: relation.id,
    isFollowing: relation.isFollowing,
    isFollowed: relation.isFollowed,
    isBlocking: relation.isBlocking,
    isBlocked: relation.isBlocked,
    isMuted: relation.isMuted,
    isRenoteMuted: relation.isRenoteMuted,
  };
}

// --- Notifications ---------------------------------------------------------

/** Misskey-family wire `type` -> core kind. The wire vocabulary is
 * `misskey-js/src/consts.ts` `notificationTypes`; the exact spellings
 * matter (`achievementEarned`, `scheduledNotePostFailed`). `unknown` stays
 * for types this app has no honest surface for — today that is any fork
 * extension; those render their raw type, never a guessed action. */
export const MISSKEY_NOTIFICATION_KINDS: ReadonlyArray<[wire: string, kind: Notification["kind"]]> = [
  ["note", "note"],
  ["follow", "follow"],
  ["mention", "mention"],
  ["reply", "reply"],
  ["renote", "renote"],
  ["quote", "quote"],
  ["reaction", "reaction"],
  ["pollVote", "pollVote"],
  ["pollEnded", "pollEnded"],
  ["receiveFollowRequest", "receiveFollowRequest"],
  ["followRequestAccepted", "followRequestAccepted"],
  ["achievementEarned", "achievement"],
  ["app", "app"],
  ["scheduledNotePosted", "scheduledNotePosted"],
  ["scheduledNotePostFailed", "scheduledNotePostFailed"],
  // Some Misskey-family forks spell the failure row without "Post"
  // (clickstone §1.11 named it `scheduledNoteFailed`); same meaning, so
  // both spellings resolve to the one kind.
  ["scheduledNoteFailed", "scheduledNotePostFailed"],
  ["exportCompleted", "exportCompleted"],
  ["roleAssigned", "roleAssigned"],
  ["login", "login"],
  ["createToken", "createToken"],
  // Chat ships in P6.2 slice 2.2: the invitation maps to its own kind
  // with the room id in `ext` so the row deep-links (clickstone §2.2).
  ["chatRoomInvitationReceived", "chatRoomInvitation"],
  ["test", "test"],
  // The grouped listing can label its aggregate rows; the same adapters
  // map them so grouped and flat rows never disagree about the kind.
  ["reaction:grouped", "reaction"],
  ["renote:grouped", "renote"],
];

function notificationKindOf(rawType: string): Notification["kind"] {
  for (const [wire, kind] of MISSKEY_NOTIFICATION_KINDS) {
    if (wire === rawType) return kind;
  }
  return "unknown";
}

/** Core notification KIND -> Misskey wire types, for
 * `i/notifications{,-grouped}` `includeTypes`/`excludeTypes`. Only kinds
 * whose wire spelling differs need an entry (`achievement` ->
 * `achievementEarned`); the rest are identity. Tokens missing from this
 * map are sent verbatim (a fork type or a future kind is still
 * filterable by its wire spelling) — a filter, never a model merge. */
const MISSKEY_NOTIFY_WIRE_TYPES: Record<string, string[]> = {
  achievement: ["achievementEarned"],
};

/** Translate core preset kinds to Misskey wire types (deduped, order
 * preserved). Pure. */
export function misskeyNotificationTypes(tokens: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens ?? []) {
    for (const wire of MISSKEY_NOTIFY_WIRE_TYPES[token] ?? [token]) {
      if (seen.has(wire)) continue;
      seen.add(wire);
      out.push(wire);
    }
  }
  return out;
}

function actorOf(id: string, account: Account | null, reaction: string | null): NotificationActor {
  return { id, account, reaction };
}

/** Per-kind detail the wire packed (role name, export target, achievement,
 * kept draft). Absent fields stay absent — nothing is invented. */
function systemExtOf(item: NotificationItem): NotificationExt {
  const ext: NotificationExt = {};
  if (typeof item.role?.name === "string" && item.role.name.length > 0) {
    ext.roleName = item.role.name;
  }
  if (typeof item.exportedEntity === "string" && item.exportedEntity.length > 0) {
    ext.exportedEntity = item.exportedEntity;
  }
  if (typeof item.fileId === "string" && item.fileId.length > 0) {
    ext.exportedFileId = item.fileId;
  }
  if (typeof item.achievement === "string" && item.achievement.length > 0) {
    ext.achievement = item.achievement;
  }
  if (typeof item.noteDraft?.id === "string" && item.noteDraft.id.length > 0) {
    ext.failedDraftId = item.noteDraft.id;
  }
  // The invitation packs the room (`invitation.room.id/name`); the row
  // deep-links to it when present, labels honestly when absent.
  const room = item.invitation?.room;
  if (room && typeof room.id === "string" && room.id.length > 0) {
    ext.invitedRoomId = room.id;
    if (typeof room.name === "string" && room.name.length > 0) {
      ext.invitedRoomName = room.name;
    }
  }
  return ext;
}

/** Wire `NotificationItem` (flat row) -> core Notification. */
export function adaptNotification(item: NotificationItem): Notification {
  const reaction = item.reaction ?? null;
  const actors: NotificationActor[] = item.user
    ? [actorOf(item.user.id, adaptAccount(item.user), reaction)]
    : item.userId
      ? [actorOf(item.userId, null, reaction)]
      : [];
  return {
    id: item.id,
    kind: notificationKindOf(item.type),
    rawType: item.type,
    createdAt: item.createdAt,
    // Pinetree packs isRead; Misskey/Sharkey omit it → unknown.
    read: item.isRead ?? null,
    actors,
    post: item.note ? adaptNote(item.note) : null,
    reaction,
    ext: systemExtOf(item),
  };
}

/** Wire `GroupedNotificationItem` (aggregated row) -> core Notification. */
export function adaptGroupedNotification(item: GroupedNotificationItem): Notification {
  const pairs = item.reactions ?? [];
  const reactionByUser = new Map(pairs.map((r) => [r.userId, r.reaction]));
  const seen = new Set<string>();
  const actors: NotificationActor[] = [];
  for (const user of item.users ?? (item.user ? [item.user] : [])) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    actors.push(
      actorOf(user.id, adaptAccount(user), reactionByUser.get(user.id) ?? null),
    );
  }
  for (const id of item.userIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    actors.push(actorOf(id, null, reactionByUser.get(id) ?? null));
  }
  return {
    id: item.id,
    kind: notificationKindOf(item.type),
    rawType: item.type,
    createdAt: item.createdAt,
    // The grouped endpoint reports no read state.
    read: null,
    actors,
    post: item.note ? adaptNote(item.note) : null,
    reaction: null,
    ext: { groupedReactions: pairs.map((r) => ({ ...r })) },
  };
}

// --- Follow requests -------------------------------------------------------

export function adaptFollowRequest(req: WireFollowRequest): CoreFollowRequest {
  return {
    id: req.id,
    follower: adaptAccount(req.follower),
    followee: adaptAccount(req.followee),
  };
}

// --- Cursors ---------------------------------------------------------------
//
// Misskey pages on `{limit, untilId, sinceId}`; the opaque core Cursor
// hides that. The cursor string is JSON of the ids only — the UI treats it
// as a token and never parses it.

interface MisskeyCursor {
  untilId?: string;
  sinceId?: string;
}

export function encodeCursor(cursor: MisskeyCursor | null | undefined): Cursor | null {
  if (!cursor || (!cursor.untilId && !cursor.sinceId)) return null;
  return JSON.stringify(cursor) as Cursor;
}

export function decodeCursor(cursor: Cursor | null | undefined): MisskeyCursor {
  if (!cursor) return {};
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = parsed as MisskeyCursor;
    return {
      ...(typeof rec.untilId === "string" ? { untilId: rec.untilId } : {}),
      ...(typeof rec.sinceId === "string" ? { sinceId: rec.sinceId } : {}),
    };
  } catch {
    return {};
  }
}

/** Build a core Page from a wire listing. The next cursor is the LAST
 * item's id (Misskey `untilId` paging); `end` is a short/empty page — the
 * same exhaustion rule the app already paged with (`page.length <
 * LIMIT`). */
export function pageOf<T, R>(
  items: T[],
  limit: number,
  adaptItem: (item: T) => R,
): Page<R> {
  const adapted = items.map(adaptItem);
  const last = items.length > 0 ? items[items.length - 1] : null;
  const lastId = last ? (last as { id?: unknown }).id : undefined;
  if (items.length === 0 || typeof lastId !== "string") {
    return { items: adapted, cursor: null, end: true };
  }
  return {
    items: adapted,
    cursor: encodeCursor({ untilId: lastId }),
    end: items.length < limit,
  };
}
