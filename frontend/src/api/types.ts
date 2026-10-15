// Wire types for the Keystone API targets (Pinetree + Misskey/Sharkey,
// all Misskey-compatible JSON POST at /api/{endpoint}, camelCase fields).
// The shared endpoints used by Keystone behave the same across backends;
// see docs/api-surface.md for the verified compatibility matrix.

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
  /** Present on notes that carry a poll (Misskey-family; Pinetree rejects
   * polls at create time, so this stays null there). */
  poll: Poll | null;
  mentions: string[];
  visibleUserIds?: string[];
  tags: string[];
  emojis: Record<string, string>;
  myReaction: string | null;
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
  poll?: {
    choices: string[];
    multiple?: boolean;
    expiredAfter?: number;
    expiresAt?: number;
  } | null;
}

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

export function displayNameOf(user: Pick<UserLite, "name" | "username">): string {
  return user.name && user.name.length > 0 ? user.name : user.username;
}
