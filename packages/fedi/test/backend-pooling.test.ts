// Repair X3.4 (networking M5/M6): backend + stream-handle pooling and the
// validated streaming-origin wiring. Fake sockets only — no network.
import { backendForSession, clearBackendRegistry, sessionBackendKey } from "../src/api/client";
import type { Session } from "../src/core/sessions";
import type { DetectionEvidence } from "../src/core/detect";
import { streamingEvidenceFor } from "../src/mastodon/instance";

/** Dual socket mock: constructor form (global WebSocket) + event-listener
 * form (Misskey `StreamSocket`) in one class. */
class DualSocket {
  static instances: DualSocket[] = [];
  static readonly OPEN = 1;
  readonly readyState = DualSocket.OPEN;
  url: string;
  protocols: string[] | undefined;
  closed = false;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown } | unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  listeners = new Map<string, Array<(ev: { data?: unknown }) => void>>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols =
      protocols === undefined ? undefined : Array.isArray(protocols) ? protocols : [protocols];
    DualSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.({});
    for (const fn of this.listeners.get("close") ?? []) fn({});
  }

  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  fireOpen(): void {
    this.onopen?.({});
    for (const fn of this.listeners.get("open") ?? []) fn({});
  }
}

function misskeySession(over: Partial<Session> = {}): Session {
  return {
    id: "https://mk-pool.example alice",
    origin: "https://mk-pool.example",
    family: "misskey",
    flavor: "misskey",
    accountId: "alice",
    token: "pool-token",
    grant: "password",
    hosting: "third-party",
    ...over,
  };
}

function mastodonSession(over: Partial<Session> = {}): Session {
  return {
    id: "https://m-pool.example alice",
    origin: "https://m-pool.example",
    family: "mastodon",
    flavor: "mastodon",
    accountId: "alice",
    token: "pool-token",
    grant: "oauth-pkce",
    hosting: "third-party",
    ...over,
  };
}

let realWebSocket: unknown;
beforeEach(() => {
  clearBackendRegistry();
  DualSocket.instances = [];
  realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = DualSocket;
});
afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = realWebSocket;
});

describe("backend registry (M6)", () => {
  it("returns the same backend for the same session identity", () => {
    const a = misskeySession();
    const b = misskeySession();
    expect(a).not.toBe(b); // distinct objects ...
    expect(backendForSession(a)).toBe(backendForSession(b)); // ... one backend
  });

  it("keys on token, family, flavor, and evidence", () => {
    const base = misskeySession();
    const pooled = backendForSession(base);
    expect(backendForSession({ ...base, token: "rotated" })).not.toBe(pooled);
    expect(backendForSession({ ...base, flavor: "sharkey" })).not.toBe(pooled);
    expect(
      backendForSession({ ...base, evidence: { nodeinfoName: "sharkey" } }),
    ).not.toBe(pooled);
  });

  it("sessionBackendKey is stable over evidence key order", () => {
    const a = sessionBackendKey(
      misskeySession({ evidence: ({ a: 1, b: { c: [1, 2], d: "x" } }) as unknown as DetectionEvidence }),
    );
    const b = sessionBackendKey(
      misskeySession({ evidence: ({ b: { d: "x", c: [1, 2] }, a: 1 }) as unknown as DetectionEvidence }),
    );
    expect(a).toBe(b);
  });

  it("backend.stream() returns the shared handle (one socket per session)", () => {
    const backend = backendForSession(misskeySession());
    const first = backend.stream();
    expect(first).not.toBeNull();
    expect(backend.stream()).toBe(first);
    const unsubA = first!.subscribeTimeline({ kind: "home" }, () => undefined);
    const unsubB = first!.subscribeTimeline({ kind: "local" }, () => undefined);
    expect(DualSocket.instances).toHaveLength(1);
    expect(DualSocket.instances[0].url).toBe("wss://mk-pool.example/streaming?i=pool-token");
    unsubA.unsubscribe();
    unsubB.unsubscribe();
  });

  it("mastodon backend.stream() shares one socket across subscriptions", () => {
    const backend = backendForSession(mastodonSession());
    const first = backend.stream();
    expect(first).not.toBeNull();
    expect(backend.stream()).toBe(first);
    const unsubA = first!.subscribeTimeline({ kind: "home" }, () => undefined);
    const offB = first!.onNotification(() => undefined);
    expect(DualSocket.instances).toHaveLength(1);
    expect(DualSocket.instances[0].protocols).toEqual(["Bearer", "pool-token"]);
    unsubA.unsubscribe();
    offB();
  });
});

describe("streaming origin wiring (M5)", () => {
  it("dials the validated split-host origin from the session evidence", () => {
    // Spread (not an inline literal): the X2.3 evidence shape rides on the
    // session until `DetectionEvidence` is widened by its owner.
    const evidence = {
      ...streamingEvidenceFor("https://m-pool.example", "wss://stream.m-pool.example"),
    } as unknown as DetectionEvidence;
    const backend = backendForSession(mastodonSession({ evidence }));
    const handle = backend.stream();
    expect(handle).not.toBeNull();
    const sub = handle!.subscribeTimeline({ kind: "home" }, () => undefined);
    // The old code ignored the evidence and always dialed the REST host.
    expect(DualSocket.instances).toHaveLength(1);
    expect(new URL(DualSocket.instances[0].url).host).toBe("stream.m-pool.example");
    expect(DualSocket.instances[0].url).toBe(
      "wss://stream.m-pool.example/api/v1/streaming?stream=user",
    );
    expect(DualSocket.instances[0].url).not.toContain("access_token");
    sub.unsubscribe();
  });

  it("falls back to the session origin without evidence", () => {
    const backend = backendForSession(mastodonSession());
    const sub = backend.stream()!.subscribeTimeline({ kind: "home" }, () => undefined);
    expect(DualSocket.instances[0].url).toBe(
      "wss://m-pool.example/api/v1/streaming?stream=user",
    );
    sub.unsubscribe();
  });
});
