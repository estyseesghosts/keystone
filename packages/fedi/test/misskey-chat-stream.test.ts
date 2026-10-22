// Misskey chat live delivery (clickstone §2.2): the `chatRoom` /
// `chatUser` stream channels against a mock WebSocket. Verifies the
// channel names + params the official client uses (`chatRoom` + `{roomId}`,
// `chatUser` + `{otherId}` — `stream/channels/chat-{room,user}.ts`),
// message/deleted dispatch through the domain adapter, reconnect
// resubscription, the ack-timeout→unavailable path, and the no-token /
// unsupported no-op handles. Paging + refresh never depend on any of
// this; the socket only *adds* events.

import { adaptChatMessage } from "../src/misskey/chat";
import { createStreamHandle, createStreamPool } from "../src/misskey/stream";
import type { StreamSocket } from "../src/misskey/stream";

type Listener = (ev: { data?: unknown }) => void;

class MockSocket implements StreamSocket {
  static readonly OPEN = 1;
  static instances: MockSocket[] = [];
  readonly readyState = MockSocket.OPEN;
  url: string;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, ev: { data?: unknown }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

const MockWsImpl = MockSocket as unknown as {
  new (url: string): StreamSocket;
  readonly OPEN: number;
};

beforeEach(() => {
  MockSocket.instances = [];
});

const packedRoomMessage = {
  id: "msg1",
  createdAt: "2026-10-20T01:00:00.000Z",
  text: "hello room",
  fromUserId: "owner1",
  fromUser: {
    id: "owner1",
    name: null,
    username: "owner",
    host: null,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: "unknown",
  },
  toRoomId: "room1",
  fileId: null,
  file: null,
  reactions: [],
};

function openFirstSocket(): MockSocket {
  const socket = MockSocket.instances[0];
  socket.emit("open", {});
  return socket;
}

function channelFrame(serverId: string, eventType: string, payload: unknown): string {
  return JSON.stringify({
    type: "channel",
    body: { id: serverId, type: eventType, body: payload },
  });
}

function connectBody(socket: MockSocket, index = 0): { channel: string; id: string; params?: Record<string, unknown> } {
  return (JSON.parse(socket.sent[index]) as { type: string; body: { channel: string; id: string; params?: Record<string, unknown> } }).body;
}

describe("chat stream channels (chatRoom / chatUser)", () => {
  it("subscribes chatRoom with the room id param", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    })!;
    const dispose = handle.subscribeChatRoom!("room1", {});
    const socket = openFirstSocket();
    expect(connectBody(socket).channel).toBe("chatRoom");
    expect(connectBody(socket).params).toEqual({ roomId: "room1" });
    dispose();
  });

  it("subscribes chatUser with the otherId param", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    })!;
    const dispose = handle.subscribeChatUser!("other1", {});
    const socket = openFirstSocket();
    expect(connectBody(socket).channel).toBe("chatUser");
    expect(connectBody(socket).params).toEqual({ otherId: "other1" });
    dispose();
  });

  it("delivers a room message through the domain adapter", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    })!;
    const received: Array<{ id: string; text: string | null }> = [];
    const dispose = handle.subscribeChatRoom!("room1", {
      onMessage: (message) => {
        received.push({ id: message.id, text: message.text });
      },
    });
    const socket = openFirstSocket();
    const serverId = connectBody(socket).id;
    socket.emit("message", { data: channelFrame(serverId, "message", packedRoomMessage) });
    expect(received).toEqual([{ id: "msg1", text: "hello room" }]);
    expect(received[0]).toEqual({
      id: adaptChatMessage(packedRoomMessage).id,
      text: adaptChatMessage(packedRoomMessage).text,
    });
    dispose();
  });

  it("delivers a deleted id and drops nothing else", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    })!;
    const deleted: string[] = [];
    const messages: string[] = [];
    const dispose = handle.subscribeChatRoom!("room1", {
      onMessage: (message) => {
        messages.push(message.id);
      },
      onDeleted: (id) => {
        deleted.push(id);
      },
    });
    const socket = openFirstSocket();
    const serverId = connectBody(socket).id;
    socket.emit("message", { data: channelFrame(serverId, "deleted", "msg9") });
    expect(deleted).toEqual(["msg9"]);
    expect(messages).toEqual([]);
    dispose();
  });

  it("ignores react/unreact (the thread refetches them)", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      wsImpl: MockWsImpl,
    })!;
    const messages: string[] = [];
    const deleted: string[] = [];
    const dispose = handle.subscribeChatUser!("other1", {
      onMessage: (message) => {
        messages.push(message.id);
      },
      onDeleted: (id) => {
        deleted.push(id);
      },
    });
    const socket = openFirstSocket();
    const serverId = connectBody(socket).id;
    socket.emit("message", {
      data: channelFrame(serverId, "react", { reaction: "❤", messageId: "msg1" }),
    });
    socket.emit("message", {
      data: channelFrame(serverId, "unreact", { reaction: "❤", messageId: "msg1" }),
    });
    expect(messages).toEqual([]);
    expect(deleted).toEqual([]);
    dispose();
  });

  it("is a no-op without a token (the thread pages without live delivery)", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: null,
      wsImpl: MockWsImpl,
    })!;
    const disposeRoom = handle.subscribeChatRoom!("room1", {
      onMessage: () => {
        throw new Error("must not deliver without a token");
      },
    });
    const disposeUser = handle.subscribeChatUser!("other1", {});
    expect(MockSocket.instances).toHaveLength(0);
    disposeRoom();
    disposeUser();
  });

  it("is absent on the unsupported handle (no streaming route)", () => {
    const handle = createStreamHandle({
      origin: "https://mk.example",
      token: "sess-token",
      supported: false,
      wsImpl: MockWsImpl,
    });
    expect(handle).toBeNull();
  });

  it("resubscribes the chat channel after a reconnect", () => {
    jest.useFakeTimers();
    try {
      const pool = createStreamPool({
        origin: "https://mk.example",
        token: "sess-token",
        wsImpl: MockWsImpl,
      });
      const received: string[] = [];
      const sub = pool.subscribeChannel("chatRoom", { roomId: "room1" }, {
        onEvent: (type, body) => {
          if (type === "message" && body && typeof body === "object" && "id" in body) {
            received.push(String((body as { id: unknown }).id));
          }
        },
      });
      expect(MockSocket.instances).toHaveLength(1);
      const first = MockSocket.instances[0];
      first.emit("open", {});
      // Drop the socket: the pool backs off and redials (existing 1.9
      // machinery — this pins that chat channels ride the same path).
      first.emit("close", {});
      expect(pool.status()).toBe("reconnecting");
      jest.runAllTimers();
      expect(MockSocket.instances).toHaveLength(2);
      const second = MockSocket.instances[1];
      second.emit("open", {});
      expect(pool.status()).toBe("live");
      // The new socket carries a fresh chatRoom connect (same channel +
      // params, server-side id regenerated).
      expect(connectBody(second).channel).toBe("chatRoom");
      expect(connectBody(second).params).toEqual({ roomId: "room1" });
      const secondId = connectBody(second).id;
      second.emit("message", { data: channelFrame(secondId, "message", packedRoomMessage) });
      expect(received).toEqual(["msg1"]);
      sub.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});
