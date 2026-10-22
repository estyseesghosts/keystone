// Clickstone §1.12 Mastodon-family announcements:
//   GET  /api/v1/announcements          → published list, `read` only authed
//   POST /api/v1/announcements/:id/dismiss → AnnouncementMute (empty body)
// Verifies the request shapes, the adaptation (HTML content, no title,
// starts/ends/all_day, read tri-state) and the 404 → honest unsupported
// path a fork without the routes produces. Transport stubbed — no network.

import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestOptions, RequestResult } from "../src/mastodon/client";
import { ApiError } from "../src/core/errors";
import { isUnsupportedError } from "../src/misskey/client";

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  opts?: RequestOptions;
}

type Responder = (
  method: string,
  path: string,
  body: unknown,
) => { data?: unknown; headers?: Headers; status?: number } | never;

function stubClient(respond: Responder): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run = async (
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResult<never>> => {
    calls.push({ method, path, body, opts });
    const out = respond(method, path, body);
    return {
      status: out.status ?? 200,
      data: out.data as never,
      headers: out.headers ?? new Headers(),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
    get: (path, query, opts) => run("GET", path, query, opts),
    post: (path, body, opts) => run("POST", path, body, opts),
    put: (path, body, opts) => run("PUT", path, body, opts),
    patch: (path, body, opts) => run("PATCH", path, body, opts),
    delete: (path, body, opts) => run("DELETE", path, body, opts),
    postForm: (path, body, opts) => run("POST", path, body, opts),
    postFormData: (path, body, opts) => run("POST", path, body, opts),
    patchFormData: (path, body, opts) => run("PATCH", path, body, opts),
  };
  return { client, calls };
}

function absent(status = 404): never {
  throw new ApiError(`HTTP ${status}`, status);
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "3",
  content: "<p>Server maintenance <strong>tonight</strong>.</p>",
  starts_at: "2026-10-20T22:00:00.000Z",
  ends_at: null,
  all_day: false,
  published_at: "2026-10-20T10:00:00.000Z",
  updated_at: "2026-10-20T10:00:00.000Z",
  read: false,
  reactions_allowed: true,
  mentions: [],
  statuses: [],
  tags: [],
  emojis: [],
  reactions: [],
  ...overrides,
});

describe("MastodonBackend announcements", () => {
  it("lists GET /api/v1/announcements and adapts the rows", async () => {
    const { client, calls } = stubClient(() => ({ data: [row()] }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });

    const items = await backend.announcements!.list();

    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v1/announcements" });
    expect(items).toEqual([
      {
        id: "3",
        // Mastodon announcements carry no title/severity/image.
        title: null,
        content: {
          html: "<p>Server maintenance <strong>tonight</strong>.</p>",
          plain: "Server maintenance tonight.",
        },
        createdAt: "2026-10-20T10:00:00.000Z",
        updatedAt: "2026-10-20T10:00:00.000Z",
        imageUrl: null,
        icon: null,
        needConfirmationToRead: false,
        startsAt: "2026-10-20T22:00:00.000Z",
        endsAt: null,
        allDay: false,
        isRead: false,
      },
    ]);
  });

  it("keeps the read flag tri-state: true, false, and null when unreported", async () => {
    const stub = stubClient(() => ({
      data: [row({ id: "1", read: true }), row({ id: "2", read: false }), row({ id: "3", read: null })],
    }));
    const items = await createMastodonBackend(stub.client, { flavor: "mastodon" }).announcements!.list();
    expect(items.map(i => i.isRead)).toEqual([true, false, null]);
  });

  it("dismisses through POST /api/v1/announcements/:id/dismiss with an encoded id", async () => {
    const { client, calls } = stubClient(() => ({ status: 200 }));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });

    await backend.announcements!.dismiss!("3");

    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/announcements/3/dismiss",
    });

    await backend.announcements!.dismiss!("a/b");
    expect(calls[1].path).toBe("/api/v1/announcements/a%2Fb/dismiss");
  });

  it("maps a 404 list to the honest unsupported state", async () => {
    const { client } = stubClient(() => absent(404));
    const backend = createMastodonBackend(client, { flavor: "akkoma" });
    let caught: unknown = null;
    try {
      await backend.announcements!.list();
    } catch (err) {
      caught = err;
    }
    expect(isUnsupportedError(caught)).toBe(true);
  });

  it("maps a 404 dismiss to the same unsupported state (fork without the route)", async () => {
    const { client } = stubClient(() => absent(405));
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    let caught: unknown = null;
    try {
      await backend.announcements!.dismiss!("3");
    } catch (err) {
      caught = err;
    }
    expect(isUnsupportedError(caught)).toBe(true);
  });

  it("sends no params: the published list is the whole answer (no paging)", async () => {
    const { client, calls } = stubClient(() => ({ data: [] }));
    await createMastodonBackend(client, { flavor: "mastodon" }).announcements!.list({
      limit: 5,
    });
    expect(calls[0].body).toBeUndefined();
  });
});

describe("mastodon announcements capability", () => {
  it("is supported on mastodon/akkoma/pleroma", () => {
    for (const flavor of ["mastodon", "akkoma", "pleroma"] as const) {
      const { client } = stubClient(() => ({ data: [] }));
      const backend = createMastodonBackend(client, { flavor });
      expect(backend.capabilities.announcements).toBe("supported");
      expect(backend.announcements).toBeDefined();
    }
  });
});
