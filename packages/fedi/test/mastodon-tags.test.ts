// Clickstone §1.4 mastodon data layer — hashtag follow/feature.
//
// Pins the endpoint shapes against the verified Mastodon source (paths in
// the session log, not here), with stubbed transports — no network:
// - GET  /api/v1/tags/:id            → TagInfo (following/featuring may be
//   unknown = null, never fabricated as false)
// - POST /api/v1/tags/:id/follow     → follow
// - POST /api/v1/tags/:id/unfollow   → unfollow
// - GET  /api/v1/followed_tags       → Link-paged TagInfo
// - GET  /api/v1/featured_tags       → FeaturedTag rows (string counts)
// - POST /api/v1/tags/:id/feature    → pin; 404/405 falls back to
//   POST /api/v1/featured_tags {name} (older Mastodon)
// - POST /api/v1/tags/:id/unfeature  → unpin; 404/405 falls back to
//   GET /featured_tags + DELETE /featured_tags/:id
// - Akkoma/Pleroma: the feature surface is absent (no such endpoints), so
//   those members stay undefined while follow/unfollow remain.
// - Tag MUTE has no endpoint on either server: nothing is invented here.

import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestOptions, RequestResult } from "../src/mastodon/client";
import { ApiError, FediError } from "../src/core/errors";
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
  };
  return { client, calls };
}

function absent(status = 404): never {
  throw new ApiError(`HTTP ${status}`, status);
}

const tag = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "cats",
  url: "https://mastodon.example/tags/cats",
  history: [],
  following: false,
  featuring: false,
  ...overrides,
});

describe("P6.1 tags — tag state (GET /api/v1/tags/:id)", () => {
  it("reads follow/feature state and URL from the authed tag body", async () => {
    const { client, calls } = stubClient(() => ({
      data: tag({ following: true, featuring: true }),
    }));
    const info = await createMastodonBackend(client).tags!.show!("cats");
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/tags/cats", body: undefined, opts: undefined },
    ]);
    expect(info).toEqual({
      name: "cats",
      url: "https://mastodon.example/tags/cats",
      following: true,
      featuring: true,
    });
  });

  it("encodes non-ASCII tag names in the path", async () => {
    const { client, calls } = stubClient(() => ({ data: tag({ name: "Café" }) }));
    await createMastodonBackend(client).tags!.show!("Café");
    expect(calls[0]!.path).toBe("/api/v1/tags/Caf%C3%A9");
  });

  it("keeps unreported follow/feature flags null (unknown, not false)", async () => {
    const { client } = stubClient(() => ({
      data: { name: "cats", url: "https://mastodon.example/tags/cats" },
    }));
    const info = await createMastodonBackend(client).tags!.show!("cats");
    expect(info.following).toBeNull();
    expect(info.featuring).toBeNull();
    expect(info.url).toBe("https://mastodon.example/tags/cats");
  });

  it("throws a shape error on a malformed tag body", async () => {
    const { client } = stubClient(() => ({ data: { url: "x" } }));
    await expect(createMastodonBackend(client).tags!.show!("cats")).rejects.toBeInstanceOf(
      FediError,
    );
  });

  it("surfaces a 404 as the honest unsupported state (fork has no tag row)", async () => {
    const { client } = stubClient(() => absent(404));
    const err = await createMastodonBackend(client)
      .tags!.show!("never-seen")
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isUnsupportedError(err)).toBe(true);
  });
});

describe("P6.1 tags — follow/unfollow wire shapes", () => {
  it("sends POST /api/v1/tags/:id/follow with no body", async () => {
    const { client, calls } = stubClient(() => ({ data: tag({ following: true }) }));
    await createMastodonBackend(client).tags!.follow("cats");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/tags/cats/follow", body: undefined, opts: undefined },
    ]);
  });

  it("sends POST /api/v1/tags/:id/unfollow with no body", async () => {
    const { client, calls } = stubClient(() => ({ data: tag({ following: false }) }));
    await createMastodonBackend(client).tags!.unfollow("cats");
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/tags/cats/unfollow", body: undefined, opts: undefined },
    ]);
  });
});

describe("P6.1 tags — followed tags listing", () => {
  it("pages GET /api/v1/followed_tags through the Link header", async () => {
    const { client, calls } = stubClient((method, path) =>
      path === "/api/v1/followed_tags"
        ? {
            data: [tag(), tag({ id: "t2", name: "dogs", following: true })],
            headers: new Headers({
              Link: '<https://mastodon.example/api/v1/followed_tags?max_id=9>; rel="next"',
            }),
          }
        : { data: [tag({ id: "t3", name: "birds" })] },
    );
    const backend = createMastodonBackend(client);
    const first = await backend.tags!.followed();
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/api/v1/followed_tags",
      body: { limit: 80 },
    });
    expect(first.items.map((t) => t.name)).toEqual(["cats", "dogs"]);
    expect(first.end).toBe(false);
    const second = await backend.tags!.followed({ cursor: first.cursor });
    expect(calls[1]!.path).toBe(
      "https://mastodon.example/api/v1/followed_tags?max_id=9",
    );
    expect(second.items.map((t) => t.name)).toEqual(["birds"]);
    expect(second.end).toBe(true);
  });

  it("reads an empty page as the end (contract §5), never a length guess", async () => {
    const { client } = stubClient(() => ({ data: [] }));
    const page = await createMastodonBackend(client).tags!.followed();
    expect(page.items).toEqual([]);
    expect(page.cursor).toBeNull();
    expect(page.end).toBe(true);
  });

  it("rejects a non-list body instead of reporting zero followed tags", async () => {
    const { client } = stubClient(() => ({ data: { error: "nope" } }));
    await expect(createMastodonBackend(client).tags!.followed()).rejects.toBeInstanceOf(FediError);
  });
});

describe("P6.1 tags — featured tags (pin/unpin)", () => {
  it("adapts GET /api/v1/featured_tags rows (string count, ISO day)", async () => {
    const { client, calls } = stubClient(() => ({
      data: [
        {
          id: "ft1",
          name: "cats",
          url: "https://mastodon.example/@alice/tagged/cats",
          statuses_count: "12",
          last_status_at: "2026-10-20",
        },
        { id: "ft2", name: "dogs", statuses_count: "nope" },
      ],
    }));
    const rows = await createMastodonBackend(client).tags!.featured!();
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/v1/featured_tags",
      body: undefined,
      opts: undefined,
    });
    expect(rows).toEqual([
      {
        id: "ft1",
        name: "cats",
        statusesCount: 12,
        lastStatusAt: "2026-10-20",
      },
      { id: "ft2", name: "dogs", statusesCount: null, lastStatusAt: null },
    ]);
  });

  it("pins via POST /api/v1/tags/:id/feature", async () => {
    const { client, calls } = stubClient(() => ({ data: tag({ featuring: true }) }));
    await createMastodonBackend(client).tags!.feature!("cats");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/tags/cats/feature",
        body: undefined,
        opts: undefined,
      },
    ]);
  });

  it("falls back to POST /api/v1/featured_tags {name} on 404 (older Mastodon)", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/tags/cats/feature") return absent(404);
      return { data: { id: "ft1", name: "cats" } };
    });
    await createMastodonBackend(client).tags!.feature!("cats");
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/api/v1/tags/cats/feature", undefined],
      ["POST", "/api/v1/featured_tags", { name: "cats" }],
    ]);
  });

  it("does not fall back on a permission refusal (403 is not absence)", async () => {
    const { client, calls } = stubClient(() => absent(403));
    await expect(createMastodonBackend(client).tags!.feature!("cats")).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toHaveLength(1);
  });

  it("unpins via POST /api/v1/tags/:id/unfeature", async () => {
    const { client, calls } = stubClient(() => ({ data: tag({ featuring: false }) }));
    await createMastodonBackend(client).tags!.unfeature!("cats");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/tags/cats/unfeature",
        body: undefined,
        opts: undefined,
      },
    ]);
  });

  it("falls back to DELETE /api/v1/featured_tags/:id on 404, matched by name", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/tags/cats/unfeature") return absent(404);
      if (path === "/api/v1/featured_tags") {
        return {
          data: [
            { id: "ft1", name: "dogs" },
            { id: "ft2", name: "Cats" },
          ],
        };
      }
      return {};
    });
    await createMastodonBackend(client).tags!.unfeature!("cats");
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/v1/tags/cats/unfeature"],
      ["GET", "/api/v1/featured_tags"],
      ["DELETE", "/api/v1/featured_tags/ft2"],
    ]);
  });

  it("no-ops the fallback when the tag is not actually featured", async () => {
    const { client, calls } = stubClient((method, path) => {
      if (path === "/api/v1/tags/cats/unfeature") return absent(404);
      return { data: [{ id: "ft1", name: "dogs" }] };
    });
    await expect(
      createMastodonBackend(client).tags!.unfeature!("cats"),
    ).resolves.toBeUndefined();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("deletes a featured tag by row id", async () => {
    const { client, calls } = stubClient(() => ({}));
    await createMastodonBackend(client).tags!.deleteFeatured!("ft1");
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: "/api/v1/featured_tags/ft1",
        body: undefined,
        opts: undefined,
      },
    ]);
  });
});

describe("P6.1 tags — fork capability (Akkoma/Pleroma)", () => {
  it("keeps follow/unfollow but leaves the feature surface undefined", async () => {
    const { client } = stubClient(() => ({ data: tag() }));
    const tags = createMastodonBackend(client, { flavor: "akkoma" }).tags!;
    expect(typeof tags.follow).toBe("function");
    expect(typeof tags.unfollow).toBe("function");
    expect(typeof tags.show).toBe("function");
    expect(tags.featured).toBeUndefined();
    expect(tags.feature).toBeUndefined();
    expect(tags.unfeature).toBeUndefined();
    expect(tags.deleteFeatured).toBeUndefined();
  });

  it("offers the feature surface on vanilla mastodon and unknown flavors", () => {
    const { client } = stubClient(() => ({ data: tag() }));
    for (const flavor of ["mastodon", "unknown"] as const) {
      const tags = createMastodonBackend(client, { flavor }).tags!;
      expect(typeof tags.featured).toBe("function");
      expect(typeof tags.feature).toBe("function");
    }
  });

  it("has no mute method at all — neither server exposes one", () => {
    const { client } = stubClient(() => ({ data: tag() }));
    const tags = createMastodonBackend(client).tags!;
    expect((tags as unknown as Record<string, unknown>).mute).toBeUndefined();
  });
});
