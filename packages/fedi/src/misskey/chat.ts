// Misskey-family chat (rooms + 1-on-1 direct messages, clickstone §2.2).
//
// The official client splits the surface into two thread kinds backed by
// two stream channels (`pages/chat/room.vue` + `message.vue`):
//   - rooms: `chat/rooms/*` for the lifecycle, `chat/messages/room-timeline`
//     for history, `chatRoom` for live events;
//   - 1-on-1: `chat/messages/user-timeline` for history, `chatUser` for
//     live events, `chat/history` (`room: false`) for the overview.
//
// Endpoints (verified against upstream `misskey-dev/misskey@develop`
// `packages/backend/src/server/api/endpoints/chat/...`, 2026-10-22, plus
// live presence probes — see `docs/tasks/p6.2-misskey-chat.md`):
//   chat/rooms/joining   limit/sinceId/untilId (+dates)   (auth, read:chat)
//   chat/history         limit/room                       (auth, read:chat)
//   chat/rooms/show      roomId                           (auth, read:chat)
//   chat/rooms/create    name/description                 (auth, write:chat)
//   chat/messages/room-timeline  roomId/limit/sinceId/untilId (auth, read:chat)
//   chat/messages/user-timeline  userId/limit/sinceId/untilId (auth, read:chat)
//   chat/messages/create-to-room  toRoomId/text?/fileId?  (auth, write:chat)
//   chat/messages/create-to-user  toUserId/text?/fileId?  (auth, write:chat)
//   chat/messages/show   messageId                        (auth, read:chat)
//   chat/messages/delete messageId (own messages only)    (auth, write:chat)
//   chat/read-all        {}                               (auth, write:chat kind)
//
// Read semantics (upstream `ChatService`, not a client guess): the two
// timeline endpoints mark the thread read server-side on every fetch
// (`readRoomChatMessage` / `readUserChatMessage`); `chat/read-all` marks
// everything; `chat/history` answers each row's `isRead` from the
// read-state map. There is deliberately NO per-thread "mark read" call
// here — opening the thread (fetching its timeline) IS the mark.
// Presence (dvd.chat Sharkey 2025.4.7: CREDENTIAL_REQUIRED; misskey.io
// 2025.4.1-io: 404 on every `chat/*`) means stock-old servers answer 404,
// which the backend surfaces as the typed unsupported `ApiError` — the UI
// renders "not on this server", never an error wall.

import type { ChatMessage, ChatRoom, ChatRoomMembership } from "../core/backend";
import { adaptAccount, adaptDriveFile } from "./adapt";
import type { WireCall } from "./client";
import type { DriveFile, UserLite } from "./wire";

/** Packed `ChatRoom` (`ChatEntityService.packRoom`). `isMuted` /
 * `invitationExists` are absent for the owner (never fabricated). */
export interface PackedChatRoom {
  id?: unknown;
  createdAt?: unknown;
  name?: unknown;
  description?: unknown;
  ownerId?: unknown;
  owner?: unknown;
  isMuted?: unknown;
  invitationExists?: unknown;
}

/** Packed membership (`packRoomMembership`). `joining` populates `room`
 * (not `user`); `members` populates `user` (not `room`). */
export interface PackedChatRoomMembership {
  id?: unknown;
  createdAt?: unknown;
  userId?: unknown;
  user?: unknown;
  roomId?: unknown;
  room?: unknown;
}

/** One packed message reaction (`{user?, reaction}` — lite packs may omit
 * the user; detailed `reactions` always carry one, filtered when gone). */
export interface PackedChatReaction {
  user?: unknown;
  reaction?: unknown;
}

/** Packed message, any variant: detailed (`chat/history`,
 * `chat/messages/show`) or lite (`room-timeline`, `user-timeline`,
 * creates). The 1-on-1 lite carries NO packed users at all. */
export interface PackedChatMessage {
  id?: unknown;
  createdAt?: unknown;
  text?: unknown;
  fromUserId?: unknown;
  fromUser?: unknown;
  toUserId?: unknown;
  toUser?: unknown;
  toRoomId?: unknown;
  toRoom?: unknown;
  fileId?: unknown;
  file?: unknown;
  reactions?: unknown;
  /** Added by `chat/history` only (read-state map). Timelines omit it —
   * they mark read instead. */
  isRead?: unknown;
}

export type PackedChatMessageLiteForRoom = PackedChatMessage;
export type PackedChatMessageLiteFor1on1 = PackedChatMessage;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Adapt one packed room. Missing strings become absent values, never
 * placeholder text; `isMuted` stays null when the server did not report
 * it (owner view) so the UI can tell "known off" from "unknown". */
export function adaptChatRoom(raw: PackedChatRoom): ChatRoom {
  const ownerRec = asRecord(raw.owner);
  return {
    id: asString(raw.id) ?? "",
    createdAt: asString(raw.createdAt) ?? "",
    name: asString(raw.name) ?? "",
    description: typeof raw.description === "string" ? raw.description : null,
    ownerId: asString(raw.ownerId) ?? "",
    owner: ownerRec && typeof ownerRec.id === "string" ? adaptAccount(ownerRec as unknown as UserLite) : null,
    isMuted: typeof raw.isMuted === "boolean" ? raw.isMuted : null,
  };
}

/** Adapt one packed membership. The room is populated by `joining`, the
 * user by `members` — whichever side the server left off stays null. */
export function adaptChatRoomMembership(raw: PackedChatRoomMembership): ChatRoomMembership {
  const roomRec = asRecord(raw.room);
  const userRec = asRecord(raw.user);
  return {
    id: asString(raw.id) ?? "",
    createdAt: asString(raw.createdAt) ?? "",
    userId: asString(raw.userId) ?? "",
    user: userRec && typeof userRec.id === "string" ? adaptAccount(userRec as unknown as UserLite) : null,
    roomId: asString(raw.roomId) ?? "",
    room:
      roomRec && typeof roomRec.id === "string"
        ? adaptChatRoom(roomRec as unknown as PackedChatRoom)
        : null,
  };
}

/** Adapt one packed message (detailed or either lite). The 1-on-1 lite
 * carries no packed users, so `fromAccount` is null there — id-only,
 * never an invented account. `read` is the `chat/history` flag; timelines
 * omit it (they mark read on fetch). */
export function adaptChatMessage(raw: PackedChatMessage): ChatMessage {
  const fromRec = asRecord(raw.fromUser);
  const fileRec = asRecord(raw.file);
  const reactions: Array<{ reaction: string; accountId: string | null }> = [];
  if (Array.isArray(raw.reactions)) {
    for (const entry of raw.reactions) {
      const rec = asRecord(entry);
      if (!rec || typeof rec.reaction !== "string") continue;
      const userRec = asRecord(rec.user);
      const accountId = userRec && typeof userRec.id === "string" ? userRec.id : null;
      // Detailed packs filter deleted reactors server-side; lite packs
      // may omit the user — keep the reaction with a null account so the
      // count stays honest without inventing who reacted.
      reactions.push({ reaction: rec.reaction, accountId });
    }
  }
  return {
    id: asString(raw.id) ?? "",
    createdAt: asString(raw.createdAt) ?? "",
    text: typeof raw.text === "string" ? raw.text : null,
    fromAccountId: asString(raw.fromUserId) ?? "",
    fromAccount:
      fromRec && typeof fromRec.id === "string" ? adaptAccount(fromRec as unknown as UserLite) : null,
    toUserId: asString(raw.toUserId),
    toRoomId: asString(raw.toRoomId),
    fileId: asString(raw.fileId),
    file: fileRec && typeof fileRec.id === "string" ? adaptDriveFile(fileRec as unknown as DriveFile) : null,
    reactions,
    read: typeof raw.isRead === "boolean" ? raw.isRead : null,
  };
}

/** Cursor passthrough for the paged chat endpoints (`joining`, both
 * timelines): `{limit, sinceId, untilId}` exactly as the caller passed —
 * the server defaults differ per endpoint, so unset directions are never
 * sent (an absent `sinceId` is not `sinceId: null` — Sharkey rejects
 * empty/default fields). */
function pagedParams(opts: { limit?: number; sinceId?: string; untilId?: string }): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (opts.limit !== undefined) params.limit = opts.limit;
  if (opts.sinceId !== undefined) params.sinceId = opts.sinceId;
  if (opts.untilId !== undefined) params.untilId = opts.untilId;
  return params;
}

/** Rooms the viewer joined (`chat/rooms/joining`), newest membership
 * first, both directions paged. Populates `room` (with owner), not
 * `user` — see `adaptChatRoomMembership`. */
export async function listChatRooms(
  call: WireCall,
  opts: { limit?: number; sinceId?: string; untilId?: string } = {},
): Promise<ChatRoomMembership[]> {
  const rows =
    (await call<PackedChatRoomMembership[]>("chat/rooms/joining", pagedParams(opts))) ?? [];
  return rows.map(adaptChatRoomMembership);
}

/** The chat overview (`chat/history`): latest message per counterpart.
/// `rooms: true` scopes to rooms, `false` (default) to 1-on-1. Limit-only
// (1–100, default 10) — the server offers NO cursor here, so callers
// refetch rather than page. Each row carries `isRead`. */
export async function chatHistory(
  call: WireCall,
  opts: { limit?: number; rooms?: boolean } = {},
): Promise<ChatMessage[]> {
  const params: Record<string, unknown> = { room: opts.rooms === true };
  if (opts.limit !== undefined) params.limit = opts.limit;
  const rows = (await call<PackedChatMessage[]>("chat/history", params)) ?? [];
  return rows.map(adaptChatMessage);
}

/** One room (`chat/rooms/show`). A 404 reads as "no such room" (or not a
 * member / not invited) — the caller maps it to unavailable. */
export async function showChatRoom(call: WireCall, roomId: string): Promise<ChatRoom> {
  return adaptChatRoom(await call<PackedChatRoom>("chat/rooms/show", { roomId }));
}

export interface CreateChatRoomOpts {
  name: string;
  description?: string | null;
}

/** Create a room (`chat/rooms/create`): `name` required (≤256),
 * `description` only when set (≤1024). Answers the packed room. */
export async function createChatRoom(call: WireCall, opts: CreateChatRoomOpts): Promise<ChatRoom> {
  const params: Record<string, unknown> = { name: opts.name };
  if (opts.description != null && opts.description !== "") params.description = opts.description;
  return adaptChatRoom(await call<PackedChatRoom>("chat/rooms/create", params));
}

export interface ChatTimelineOpts {
  limit?: number;
  sinceId?: string;
  untilId?: string;
}

/** One room's messages (`chat/messages/room-timeline`), newest first both
 * directions. Fetching marks the room read server-side — the caller never
 * sends a separate mark. */
export async function roomTimeline(
  call: WireCall,
  roomId: string,
  opts: ChatTimelineOpts = {},
): Promise<{ items: ChatMessage[] }> {
  const rows =
    (await call<PackedChatMessage[]>("chat/messages/room-timeline", {
      roomId,
      ...pagedParams(opts),
    })) ?? [];
  return { items: rows.map(adaptChatMessage) };
}

/** One 1-on-1 thread (`chat/messages/user-timeline`), newest first both
 * directions. Fetching marks the thread read server-side. */
export async function userTimeline(
  call: WireCall,
  userId: string,
  opts: ChatTimelineOpts = {},
): Promise<{ items: ChatMessage[] }> {
  const rows =
    (await call<PackedChatMessage[]>("chat/messages/user-timeline", {
      userId,
      ...pagedParams(opts),
    })) ?? [];
  return { items: rows.map(adaptChatMessage) };
}

export interface SendChatMessageOpts {
  text?: string | null;
  fileId?: string | null;
}

/** Send params: `text` and/or `fileId` — the server rejects both-absent
 * (`CONTENT_REQUIRED`), so the client refuses first (no doomed write). */
function sendParams(
  target: Record<string, unknown>,
  opts: SendChatMessageOpts,
): Record<string, unknown> | null {
  const text = typeof opts.text === "string" && opts.text.length > 0 ? opts.text : null;
  const fileId = typeof opts.fileId === "string" && opts.fileId.length > 0 ? opts.fileId : null;
  if (text == null && fileId == null) return null;
  return {
    ...target,
    ...(text != null ? { text } : {}),
    ...(fileId != null ? { fileId } : {}),
  };
}

/** Send to a room (`chat/messages/create-to-room`). Answers the lite pack. */
export async function createRoomMessage(
  call: WireCall,
  roomId: string,
  opts: SendChatMessageOpts,
): Promise<ChatMessage> {
  const params = sendParams({ toRoomId: roomId }, opts);
  if (!params) throw new Error("A chat message needs text or a file.");
  return adaptChatMessage(await call<PackedChatMessage>("chat/messages/create-to-room", params));
}

/** Send to a user (`chat/messages/create-to-user`). The server refuses
 * self-sends (`RECIPIENT_IS_YOURSELF`) — the caller checks first where it
 * knows `me`, the error still surfaces verbatim otherwise. */
export async function createUserMessage(
  call: WireCall,
  userId: string,
  opts: SendChatMessageOpts,
): Promise<ChatMessage> {
  const params = sendParams({ toUserId: userId }, opts);
  if (!params) throw new Error("A chat message needs text or a file.");
  return adaptChatMessage(await call<PackedChatMessage>("chat/messages/create-to-user", params));
}

/** One message, detailed (`chat/messages/show`) — moderators may read any
 * thread; everyone else only their own (else `NO_SUCH_MESSAGE`). */
export async function showChatMessage(call: WireCall, messageId: string): Promise<ChatMessage> {
  return adaptChatMessage(await call<PackedChatMessage>("chat/messages/show", { messageId }));
}

/** Delete an own message (`chat/messages/delete`). Others' messages answe
 * `NO_SUCH_MESSAGE` — the caller offers delete only on `mine` rows. */
export async function deleteChatMessage(call: WireCall, messageId: string): Promise<void> {
  await call<undefined>("chat/messages/delete", { messageId });
}

/** Mark every chat read (`chat/read-all`). No params. The per-thread mark
 * is the timeline fetch itself; this is the inbox-level sweep. */
export async function readAllChat(call: WireCall): Promise<void> {
  await call<undefined>("chat/read-all", {});
}
