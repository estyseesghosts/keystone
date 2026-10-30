// P6.5: server-authoritative unread notification count — Mastodon
// `GET /api/v1/notifications/unread_count` ({count}) and Misskey `i`
// (`unreadNotificationsCount`). Absence is the typed unsupported state
// (the UI's presence-dot fallback); malformed bodies are shape errors,
// never 0; auth failures propagate untouched.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import { MastoHttpError } from "../src/mastodon/client";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import { createMastodonBackend } from "../src/mastodon/backend";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { ApiError } from "../src/core/errors";

function mastodonClient(
  handler: (method: string, path: string) => { status?: number; data?: unknown } | never,
): MastoClient {
  const respond = (method: string, path: string, body?: unknown): RequestResult<never> => {
    const out = handler(method, path);
    void body;
    return { status: out.status ?? 200, data: out.data as never, headers: new Headers() };
  };
  return {
    origin: "https://mastodon.example",
    token: "t",
    get: async (path, _q, _o) => respond("GET", path),
    post: async (path, body, _o) => respond("POST", path, body),
    put: async (path, body, _o) => respond("PUT", path, body),
    patch: async (path, body, _o) => respond("PATCH", path, body),
    delete: async (path, body, _o) => respond("DELETE", path, body),
    postForm: async (path, body, _o) => respond("POST", path, body),
    postFormData: async (path, body, _o) => respond("POST", path, body),
    patchFormData: async (path, body, _o) => respond("PATCH", path, body),
  };
}

function absent(status: 404 | 405): never {
  throw new MastoHttpError({
    message: status === 404 ? "Not found" : "Method not allowed",
    status,
    kind: "http",
    origin: "https://mastodon.example",
    method: "GET",
    path: "/api/v1/notifications/unread_count",
  });
}

function misskeyTransport(i: unknown): MisskeyTransport {
  return {
    call<T>(): Promise<T> {
      return Promise.resolve(i as T);
    },
    upload<T>(): Promise<T> {
      throw new Error("no upload in this test");
    },
  };
}

describe("notificationsUnreadCount (P6.5)", () => {
  it("Mastodon parses {count}", async () => {
    const backend = createMastodonBackend(
      mastodonClient(() => ({ data: { count: 7 } })),
    );
    await expect(backend.notificationsUnreadCount!()).resolves.toBe(7);
  });

  it("Mastodon 404 and 405 become the typed unsupported state", async () => {
    for (const status of [404, 405] as const) {
      const backend = createMastodonBackend(mastodonClient(() => absent(status)));
      const err = await backend.notificationsUnreadCount!().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("errors.unsupported.notification_unread_count");
    }
  });

  it("Mastodon 401 propagates as auth (never unsupported)", async () => {
    const backend = createMastodonBackend(
      mastodonClient(() => {
        throw new MastoHttpError({
          message: "Unauthorized",
          status: 401,
          kind: "http",
          origin: "https://mastodon.example",
          method: "GET",
          path: "/api/v1/notifications/unread_count",
        });
      }),
    );
    const err = await backend.notificationsUnreadCount!().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).not.toBe("errors.unsupported.notification_unread_count");
  });

  it("Misskey returns the i count (0 and 3 both fine)", async () => {
    for (const count of [0, 3]) {
      const backend = createMisskeyBackend(misskeyTransport({ unreadNotificationsCount: count }));
      await expect(backend.notificationsUnreadCount!()).resolves.toBe(count);
    }
  });

  it("Misskey absent field becomes the typed unsupported state", async () => {
    const backend = createMisskeyBackend(misskeyTransport({}));
    const err = await backend.notificationsUnreadCount!().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("errors.unsupported.notification_unread_count");
  });

  it("malformed counts are shape errors, never 0", async () => {
    // Mastodon: string / negative / missing count.
    for (const data of [{ count: "3" }, { count: -1 }, {}, null]) {
      const backend = createMastodonBackend(mastodonClient(() => ({ data })));
      const err = await backend.notificationsUnreadCount!().catch((e: unknown) => e);
      expect((err as { code?: unknown }).code).toBe("errors.shape.notificationUnreadCount");
    }
    // Misskey: string / NaN map to unsupported (absent-or-unusable count).
    for (const i of [{ unreadNotificationsCount: "3" }, { unreadNotificationsCount: NaN }]) {
      const backend = createMisskeyBackend(misskeyTransport(i));
      const err = await backend.notificationsUnreadCount!().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("errors.unsupported.notification_unread_count");
    }
  });
});
