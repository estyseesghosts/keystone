// Misskey chat (clickstone §2.2): rooms, history, timelines, sends, and
// read markers. Every method must make exactly the requests the official
// client makes (verified against upstream `misskey-dev/misskey@develop`
// `packages/backend/src/server/api/endpoints/chat/...` + the frontend
// `pages/chat/...` call sites — see docs/tasks/p6.2-misskey-chat.md for
// the per-endpoint inventory), adapt the packed shapes to the domain
// models, and page both directions on the shared `{untilId, sinceId}`
// cursor convention. Transport is stubbed — no network.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import {
  adaptChatMessage,
  adaptChatRoom,
  adaptChatRoomMembership,
  chatHistory,
  createChatRoom,
  createRoomMessage,
  createUserMessage,
  deleteChatMessage,
  listChatRooms,
  readAllChat,
  roomTimeline,
  showChatMessage,
  showChatRoom,
  userTimeline,
  type PackedChatMessage,
  type PackedChatMessageLiteFor1on1,
  type PackedChatMessageLiteForRoom,
  type PackedChatRoom,
  type PackedChatRoomMembership,
} from "../src/misskey/chat";
import { isUnsupportedError } from "../src/misskey/client";
import { ApiError } from "../src/core/errors";
import type { UserLite } from "../src/misskey/wire";

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(): Promise<T> {
        throw new Error("no upload in this test");
      },
    },
  };
}

const user = (id: string, username: string): UserLite => ({
  id,
  name: null,
  username,
  host: null,
  avatarUrl: null,
  avatarBlurhash: null,
  isBot: false,
  isCat: false,
  emojis: {},
  onlineStatus: "unknown",
});

// Shape of `ChatEntityService.packRoom` (upstream), trimmed to the fields
// the domain model keeps.
const packedRoom: PackedChatRoom = {
  id: "room1",
  createdAt: "2026-10-20T00:00:00.000Z",
  name: "General",
  description: "Talk about anything",
  ownerId: "owner1",
  owner: user("owner1", "owner"),
  isMuted: false,
  invitationExists: false,
};

const packedMembership: PackedChatRoomMembership = {
  id: "memb1",
  createdAt: "2026-10-20T00:00:00.000Z",
  userId: "me",
  roomId: "room1",
  room: packedRoom,
};

// Upstream `packMessageLiteForRoom` shape.
const packedRoomMessage: PackedChatMessageLiteForRoom = {
  id: "msg1",
  createdAt: "2026-10-20T01:00:00.000Z",
  text: "hello room",
  fromUserId: "owner1",
  fromUser: user("owner1", "owner"),
  toRoomId: "room1",
  fileId: null,
  file: null,
  reactions: [],
};

// Upstream `packMessageLiteFor1on1` shape — notably NO packed users.
const packedUserMessage: PackedChatMessageLiteFor1on1 = {
  id: "msg2",
  createdAt: "2026-10-20T02:00:00.000Z",
  text: "hello you",
  fromUserId: "other1",
  toUserId: "me",
  fileId: null,
  file: null,
  reactions: [],
};

// Upstream `packMessageDetailed` shape (+ `isRead` from `chat/history`).
const packedDetailed: PackedChatMessage = {
  id: "msg3",
  createdAt: "2026-10-20T03:00:00.000Z",
  text: "detailed hello",
  fromUserId: "other1",
  fromUser: user("other1", "other"),
  toUserId: "me",
  toUser: user("me", "me"),
  fileId: null,
  file: null,
  reactions: [{ user: user("other1", "other"), reaction: "❤" }],
  isRead: true,
};

describe("Misskey chat endpoints (room list / history / show / create)", () => {
  it("lists rooms through chat/rooms/joining (paged both ways)", async () => {
    const { transport, calls } = stubTransport(() => [packedMembership]);
    const page = await listChatRooms(transport.call, { limit: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe("chat/rooms/joining");
    expect(calls[0].params.limit).toBe(20);
    expect(page).toHaveLength(1);
    expect(page[0].room?.id).toBe("room1");
    expect(page[0].room?.owner?.username).toBe("owner");
  });

  it("pages the room list with untilId (cursor passthrough)", async () => {
    const { transport, calls } = stubTransport(() => []);
    await listChatRooms(transport.call, { limit: 10, untilId: "memb9" });
    expect(calls[0].endpoint).toBe("chat/rooms/joining");
    expect(calls[0].params.untilId).toBe("memb9");
  });

  it("reads 1-on-1 history through chat/history with room:false", async () => {
    const { transport, calls } = stubTransport(() => [packedDetailed]);
    const items = await chatHistory(transport.call, { limit: 10, rooms: false });
    expect(calls[0].endpoint).toBe("chat/history");
    expect(calls[0].params).toMatchObject({ limit: 10, room: false });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("msg3");
    expect(items[0].read).toBe(true);
  });

  it("reads room history through chat/history with room:true", async () => {
    const { transport, calls } = stubTransport(() => []);
    await chatHistory(transport.call, { limit: 10, rooms: true });
    expect(calls[0].endpoint).toBe("chat/history");
    expect(calls[0].params).toMatchObject({ room: true });
  });

  it("shows a room through chat/rooms/show", async () => {
    const { transport, calls } = stubTransport(() => packedRoom);
    const room = await showChatRoom(transport.call, "room1");
    expect(calls[0].endpoint).toBe("chat/rooms/show");
    expect(calls[0].params).toEqual({ roomId: "room1" });
    expect(room.name).toBe("General");
    expect(room.description).toBe("Talk about anything");
    expect(room.isMuted).toBe(false);
  });

  it("creates a room through chat/rooms/create (no description key when absent)", async () => {
    const { transport, calls } = stubTransport(() => packedRoom);
    await createChatRoom(transport.call, { name: "General" });
    expect(calls[0].endpoint).toBe("chat/rooms/create");
    expect(calls[0].params).toEqual({ name: "General" });
  });

  it("creates a room with a description when given", async () => {
    const { transport, calls } = stubTransport(() => packedRoom);
    await createChatRoom(transport.call, { name: "General", description: "hi" });
    expect(calls[0].params).toEqual({ name: "General", description: "hi" });
  });
});

describe("Misskey chat timelines (paged both ways, auto-read server-side)", () => {
  it("pages a room thread through chat/messages/room-timeline", async () => {
    const { transport, calls } = stubTransport(() => [packedRoomMessage]);
    const { items } = await roomTimeline(transport.call, "room1", { limit: 20 });
    expect(calls[0].endpoint).toBe("chat/messages/room-timeline");
    expect(calls[0].params).toMatchObject({ roomId: "room1", limit: 20 });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("hello room");
    expect(items[0].toRoomId).toBe("room1");
    expect(items[0].fromAccount?.username).toBe("owner");
  });

  it("pages a 1-on-1 thread through chat/messages/user-timeline", async () => {
    const { transport, calls } = stubTransport(() => [packedUserMessage]);
    const { items } = await userTimeline(transport.call, "other1", { limit: 20 });
    expect(calls[0].endpoint).toBe("chat/messages/user-timeline");
    expect(calls[0].params).toMatchObject({ userId: "other1", limit: 20 });
    expect(items).toHaveLength(1);
    expect(items[0].toUserId).toBe("me");
    // The 1-on-1 lite pack carries no users: the sender stays id-only,
    // never an invented account.
    expect(items[0].fromAccount).toBeNull();
  });

  it("passes sinceId through for pull-to-refresh", async () => {
    const { transport, calls } = stubTransport(() => []);
    await roomTimeline(transport.call, "room1", { limit: 10, sinceId: "msg5" });
    expect(calls[0].params.sinceId).toBe("msg5");
  });
});

describe("Misskey chat sends + read markers", () => {
  it("sends a room message through chat/messages/create-to-room", async () => {
    const { transport, calls } = stubTransport(() => packedRoomMessage);
    const sent = await createRoomMessage(transport.call, "room1", { text: "hi" });
    expect(calls[0].endpoint).toBe("chat/messages/create-to-room");
    expect(calls[0].params).toEqual({ toRoomId: "room1", text: "hi" });
    expect(sent.id).toBe("msg1");
  });

  it("sends a 1-on-1 message through chat/messages/create-to-user", async () => {
    const { transport, calls } = stubTransport(() => packedUserMessage);
    await createUserMessage(transport.call, "other1", { text: "hi" });
    expect(calls[0].endpoint).toBe("chat/messages/create-to-user");
    expect(calls[0].params).toEqual({ toUserId: "other1", text: "hi" });
  });

  it("sends a file-only message (text omitted, never empty)", async () => {
    const { transport, calls } = stubTransport(() => packedRoomMessage);
    await createRoomMessage(transport.call, "room1", { fileId: "file1" });
    expect(calls[0].params).toEqual({ toRoomId: "room1", fileId: "file1" });
  });

  it("refuses an empty message before any network I/O", async () => {
    const { transport, calls } = stubTransport(() => packedRoomMessage);
    await expect(createRoomMessage(transport.call, "room1", {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("marks everything read through chat/read-all", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    await readAllChat(transport.call);
    expect(calls[0].endpoint).toBe("chat/read-all");
  });

  it("shows one message through chat/messages/show", async () => {
    const { transport, calls } = stubTransport(() => packedDetailed);
    const message = await showChatMessage(transport.call, "msg3");
    expect(calls[0].endpoint).toBe("chat/messages/show");
    expect(calls[0].params).toEqual({ messageId: "msg3" });
    expect(message.text).toBe("detailed hello");
  });

  it("deletes an own message through chat/messages/delete", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    await deleteChatMessage(transport.call, "msg3");
    expect(calls[0].endpoint).toBe("chat/messages/delete");
    expect(calls[0].params).toEqual({ messageId: "msg3" });
  });
});

describe("Misskey chat adapters (honest nulls, never faked)", () => {
  it("adapts a detailed message with reactions + read flag", () => {
    const message = adaptChatMessage(packedDetailed);
    expect(message.fromAccountId).toBe("other1");
    expect(message.fromAccount?.username).toBe("other");
    expect(message.toUserId).toBe("me");
    expect(message.reactions).toEqual([{ reaction: "❤", accountId: "other1" }]);
    expect(message.read).toBe(true);
  });

  it("adapts a missing text as null (never an empty placeholder)", () => {
    const message = adaptChatMessage({ ...packedRoomMessage, text: null });
    expect(message.text).toBeNull();
  });

  it("adapts a membership with the populated room", () => {
    const membership = adaptChatRoomMembership(packedMembership);
    expect(membership.roomId).toBe("room1");
    expect(membership.room?.name).toBe("General");
  });

  it("adapts a room without optional flags as null (never false)", () => {
    const room = adaptChatRoom({ ...packedRoom, isMuted: undefined, invitationExists: undefined });
    expect(room.isMuted).toBeNull();
  });
});

describe("MisskeyBackend chat wiring (flavor-gated, honest absence)", () => {
  function backendFor(flavor: "misskey" | "sharkey" | "catodon" | "pinetree") {
    const { transport } = stubTransport((endpoint) => {
      if (endpoint === "chat/rooms/joining") return [packedMembership];
      if (endpoint === "chat/rooms/show") return packedRoom;
      throw new ApiError("no such endpoint", 404);
    });
    return createMisskeyBackend(transport, flavor, { origin: "https://mk.example" });
  }

  it.each(["misskey", "sharkey"] as const)("exposes chat on %s", async (flavor) => {
    const backend = backendFor(flavor);
    expect(backend.chat).toBeDefined();
    const rooms = await backend.chat!.rooms({ limit: 10 });
    expect(rooms.items[0].room?.id).toBe("room1");
    const room = await backend.chat!.showRoom("room1");
    expect(room.name).toBe("General");
  });

  it.each(["catodon", "pinetree"] as const)("leaves chat off on %s (unverified/absent)", (flavor) => {
    expect(backendFor(flavor).chat).toBeUndefined();
  });

  it("surfaces a 404 room list as the typed unsupported error (old servers)", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("no such endpoint", 404);
    });
    const backend = createMisskeyBackend(transport, "misskey", { origin: "https://mk.example" });
    await expect(backend.chat!.rooms({})).rejects.toMatchObject({ status: 404 });
    try {
      await backend.chat!.rooms({});
    } catch (err) {
      expect(isUnsupportedError(err)).toBe(true);
    }
  });
});
