// No stream URL in logs (repair X2.3, networking L5): the Misskey
// `/streaming?i=` URL carries the token, so neither stream client may log
// it — and a grep test pins that no `console`/logger call exists in
// either file to regress through.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStreamHandle, streamUrlFor } from "../src/misskey/stream";
import type { StreamSocket } from "../src/misskey/stream";
import { createStreamHandle as createMastodonStreamHandle, streamUrl } from "../src/mastodon/stream";
import { redactUrl } from "../src/core/redact";

const MISSKEY_ORIGIN = "https://mk.example";
const MASTO_ORIGIN = "https://mastodon.example";
const TOKEN = "tok-secret-123";

type Listener = (ev: { data?: unknown }) => void;

class MockSocket implements StreamSocket {
  static readonly OPEN = 1;
  readonly readyState = MockSocket.OPEN;
  url: string;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
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

describe("stream URLs never reach logs", () => {
  it("a redacted stream URL carries no token (the helper the clients use)", () => {
    const redacted = redactUrl(streamUrlFor(MISSKEY_ORIGIN, TOKEN));
    expect(redacted).toBe("wss://mk.example/streaming?[redacted]");
    expect(redacted).not.toContain(TOKEN);
  });

  it("misskey pool activity logs nothing containing the token", () => {
    const seen: unknown[][] = [];
    const methods = ["debug", "log", "warn", "error"] as const;
    const spies = methods.map((m) => jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      seen.push(args);
    }));
    try {
      const pool = createStreamHandle({
        origin: MISSKEY_ORIGIN,
        token: TOKEN,
        wsImpl: MockWsImpl,
      })!;
      const sub = pool.subscribeTimeline({ kind: "global" }, () => undefined);
      sub.unsubscribe();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const flat = seen.flat().map(String).join("\n");
    expect(flat).not.toContain(TOKEN);
    expect(flat).not.toContain("?i=");
  });

  it("mastodon factory failure reads unavailable, and the factory URL redacts cleanly", () => {
    const realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = class {
      constructor() {
        throw new Error("no socket here");
      }
    };
    try {
      const handle = createMastodonStreamHandle(MASTO_ORIGIN, { token: TOKEN });
      expect(handle).not.toBeNull();
      // The factory throw is owned by the state machine, not the caller:
      // the entry reads "unavailable" (polling fallback, never an error —
      // the module's documented contract) instead of throwing. The
      // redaction contract is therefore pinned on the exact URL the
      // factory builds, through the helper the factory uses.
      const sub = handle!.subscribeTimeline({ kind: "home" }, () => undefined);
      expect(sub.status()).toBe("unavailable");
      expect(handle!.status()).toBe("unavailable");
      const built = streamUrl(MASTO_ORIGIN, "user", {});
      expect(built).toBe("wss://mastodon.example/api/v1/streaming?stream=user");
      expect(redactUrl(built)).toBe("wss://mastodon.example/api/v1/streaming?[redacted]");
      expect(redactUrl(built)).not.toContain(TOKEN);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = realWebSocket;
    }
  });

  it("grep: neither stream client has a console/logger sink for URLs", () => {
    for (const file of ["../src/mastodon/stream.ts", "../src/misskey/stream.ts"]) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/logger\s*\(/);
    }
  });
});
