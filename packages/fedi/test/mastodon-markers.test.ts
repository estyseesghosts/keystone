// Notification read state via markers (repair X4.4 finding 9): the
// backend reads `GET /api/v1/markers` and derives `read` per row (flat
// rows by id, v2 groups by `most_recent_notification_id`); a server
// without markers answers unknown, never an inert control —
// `markNotificationsRead` then throws the typed unsupported state the
// screen renders as its honest reason.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MastoHttpError } from "../src/mastodon/client";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { markerCoversId } from "../src/mastodon/adapt";
import { createMastodonBackend } from "../src/mastodon/backend";
import { ApiError } from "../src/core/errors";
import type { Account, Notification as WireNotification, Status } from "../src/mastodon/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const markersBody = fixture<{ notifications: { last_read_id: string } }>(
  "mastodon",
  "markers.json",
);
const flatRow = fixture<WireNotification>("mastodon", "notification.json");
const account = fixture<Account>("mastodon", "account.json");
const status = fixture<Status>("mastodon", "status.json");

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
}

type Handler = (
  method: string,
  path: string,
  query?: unknown,
) => { status?: number; data?: unknown } | never;

function stubClient(handler: Handler, token: string | null = "t"): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = (
    method: string,
    path: string,
    body?: unknown,
  ): RequestResult<never> => {
    calls.push({ method, path, body });
    const out = handler(method, path, body);
    return {
      status: out.status ?? 200,
      data: out.data as never,
      headers: new Headers(),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token,
    get: (path, query, _o) => Promise.resolve(respond("GET", path, query)),
    post: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    put: (path, body, _o) => Promise.resolve(respond("PUT", path, body)),
    patch: (path, body, _o) => Promise.resolve(respond("PATCH", path, body)),
    delete: (path, body, _o) => Promise.resolve(respond("DELETE", path, body)),
    postForm: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    postFormData: (path, body, _o) => Promise.resolve(respond("POST", path, body)),
    patchFormData: (path, body, _o) => Promise.resolve(respond("PATCH", path, body)),
  };
  return { client, calls };
}

function absent(method: string, path: string): never {
  void method;
  void path;
  throw new MastoHttpError({
    message: "Not found",
    status: 404,
    kind: "http",
    origin: "https://mastodon.example",
  });
}

function flatRows(): WireNotification[] {
  const older: WireNotification = {
    ...flatRow,
    id: "300",
    type: "favourite",
    account,
    status,
  };
  const newer: WireNotification = {
    ...flatRow,
    id: "320",
    type: "favourite",
    account,
    status,
  };
  const unorderable: WireNotification = {
    ...flatRow,
    id: "tag:example,x:1",
    type: "favourite",
    account,
    status,
  };
  return [newer, older, unorderable];
}

describe("markerCoversId", () => {
  it("covers ids at or behind the marker (same-length digit strings)", () => {
    expect(markerCoversId("310", "300")).toBe(true);
    expect(markerCoversId("310", "310")).toBe(true);
    expect(markerCoversId("310", "320")).toBe(false);
  });

  it("answers null for unorderable pairs, never a guess", () => {
    expect(markerCoversId(null, "300")).toBeNull();
    expect(markerCoversId("310", null)).toBeNull();
    expect(markerCoversId("", "300")).toBeNull();
    expect(markerCoversId("310", "tag:example,x:1")).toBeNull();
    expect(markerCoversId("v2-group-key", "300")).toBeNull();
    // Different lengths are different id schemes: never ordered.
    expect(markerCoversId("310", "0300")).toBeNull();
  });
});

describe("notifications() read derivation (v1 flat)", () => {
  it("derives read per row from the markers position", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/markers") return { data: markersBody };
      if (path === "/api/v2/notifications") return { data: {} };
      if (path === "/api/v1/notifications") return { data: flatRows() };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const page = await backend.notifications({ limit: 20 });
    expect(calls.some((c) => c.path === "/api/v1/markers")).toBe(true);
    const byId = new Map(page.items.map((n) => [n.id, n.read]));
    expect(byId.get("320")).toBe(false);
    expect(byId.get("300")).toBe(true);
    expect(byId.get("tag:example,x:1")).toBeNull();
  });

  it("reads unknown when the server has no markers, without failing the page", async () => {
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/markers") return absent(method, path);
      if (path === "/api/v2/notifications") return { data: {} };
      if (path === "/api/v1/notifications") return { data: flatRows() };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const page = await backend.notifications({ limit: 20 });
    expect(page.items.length).toBe(3);
    for (const item of page.items) expect(item.read).toBeNull();
  });

  it("reads unknown when markers fail, but still returns the page", async () => {
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/markers") {
        throw new MastoHttpError({
          message: "Server error",
          status: 500,
          kind: "http",
          origin: "https://mastodon.example",
        });
      }
      if (path === "/api/v2/notifications") return { data: {} };
      if (path === "/api/v1/notifications") return { data: flatRows() };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const page = await backend.notifications({ limit: 20 });
    expect(page.items.length).toBe(3);
    for (const item of page.items) expect(item.read).toBeNull();
  });

  it("propagates an auth refusal from markers instead of masking it", async () => {
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/markers") {
        throw new MastoHttpError({
          message: "Unauthorized",
          status: 401,
          kind: "http",
          origin: "https://mastodon.example",
        });
      }
      if (path === "/api/v2/notifications") return { data: {} };
      if (path === "/api/v1/notifications") return { data: flatRows() };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    await expect(backend.notifications({ limit: 20 })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("notifications() read derivation (v2 groups)", () => {
  it("derives group read from most_recent_notification_id, not the group key", async () => {
    const v2 = fixture<{
      accounts: unknown[];
      statuses: unknown[];
      notification_groups: unknown[];
    }>("mastodon", "notification-grouped-v2.json");
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/markers") return { data: markersBody };
      if (path === "/api/v2/notifications") return { data: v2 };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const page = await backend.notifications({ limit: 20 });
    // last_read_id "310": groups at 312 and 320 are newer (unread), and
    // the group key itself ("favourite-100") is never ordered.
    const byId = new Map(page.items.map((n) => [n.id, n]));
    expect(byId.get("favourite-100")?.read).toBe(false);
    expect(byId.get("favourite-100")?.ext.mostRecentNotificationId).toBe("312");
    expect(byId.get("follow-5")?.read).toBe(false);
  });

  it("marks groups read when the marker covers their most recent id", async () => {
    const v2 = fixture<{
      accounts: unknown[];
      statuses: unknown[];
      notification_groups: unknown[];
    }>("mastodon", "notification-grouped-v2.json");
    const { client } = stubClient((method, path) => {
      if (path === "/api/v1/markers") {
        return { data: { notifications: { last_read_id: "999" } } };
      }
      if (path === "/api/v2/notifications") return { data: v2 };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const page = await backend.notifications({ limit: 20 });
    for (const item of page.items) expect(item.read).toBe(true);
  });
});

describe("markNotificationsRead without markers", () => {
  it("throws the typed unsupported state on a marker-less server", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/notifications") return { data: flatRows().slice(0, 1) };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    const err = await backend.markNotificationsRead().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("errors.unsupported.markers");
    expect(calls.some((c) => c.path === "/api/v1/markers")).toBe(true);
  });

  it("posts the newest id as the marker where markers exist", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/notifications") return { data: flatRows().slice(0, 2) };
      if (path === "/api/v1/markers") return { data: {} };
      return absent(method, path);
    });
    const backend = createMastodonBackend(client);
    await backend.markNotificationsRead();
    expect(calls).toContainEqual({
      method: "POST",
      path: "/api/v1/markers",
      body: { notifications: { last_read_id: "320" } },
    });
  });
});
