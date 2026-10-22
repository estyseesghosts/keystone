// Clickstone §1.4 mastodon data layer — PERSONAL domain blocks.
//
// Pins `/api/v1/domain_blocks` (the account's own blocks, never
// `/api/v1/admin/domain_blocks`) with stubbed transports — no network:
// - GET    /api/v1/domain_blocks          → string[] (Link-paged, 100 cap)
// - POST   /api/v1/domain_blocks {domain} → block
// - DELETE /api/v1/domain_blocks?domain=  → unblock (query form, matching
//   the reference web client; the domain never rides the path)
// - 404/405 surfaces as the honest unsupported state (the row renders
//   disabled with a reason, never an error page).
// Also pins `normalizeDomainBlock` (input hygiene before any write).

import { createMastodonBackend } from "../src/mastodon/backend";
import { normalizeDomainBlock } from "../src/core/backend";
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
) => { data?: unknown; headers?: Headers } | never;

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
    return { status: 200, data: out.data as never, headers: out.headers ?? new Headers() };
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

describe("P6.1 domain blocks — listing", () => {
  it("reads GET /api/v1/domain_blocks as a string list", async () => {
    const { client, calls } = stubClient(() => ({
      data: ["spam.example", "bad.example"],
    }));
    const page = await createMastodonBackend(client).domainBlocks!.list();
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/v1/domain_blocks",
        body: { limit: 100 },
        opts: undefined,
      },
    ]);
    expect(page.items).toEqual(["spam.example", "bad.example"]);
    expect(page.cursor).toBeNull();
    expect(page.end).toBe(true);
  });

  it("never asks the admin endpoint", async () => {
    const { client, calls } = stubClient(() => ({ data: [] }));
    await createMastodonBackend(client).domainBlocks!.list();
    expect(calls.every((c) => !c.path.includes("/admin/"))).toBe(true);
  });

  it("pages through the Link header and carries the server's next URL", async () => {
    const { client, calls } = stubClient((method, path) =>
      path === "/api/v1/domain_blocks"
        ? {
            data: ["a.example"],
            headers: new Headers({
              Link: '<https://mastodon.example/api/v1/domain_blocks?max_id=7>; rel="next"',
            }),
          }
        : { data: ["b.example"] },
    );
    const backend = createMastodonBackend(client);
    const first = await backend.domainBlocks!.list();
    expect(first.end).toBe(false);
    const second = await backend.domainBlocks!.list({ cursor: first.cursor });
    expect(calls[1]!.path).toBe(
      "https://mastodon.example/api/v1/domain_blocks?max_id=7",
    );
    expect(second.items).toEqual(["b.example"]);
    expect(second.end).toBe(true);
  });

  it("treats an empty page as the end", async () => {
    const { client } = stubClient(() => ({ data: [] }));
    const page = await createMastodonBackend(client).domainBlocks!.list();
    expect(page.items).toEqual([]);
    expect(page.end).toBe(true);
  });

  it("rejects a non-list body instead of claiming zero blocks", async () => {
    const { client } = stubClient(() => ({ data: { error: "nope" } }));
    await expect(createMastodonBackend(client).domainBlocks!.list()).rejects.toBeInstanceOf(
      FediError,
    );
  });

  it("surfaces 404/405 as unsupported (the UI disables the row with a reason)", async () => {
    const { client } = stubClient(() => absent(404));
    const err = await createMastodonBackend(client)
      .domainBlocks!.list()
      .then(() => null, (e: unknown) => e);
    expect(isUnsupportedError(err)).toBe(true);
  });
});

describe("P6.1 domain blocks — writes", () => {
  it("blocks with POST /api/v1/domain_blocks {domain}", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await createMastodonBackend(client).domainBlocks!.block("spam.example");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/domain_blocks",
        body: { domain: "spam.example" },
        opts: undefined,
      },
    ]);
  });

  it("unblocks with DELETE /api/v1/domain_blocks?domain= (never a path id)", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await createMastodonBackend(client).domainBlocks!.unblock("spam.example");
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: "/api/v1/domain_blocks",
        body: undefined,
        opts: { query: { domain: "spam.example" } },
      },
    ]);
    expect(calls[0]!.path).not.toContain("spam.example");
  });

  it("propagates a refused block honestly (403 is not absence)", async () => {
    const { client } = stubClient(() => absent(403));
    await expect(
      createMastodonBackend(client).domainBlocks!.block("spam.example"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("normalizeDomainBlock", () => {
  it("accepts a bare host as typed", () => {
    expect(normalizeDomainBlock("example.com")).toBe("example.com");
    expect(normalizeDomainBlock("sub.example.co.uk")).toBe("sub.example.co.uk");
  });

  it("strips a pasted scheme, path, trailing slash/dot, userinfo, and case", () => {
    expect(normalizeDomainBlock("https://Example.COM/")).toBe("example.com");
    expect(normalizeDomainBlock("http://example.com/about")).toBe("example.com");
    expect(normalizeDomainBlock("  EXAMPLE.com.  ")).toBe("example.com");
    expect(normalizeDomainBlock("@alice@example.com")).toBe("example.com");
  });

  it("refuses input that is not a plausible host", () => {
    expect(normalizeDomainBlock("")).toBe("");
    expect(normalizeDomainBlock("   ")).toBe("");
    expect(normalizeDomainBlock("not a domain")).toBe("");
    expect(normalizeDomainBlock("localhost")).toBe("");
    expect(normalizeDomainBlock("example")).toBe("");
    expect(normalizeDomainBlock("https://")).toBe("");
  });
});
