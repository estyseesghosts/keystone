// Composer domain logic: counting, gating, draft building, and golden wire
// bodies per family (through the real backends over stub transports).

import {
  applyCompletion,
  autocompleteTriggerAt,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  countComposeChars,
  defaultVisibilityFor,
  emptyComposeState,
  fetchComposeLimits,
  visibilityOptionsFor,
} from "../src/api/composer";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { createMastodonBackend } from "../src/mastodon/backend";
import { buildCapabilities } from "../src/core/detect";
import type { Post } from "../src/core/models";

function caps(flavor: "misskey" | "sharkey" | "mastodon" | "akkoma") {
  return buildCapabilities(flavor, undefined as never);
}

const limits = composeDefaultsFor("misskey");
const mLimits = composeDefaultsFor("mastodon");

function ctxFor(
  family: "misskey" | "mastodon",
  flavor: "misskey" | "sharkey" | "mastodon" | "akkoma",
  scheduled = false,
  override: Partial<ReturnType<typeof caps>> = {},
) {
  const c = { ...caps(flavor), ...override };
  return {
    family,
    gates: composeGates(family, c, scheduled ? ({ scheduled: {} } as never) : null),
    limits: family === "mastodon" ? mLimits : limits,
  };
}

describe("countComposeChars", () => {
  it("weights URLs at 23 and remote mentions at @user on Mastodon", () => {
    expect(countComposeChars("mastodon", "hi https://example.com/a/very/long/path?x=1")).toBe(3 + 23);
    expect(countComposeChars("mastodon", "@bob@remote.example hi")).toBe("@bob hi".length);
    expect(countComposeChars("mastodon", "😀😀")).toBe(2);
  });
  it("uses UTF-16 length on the Misskey family", () => {
    expect(countComposeChars("misskey", "😀😀")).toBe(4);
    expect(countComposeChars("misskey", "  abc  ")).toBe(3);
  });
});

describe("buildPostDraft", () => {
  it("passes visibility raw through verbatim, even unknown values", () => {
    const r = buildPostDraft(
      emptyComposeState({ text: "x", visibilityRaw: "home" }),
      ctxFor("misskey", "sharkey"),
    );
    expect(r.ok && r.draft.visibility).toEqual({ kind: "quiet", localOnly: false, raw: "home" });
    const odd = buildPostDraft(
      emptyComposeState({ text: "x", visibilityRaw: "list:abc" }),
      ctxFor("misskey", "sharkey"),
    );
    expect(odd.ok && odd.draft.visibility?.raw).toBe("list:abc");
  });

  it("rejects empty, over-limit, bad polls, poll+media, past schedule", () => {
    const c = ctxFor("misskey", "sharkey", true, { scheduled_posts: "supported" });
    expect(buildPostDraft(emptyComposeState(), c).ok).toBe(false);
    expect(buildPostDraft(emptyComposeState({ text: "a".repeat(3001) }), c).ok).toBe(false);
    expect(
      buildPostDraft(
        emptyComposeState({ text: "x", poll: { choices: ["a", " "], multiple: false, durationSeconds: 60 } }),
        c,
      ).ok,
    ).toBe(false);
    expect(
      buildPostDraft(
        emptyComposeState({
          text: "x",
          media: [{ id: "m", alt: "" }],
          poll: { choices: ["a", "b"], multiple: false, durationSeconds: 60 },
        }),
        c,
      ).ok,
    ).toBe(false);
    expect(
      buildPostDraft(emptyComposeState({ text: "x", scheduledAt: "2000-01-01T00:00:00Z" }), c).ok,
    ).toBe(false);
  });

  it("allows media-only posts and drops disabled features", () => {
    const c = ctxFor("mastodon", "mastodon");
    const r = buildPostDraft(
      emptyComposeState({
        media: [{ id: "m1", alt: "a" }],
        visibilityRaw: "unlisted",
        localOnly: true,
        reactionAcceptance: "likeOnly",
        scheduledAt: "2999-01-01T00:00:00Z",
      }),
      c,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.mediaIds).toEqual(["m1"]);
      expect(r.draft.reactionAcceptance).toBeUndefined();
      expect(r.draft.visibility?.localOnly).toBe(false);
      expect(r.scheduledAt).toBeNull();
    }
  });

  it("requires a recipient for Misskey specified posts", () => {
    const c = ctxFor("misskey", "misskey");
    expect(buildPostDraft(emptyComposeState({ text: "psst", visibilityRaw: "specified" }), c).ok).toBe(false);
    expect(
      buildPostDraft(
        emptyComposeState({ text: "psst", visibilityRaw: "specified", visibleUserIds: ["u1"] }),
        c,
      ).ok,
    ).toBe(true);
  });
});

describe("gating", () => {
  it("hides quote on Mastodon without quote_posting and schedule without the sub-module", () => {
    const g = composeGates("mastodon", caps("mastodon"), null);
    expect(g.quote.enabled).toBe(false);
    expect(g.schedule.enabled).toBe(false);
    expect(g.reactionAcceptance.enabled).toBe(false);
    expect(composeGates("misskey", caps("misskey"), null).quote.enabled).toBe(true);
    expect(composeGates("misskey", null, null).poll.enabled).toBe(false);
  });

  it("gates per-note noQuote and per-attachment sensitivity per family", () => {
    // Misskey family: both per-note/per-file fields exist.
    const mk = composeGates("misskey", caps("misskey"), null);
    expect(mk.noQuote.enabled).toBe(true);
    expect(mk.mediaSensitive.enabled).toBe(true);
    expect(composeGates("misskey", caps("sharkey"), null).noQuote.enabled).toBe(true);

    // Mastodon family: status-level `sensitive` only, no per-note field.
    const md = composeGates("mastodon", caps("mastodon"), null);
    expect(md.noQuote).toEqual({
      enabled: false,
      reason: "Keystone cannot set quote refusal per post on this server yet.",
    });
    expect(md.mediaSensitive).toEqual({
      enabled: false,
      reason: "This server marks media sensitivity for the whole post, not per attachment.",
    });
    // Signed out: every control is off with one honest reason.
    expect(composeGates("misskey", null, null).noQuote.enabled).toBe(false);
    expect(composeGates("misskey", null, null).mediaSensitive.enabled).toBe(false);
  });

  it("replies never widen the parent's audience", () => {
    const parent = { visibility: { kind: "followers", localOnly: false, raw: "followers" } } as Post;
    expect(defaultVisibilityFor("misskey", parent).raw).toBe("followers");
    expect(defaultVisibilityFor("mastodon", parent).raw).toBe("private");
    expect(visibilityOptionsFor("mastodon").map((o) => o.raw)).toContain("unlisted");
  });
});

describe("autocomplete", () => {
  it("finds mention, hashtag and emoji tokens at the caret", () => {
    expect(autocompleteTriggerAt("hi @al", 6)).toMatchObject({ kind: "mention", query: "al", start: 3 });
    expect(autocompleteTriggerAt("#ta", 3)).toMatchObject({ kind: "hashtag", query: "ta" });
    expect(autocompleteTriggerAt("x :bl", 5)).toMatchObject({ kind: "emoji", query: "bl" });
    expect(autocompleteTriggerAt("x :b", 4)).toBeNull();
    expect(autocompleteTriggerAt("mail a@b", 8)).toBeNull();
    const t = autocompleteTriggerAt("hi @al", 6)!;
    expect(applyCompletion("hi @al", t, "@alice")).toEqual({ text: "hi @alice ", caret: 10 });
  });
});

describe("golden wire bodies", () => {
  function misskeyBody(flavor: "misskey" | "sharkey", state: Parameters<typeof emptyComposeState>[0]) {
    const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
    const transport: MisskeyTransport = {
      call<T>(endpoint: string, params: Record<string, unknown> = {}) {
        calls.push({ endpoint, params });
        return Promise.reject(new Error("stop")) as Promise<T>;
      },
      upload: () => Promise.reject(new Error("no")),
    };
    const backend = createMisskeyBackend(transport, flavor);
    const built = buildPostDraft(emptyComposeState(state), ctxFor("misskey", flavor));
    if (!built.ok) throw new Error(built.reason);
    return backend.createPost(built.draft).then(() => calls[0], () => calls[0]);
  }

  it("Sharkey: only known fields, raw visibility, ms poll expiry, renoteId", async () => {
    const call = await misskeyBody("sharkey", {
      text: " hello ",
      visibilityRaw: "home",
      cwEnabled: true,
      cw: "spoiler",
      quote: { id: "q1" } as Post,
      replyTo: { id: "r1", visibility: { kind: "public", localOnly: false, raw: "public" } } as Post,
      media: [{ id: "f1", alt: "" }],
    });
    expect(call.endpoint).toBe("notes/create");
    expect(call.params).toEqual({
      visibility: "home",
      text: "hello",
      cw: "spoiler",
      replyId: "r1",
      renoteId: "q1",
      fileIds: ["f1"],
    });
  });

  it("Misskey: poll in ms and reaction acceptance", async () => {
    const call = await misskeyBody("misskey", {
      text: "vote",
      poll: { choices: ["a", "b"], multiple: true, durationSeconds: 300 },
      reactionAcceptance: "likeOnly",
    });
    // polls_multi is "supported" in the capability table (W1/MK15: v1
    // `docs/api-surface.md:67` documents `multiple` for these servers),
    // so the flag passes through instead of being forced off.
    expect(call.params).toEqual({
      visibility: "public",
      text: "vote",
      reactionAcceptance: "likeOnly",
      poll: { choices: ["a", "b"], multiple: true, expiredAfter: 300000 },
    });
  });

  it("Mastodon: statuses body with spoiler, quote, seconds poll", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      origin: "https://m.example",
      token: "t",
      post: (path: string, body: unknown) => {
        calls.push({ path, body });
        return Promise.reject(new Error("stop"));
      },
    } as never;
    const backend = createMastodonBackend(client);
    const c = ctxFor("mastodon", "akkoma", false, { quote_posting: "supported" });
    const built = buildPostDraft(
      emptyComposeState({
        text: "hi",
        visibilityRaw: "unlisted",
        cwEnabled: true,
        cw: "cw",
        quote: { id: "q" } as Post,
        poll: { choices: ["a", "b"], multiple: false, durationSeconds: 600 },
      }),
      c,
    );
    if (!built.ok) throw new Error(built.reason);
    await backend.createPost(built.draft).catch(() => undefined);
    expect(calls[0]?.path).toBe("/api/v1/statuses");
    expect(calls[0]?.body).toEqual({
      status: "hi",
      visibility: "unlisted",
      spoiler_text: "cw",
      quoted_status_id: "q",
      poll: { options: ["a", "b"], multiple: false, expires_in: 600 },
    });
  });

  it("Misskey create sends noQuote only when the toggle is on", async () => {
    const off = await misskeyBody("sharkey", { text: "plain" });
    expect(off.params).not.toHaveProperty("noQuote");
    const on = await misskeyBody("sharkey", { text: "plain", noQuote: true });
    expect(on.params).toMatchObject({ noQuote: true });
  });

  it("Misskey edit forwards noQuote when on and omits it when off", async () => {
    function editCall(state: Parameters<typeof emptyComposeState>[0]) {
      const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
      const transport: MisskeyTransport = {
        call<T>(endpoint: string, params: Record<string, unknown> = {}) {
          calls.push({ endpoint, params });
          return Promise.reject(new Error("stop")) as Promise<T>;
        },
        upload: () => Promise.reject(new Error("no")),
      };
      const backend = createMisskeyBackend(transport, "sharkey");
      const built = buildPostDraft(emptyComposeState(state), ctxFor("misskey", "sharkey"));
      if (!built.ok) throw new Error(built.reason);
      return backend.editPost("n1", built.draft).catch(() => undefined).then(() => calls[0]);
    }
    const on = await editCall({ text: "fixed", noQuote: true });
    expect(on.endpoint).toBe("notes/edit");
    expect(on.params).toMatchObject({ noteId: "n1", noQuote: true });

    // Off: the field is omitted, so an edit never lifts an earlier refusal
    // the composer cannot show (the Post model carries no noQuote).
    const off = await editCall({ text: "fixed" });
    expect(off.params).not.toHaveProperty("noQuote");
  });

  it("Mastodon never sends noQuote or quote_approval_policy", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const client = {
      origin: "https://m.example",
      token: "t",
      post: (path: string, body: Record<string, unknown>) => {
        calls.push({ path, body });
        return Promise.reject(new Error("stop"));
      },
    } as never;
    const backend = createMastodonBackend(client);
    // A draft carrying the per-note flag must not leak an unknown field.
    await backend
      .createPost({ text: "hi", visibility: { kind: "public", localOnly: false }, noQuote: true })
      .catch(() => undefined);
    expect(calls[0]?.body).not.toHaveProperty("noQuote");
    expect(calls[0]?.body).not.toHaveProperty("quote_approval_policy");
    // And the gate never puts it in the draft on this family.
    const built = buildPostDraft(
      emptyComposeState({ text: "hi", noQuote: true }),
      ctxFor("mastodon", "mastodon"),
    );
    expect(built.ok && built.draft.noQuote).toBeUndefined();
  });
});

describe("fetchComposeLimits", () => {
  it("reads Misskey maxNoteTextLength without a token and falls back on failure", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const ok = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ maxNoteTextLength: 8192 }) };
    }) as unknown as typeof fetch;
    const l = await fetchComposeLimits({ origin: "https://s.example", family: "misskey" }, ok);
    expect(l.maxChars).toBe(8192);
    expect(seen!.url).toBe("https://s.example/api/meta");
    expect(JSON.stringify(seen!.init)).not.toMatch(/authorization|"i"/i);
    const bad = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    expect((await fetchComposeLimits({ origin: "https://s.example", family: "misskey" }, bad)).maxChars).toBe(3000);
  });
});
