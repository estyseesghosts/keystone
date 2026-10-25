// Robustness (repair X4.4 findings 10, 15, 17): list timelines honour
// cursors continuations; one malformed row never fails a page (skipped
// and counted); shallow nested quotes keep their id for a lazy fetch.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MastoClient, RequestResult } from "../src/mastodon/client";
import {
  adaptStatus,
  clearSkippedRowCounts,
  isStatusRow,
  skippedRowCount,
} from "../src/mastodon/adapt";
import { getQuoteTarget } from "../src/misskey/quote";
import { createMastodonBackend } from "../src/mastodon/backend";
import type { Account, Status } from "../src/mastodon/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const status = fixture<Status>("mastodon", "status.json");
const account = fixture<Account>("mastodon", "account.json");
const shallow = fixture<Status>("mastodon", "status-quote-shallow.json");

function badRow(): unknown {
  // A status row whose packed account is missing: `adaptStatus` would
  // throw on it, so the guards must skip it instead.
  return { id: "broken", content: "<p>no account</p>" };
}

interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
}

function stubClient(
  data: (method: string, path: string, query?: unknown) => unknown,
  link: string | null = null,
): { client: MastoClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = (
    method: string,
    path: string,
    body?: unknown,
  ): RequestResult<never> => {
    calls.push({ method, path, body });
    return {
      status: 200,
      data: data(method, path, body) as never,
      headers: new Headers(link ? { Link: link } : {}),
    };
  };
  const client: MastoClient = {
    origin: "https://mastodon.example",
    token: "t",
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

beforeEach(() => {
  clearSkippedRowCounts();
});

describe("lists.timeline cursors (finding 10)", () => {
  it("re-fetches on the session origin with carried-over cursors (Akkoma cross-origin Link)", async () => {
    const crossOrigin =
      '<https://internal:4000/api/v1/timelines/list/7?limit=20&max_id=99>; rel="next"';
    const { client, calls } = stubClient(
      (_method, _path) => [status],
      crossOrigin,
    );
    const backend = createMastodonBackend(client);
    const first = await backend.lists?.timeline("7", { limit: 20 });
    expect(first?.end).toBe(false);
    expect(first?.items).toHaveLength(1);
    // The continuation carries cursors (not the cross-origin URL): the
    // second fetch rebuilds the request on the session origin.
    await backend.lists?.timeline("7", { cursor: first?.cursor ?? null });
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe("/api/v1/timelines/list/7");
    expect(calls[1].body).toMatchObject({ max_id: "99", limit: 20 });
  });

  it("follows a same-origin next URL verbatim", async () => {
    const sameOrigin =
      '<https://mastodon.example/api/v1/timelines/list/7?limit=20&max_id=50>; rel="next"';
    const { client, calls } = stubClient(
      (_method, _path) => [status],
      sameOrigin,
    );
    const backend = createMastodonBackend(client);
    const first = await backend.lists?.timeline("7", { limit: 20 });
    await backend.lists?.timeline("7", { cursor: first?.cursor ?? null });
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe(
      "https://mastodon.example/api/v1/timelines/list/7?limit=20&max_id=50",
    );
  });
});

describe("skip-and-count (finding 17)", () => {
  it("skips a bad row in a home timeline and counts it, keeping the page", async () => {
    const { client } = stubClient(() => [status, badRow(), status]);
    const backend = createMastodonBackend(client);
    const page = await backend.timeline("home");
    expect(page.items).toHaveLength(2);
    expect(page.end).toBe(true);
    expect(skippedRowCount("timeline:home")).toBe(1);
  });

  it("skips a bad row in account statuses and counts it", async () => {
    const { client } = stubClient(() => [badRow(), status]);
    const backend = createMastodonBackend(client);
    const page = await backend.accountPosts("1", {});
    expect(page.items).toHaveLength(1);
    expect(skippedRowCount("statusPage")).toBe(1);
  });

  it("skips bad rows in v2 search (statuses and accounts) and counts them", async () => {
    const { client } = stubClient(() => ({
      accounts: [account, { id: "no-acct" }],
      statuses: [status, badRow()],
      hashtags: [],
    }));
    const backend = createMastodonBackend(client);
    // One v2 call scans both arrays, so one call counts one skip per kind.
    const posts = await backend.search.posts("hello", { limit: 20 });
    expect(posts.items).toHaveLength(1);
    expect(skippedRowCount("search:statuses")).toBe(1);
    expect(skippedRowCount("search:accounts")).toBe(1);
  });

  it("search.accounts returns the adapted accounts past the bad row", async () => {
    const { client } = stubClient(() => ({
      accounts: [account, { id: "no-acct" }],
      statuses: [status, badRow()],
      hashtags: [],
    }));
    const backend = createMastodonBackend(client);
    const res = await backend.search.accounts("hello", { limit: 20 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe(account.id);
  });

  it("skips malformed conversation participants without failing the inbox", async () => {
    const { client } = stubClient(() => [
      {
        id: "c1",
        accounts: [account, { id: "ghost" }],
        last_status: badRow(),
        unread: true,
      },
      {
        id: "c2",
        accounts: [account],
        last_status: null,
        unread: false,
      },
    ]);
    const backend = createMastodonBackend(client, { flavor: "mastodon" });
    const page = await backend.conversations?.list({});
    expect(page?.items).toHaveLength(2);
    expect(page?.items[0].accounts).toHaveLength(1);
    expect(page?.items[0].lastPost).toBeNull();
    expect(skippedRowCount("conversation:accounts")).toBe(1);
    expect(skippedRowCount("conversation:last_status")).toBe(1);
  });

  it("keeps a zero count when every row is well-formed", async () => {
    const { client } = stubClient(() => [status]);
    const backend = createMastodonBackend(client);
    await backend.timeline("home");
    expect(skippedRowCount()).toBe(0);
  });
});

describe("shallow nested quote (finding 15)", () => {
  it("keeps the nested id with quoteUnavailable false, never a fake target", () => {
    expect(isStatusRow(shallow)).toBe(true);
    const post = adaptStatus(shallow);
    expect(post.quote).toBeNull();
    expect(post.quoteUnavailable).toBe(false);
    expect(post.ext.quoteRef).toBe("113959271829458643");
  });

  it("normalizes to a structured id-only target for the lazy resolver", () => {
    const post = adaptStatus(shallow);
    expect(getQuoteTarget(post)).toEqual({
      source: "structured",
      noteId: "113959271829458643",
    });
  });

  it("a packed quote still wins over the ref (no double target)", () => {
    const post = adaptStatus(status);
    expect(post.quote).not.toBeNull();
    expect(post.ext.quoteRef).toBeUndefined();
  });

  it("a quote object with neither target nor id stays unavailable", () => {
    const bare = adaptStatus({ ...shallow, quote: { state: "pending" } });
    expect(bare.quote).toBeNull();
    expect(bare.quoteUnavailable).toBe(true);
    expect(bare.ext.quoteRef).toBeUndefined();
    expect(getQuoteTarget(bare)?.targetUnavailable).toBe(true);
  });
});

describe("dead exports removed (finding 18)", () => {
  it("no longer exports the superseded pagination/call helpers", async () => {
    const pagination = await import("../src/mastodon/pagination");
    expect("fallbackMaxId" in pagination).toBe(false);
    expect("nextLink" in pagination).toBe(false);
    expect("prevLink" in pagination).toBe(false);
    const endpoints = await import("../src/mastodon/endpoints");
    expect("feedClient" in endpoints).toBe(false);
    const statusActions = await import("../src/mastodon/statusActions");
    expect("writeCapabilities" in statusActions).toBe(false);
    const compose = await import("../src/mastodon/compose");
    expect("buildStatusBody" in compose).toBe(false);
  });
});
