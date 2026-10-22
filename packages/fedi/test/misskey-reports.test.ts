// Clickstone §1.5 reports — Misskey data layer.
//
// Misskey's ONLY report endpoint is `users/report-abuse` with
// `{userId, comment}` and a `comment` the server requires (minLength 1,
// verified in the Misskey server source — path in the session log). It has
// no categories, rules, status ids or forwarding, so:
// - the request shape stays exactly `{userId, comment}` (comment trimmed);
// - fields the caller passes that Misskey cannot express come back in
//   `unsupported` with the honest reason, never silently dropped;
// - an empty comment is refused locally (the server would 400 anyway).

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { FediError } from "../src/core/errors";

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubTransport(): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport = {
    call: async (endpoint: string, params: Record<string, unknown> = {}) => {
      calls.push({ endpoint, params });
      return undefined;
    },
    upload: async () => {
      throw new Error("not used");
    },
  } as unknown as MisskeyTransport;
  return { transport, calls };
}

describe("P6.1 reports — Misskey users/report-abuse", () => {
  it("sends exactly {userId, comment} and states the fields it cannot express", async () => {
    const { transport, calls } = stubTransport();
    const result = await createMisskeyBackend(transport, "misskey").reportAccount("u1", {
      comment: "  impersonation  ",
      statusIds: ["n1"],
      category: "spam",
      ruleIds: ["r1"],
      forward: true,
    });
    expect(calls).toEqual([
      { endpoint: "users/report-abuse", params: { userId: "u1", comment: "impersonation" } },
    ]);
    expect(result).toEqual({
      comment: "impersonation",
      statusIds: [],
      category: null,
      ruleIds: [],
      forward: false,
      unsupported: [
        { field: "statusIds", reason: expect.any(String) },
        { field: "category", reason: expect.any(String) },
        { field: "ruleIds", reason: expect.any(String) },
        { field: "forward", reason: expect.any(String) },
      ],
    });
    for (const row of result.unsupported) expect(row.reason).toMatch(/Misskey/);
  });

  it("keeps the comment-only call shape", async () => {
    const { transport, calls } = stubTransport();
    const result = await createMisskeyBackend(transport, "misskey").reportAccount(
      "u1",
      "spam",
    );
    expect(calls).toEqual([
      { endpoint: "users/report-abuse", params: { userId: "u1", comment: "spam" } },
    ]);
    expect(result.unsupported).toEqual([]);
  });

  it("refuses an empty reason locally (the server requires minLength 1)", async () => {
    const { transport, calls } = stubTransport();
    const err = await createMisskeyBackend(transport, "misskey")
      .reportAccount("u1", { comment: "   " })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.report.commentRequired");
    expect(calls).toEqual([]);
  });

  it("has no rule-list endpoint (optional member stays absent)", () => {
    const { transport } = stubTransport();
    expect(createMisskeyBackend(transport, "misskey").instanceRules).toBeUndefined();
  });
});
