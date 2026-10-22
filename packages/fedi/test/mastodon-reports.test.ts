// Clickstone §1.5 reports — Mastodon data layer.
//
// Pins the `POST /api/v1/reports` body against the verified server source
// (paths in the session log, not here) with stubbed transports — no network:
// - only the fields the reporter chose are sent: `account_id`, `comment`,
//   `status_ids[]`, `category`, `rule_ids[]`, `forward`;
// - absent fields are OMITTED, never sent as `[]`/`false` (the server's
//   defaults are identical, so this is not a behavior change);
// - `rule_ids` forces `category: "violation"` (ReportService#call does the
//   same server-side, so the body never contradicts itself);
// - `GET /api/v1/instance/rules` parses the rule rows and surfaces a 404 as
//   the honest unsupported state (Akkoma has no such endpoint).

import { createMastodonBackend } from "../src/mastodon/backend";
import type { MastoClient, RequestOptions, RequestResult } from "../src/mastodon/client";
import { ApiError, FediError } from "../src/core/errors";
import { isUnsupportedError } from "../src/misskey/client";
import { buildReportBody } from "../src/mastodon/endpoints";

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

describe("P6.1 reports — POST /api/v1/reports body", () => {
  it("sends only account_id when the chooser chose nothing", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    const result = await createMastodonBackend(client).reportAccount("acct-1", {});
    expect(calls).toEqual([
      { method: "POST", path: "/api/v1/reports", body: { account_id: "acct-1" }, opts: undefined },
    ]);
    // Empty arrays and false flags are OMITTED: the server defaults are the
    // same, and `[]`/false on the wire would only add noise.
    const body = calls[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["account_id"]);
    expect(result).toEqual({
      comment: "",
      statusIds: [],
      category: null,
      ruleIds: [],
      forward: false,
      unsupported: [],
    });
  });

  it("sends comment, status_ids, category and forward when chosen", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    const result = await createMastodonBackend(client).reportAccount("acct-1", {
      comment: "  spam bot  ",
      statusIds: ["101", "101"],
      category: "spam",
      forward: true,
    });
    expect(calls[0]!.body).toEqual({
      account_id: "acct-1",
      comment: "spam bot",
      status_ids: ["101"],
      category: "spam",
      forward: true,
    });
    expect(result).toEqual({
      comment: "spam bot",
      statusIds: ["101"],
      category: "spam",
      ruleIds: [],
      forward: true,
      unsupported: [],
    });
  });

  it("rule_ids are sent and force category violation (server does the same)", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    // Even a contradictory category is never sent next to rule ids: the
    // server would silently override it, so the body states the effective
    // category.
    const result = await createMastodonBackend(client).reportAccount("acct-1", {
      category: "spam",
      ruleIds: ["7", "9"],
    });
    expect(calls[0]!.body).toEqual({
      account_id: "acct-1",
      rule_ids: ["7", "9"],
      category: "violation",
    });
    expect(result.category).toBe("violation");
    expect(result.ruleIds).toEqual(["7", "9"]);
  });

  it("never sends empty arrays, an empty comment, or forward:false", async () => {
    const body = buildReportBody("acct-1", {
      comment: "   ",
      statusIds: [],
      ruleIds: [],
      forward: false,
    });
    expect(body).toEqual({ account_id: "acct-1" });
  });

  it("drops an unknown category instead of forwarding it blindly", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await createMastodonBackend(client).reportAccount("acct-1", {
      category: "harassment" as never,
    });
    expect(calls[0]!.body).toEqual({ account_id: "acct-1" });
  });

  it("keeps the pre-chooser string call shape as a comment", async () => {
    const { client, calls } = stubClient(() => ({ data: {} }));
    await createMastodonBackend(client).reportAccount("acct-1", "report text");
    expect(calls[0]!.body).toEqual({ account_id: "acct-1", comment: "report text" });
  });
});

describe("P6.1 reports — GET /api/v1/instance/rules", () => {
  it("parses the rule rows (numeric ids become strings, text trimmed)", async () => {
    const { client, calls } = stubClient(() => ({
      data: [
        { id: 1, text: " Be kind " },
        { id: "2", text: "No spam", hint: "links" },
        { id: 3, text: "   " },
        { text: "no id" },
      ],
    }));
    const rules = await createMastodonBackend(client).instanceRules!();
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/instance/rules", body: undefined, opts: undefined },
    ]);
    expect(rules).toEqual([
      { id: "1", text: "Be kind" },
      { id: "2", text: "No spam" },
    ]);
  });

  it("maps 404 to the honest unsupported state (Akkoma has no rules endpoint)", async () => {
    const { client } = stubClient(() => absent(404));
    const err = await createMastodonBackend(client)
      .instanceRules!()
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect(isUnsupportedError(err)).toBe(true);
  });

  it("a non-list body is a shape error, never an empty rule list", async () => {
    const { client } = stubClient(() => ({ data: { rules: [] } }));
    await expect(createMastodonBackend(client).instanceRules!()).rejects.toBeInstanceOf(
      FediError,
    );
  });
});
