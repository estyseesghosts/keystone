// Composer domain logic: counting, gating, draft building, and golden wire
// bodies per family (through the real backends over stub transports).

import {
  applyCompletion,
  autocompleteTriggerAt,
  buildPostDraft,
  composeDefaultsFor,
  composeGates,
  composePrefsOf,
  countComposeChars,
  defaultVisibilityFor,
  emptyComposeState,
  fetchComposeLimits,
  formatByteLimit,
  visibilityOptionsFor,
  type ComposeLimits,
} from "../src/api/composer";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { createMastodonBackend } from "../src/mastodon/backend";
import { buildCapabilities } from "../src/core/detect";
import type { Post } from "../src/core/models";
import { makeAccount } from "./factories";

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

  // 1.6 — Mastodon `poll[hide_totals]` (statuses_controller.rb permits it,
  // PostStatusService stores it). Only `true` is sent; false/absent leaves
  // the server default. The gate keeps the field off servers that do not
  // store it (Akkoma documents it but `make_poll_data/1` drops it).
  it("Mastodon: hide_totals rides only when true and supported", async () => {
    async function mastoBody(flavor: "mastodon" | "akkoma", hideTotals?: boolean) {
      const calls: Array<{ path: string; body: any }> = [];
      const client = {
        origin: "https://m.example",
        token: "t",
        post: (path: string, body: unknown) => {
          calls.push({ path, body });
          return Promise.reject(new Error("stop"));
        },
      } as never;
      const backend = createMastodonBackend(client, { flavor });
      const built = buildPostDraft(
        emptyComposeState({
          text: "vote",
          poll: { choices: ["a", "b"], multiple: false, durationSeconds: 600, hideTotals },
        }),
        ctxFor("mastodon", flavor),
      );
      if (!built.ok) throw new Error(built.reason);
      await backend.createPost(built.draft).catch(() => undefined);
      return calls[0]?.body;
    }

    expect((await mastoBody("mastodon", true)).poll).toEqual({
      options: ["a", "b"],
      multiple: false,
      expires_in: 600,
      hide_totals: true,
    });
    // Off → the field is omitted, not `false`.
    expect((await mastoBody("mastodon", false)).poll).not.toHaveProperty("hide_totals");
    expect((await mastoBody("mastodon", undefined)).poll).not.toHaveProperty("hide_totals");
    // Akkoma: unsupported, so the draft never carries it even if state does.
    expect((await mastoBody("akkoma", true)).poll).not.toHaveProperty("hide_totals");
  });

  it("Mastodon: sub-minimum poll durations clamp to 300 s, never 0 (finding 22)", async () => {
    // Domain layer: a restored draft or redraft seed can carry any
    // duration (only the chips are ≥ 300 s) — the floor holds.
    const built = buildPostDraft(
      emptyComposeState({
        text: "vote",
        poll: { choices: ["a", "b"], multiple: false, durationSeconds: 60 },
      }),
      ctxFor("mastodon", "mastodon"),
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.draft.poll?.expiredAfter).toBe(300);
    // Misskey-family durations are milliseconds and untouched.
    const mk = buildPostDraft(
      emptyComposeState({
        text: "vote",
        poll: { choices: ["a", "b"], multiple: false, durationSeconds: 60 },
      }),
      ctxFor("misskey", "sharkey"),
    );
    expect(mk.ok).toBe(true);
    if (mk.ok) expect(mk.draft.poll?.expiredAfter).toBe(60000);
    // Wire layer backstop: even a hand-built draft with a short expiry
    // (or an expiresAt 60 s out) never sends 0 or a sub-minimum value.
    const calls: Array<{ path: string; body: any }> = [];
    const client = {
      origin: "https://m.example",
      token: "t",
      post: (path: string, body: unknown) => {
        calls.push({ path, body });
        return Promise.reject(new Error("stop"));
      },
    } as never;
    const backend = createMastodonBackend(client);
    await backend
      .createPost({
        visibility: { kind: "public", localOnly: false, raw: "public" },
        text: "hi",
        poll: { choices: ["a", "b"], expiredAfter: 60 },
      })
      .catch(() => undefined);
    expect((calls[0]?.body as { poll: { expires_in: number } }).poll.expires_in).toBe(300);
    await backend
      .createPost({
        visibility: { kind: "public", localOnly: false, raw: "public" },
        text: "hi",
        poll: { choices: ["a", "b"], expiresAt: Date.now() + 60_000 },
      })
      .catch(() => undefined);
    expect((calls[1]?.body as { poll: { expires_in: number } }).poll.expires_in).toBe(300);
  });

  it("gates hide_totals per flavor: Mastodon on, Akkoma/Misskey off with a reason", () => {
    expect(composeGates("mastodon", caps("mastodon")).pollHideTotals).toEqual({ enabled: true });
    for (const flavor of ["akkoma", "misskey", "sharkey"] as const) {
      const gate = composeGates(flavor === "akkoma" ? "mastodon" : "misskey", caps(flavor)).pollHideTotals;
      expect(gate.enabled).toBe(false);
      if (!gate.enabled) expect(gate.reason.length).toBeGreaterThan(0);
    }
    expect(composeGates("misskey", null, null).pollHideTotals.enabled).toBe(false);
  });

  it("Misskey never sends hide_totals even when the state sets it", async () => {
    const call = await misskeyBody("misskey", {
      text: "vote",
      poll: { choices: ["a", "b"], multiple: false, durationSeconds: 300, hideTotals: true },
    });
    expect(call.params.poll).toEqual({ choices: ["a", "b"], multiple: false, expiredAfter: 300000 });
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
    expect(on.params).toMatchObject({ editId: "n1", noQuote: true });

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
    const ok: jest.Mock = jest.fn(async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ maxNoteTextLength: 8192 }) };
    });
    const l = await fetchComposeLimits({ origin: "https://s.example", family: "misskey" }, ok);
    expect(l.maxChars).toBe(8192);
    expect(seen!.url).toBe("https://s.example/api/meta");
    expect(JSON.stringify(seen!.init)).not.toMatch(/authorization|"i"/i);
    const bad: jest.Mock = jest.fn(async () => {
      throw new Error("net");
    });
    expect((await fetchComposeLimits({ origin: "https://s.example", family: "misskey" }, bad)).maxChars).toBe(3000);
  });

  it("threads fetchImpl through the Mastodon instance probe", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string | URL): Promise<Response> => {
      seen.push(String(url));
      if (String(url).endsWith("/api/v2/instance")) {
        return new Response(
          JSON.stringify({
            version: "4.4.3",
            domain: "m.example",
            configuration: { statuses: { max_characters: 700, max_media_attachments: 2 } },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };
    const l = await fetchComposeLimits({ origin: "https://m.example", family: "mastodon" }, fetchImpl);
    expect(l.maxChars).toBe(700);
    expect(l.maxMedia).toBe(2);
    expect(seen.some((u) => u.endsWith("/api/v2/instance"))).toBe(true);
  });
});

describe("fetchComposeLimits full (repair X6.2 step 1)", () => {
  function mastoFetch(v2: unknown, v1Status = 404, v1Body: unknown = {}): jest.Mock {
    return jest.fn(async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.endsWith("/api/v2/instance")) {
        return v2 === null
          ? new Response("", { status: 404 })
          : new Response(JSON.stringify(v2), { status: 200 });
      }
      if (u.endsWith("/api/v1/instance")) {
        return v1Status === 200
          ? new Response(JSON.stringify(v1Body), { status: 200 })
          : new Response("", { status: v1Status });
      }
      return new Response("", { status: 404 });
    });
  }

  it("reads the full Mastodon configuration block with source server", async () => {
    const fetchImpl = mastoFetch({
      version: "4.4.3",
      domain: "m.example",
      languages: ["en", "ja"],
      configuration: {
        statuses: { max_characters: 1000, max_media_attachments: 8, characters_reserved_per_url: 30 },
        media_attachments: { image_size_limit: 16777216, video_size_limit: 103809024 },
        polls: { max_options: 4, max_characters_per_option: 25, min_expiration: 300, max_expiration: 2629746 },
      },
    });
    const l = await fetchComposeLimits(
      { origin: "https://m.example", family: "mastodon" },
      fetchImpl,
    );
    expect(l).toEqual({
      maxChars: 1000,
      maxCwChars: null,
      maxMedia: 8,
      maxImageBytes: 16777216,
      maxVideoBytes: 103809024,
      maxPollOptions: 4,
      maxPollOptionChars: 25,
      minPollSeconds: 300,
      maxPollSeconds: 2629746,
      urlWeight: 30,
      supportedLanguages: ["en", "ja"],
      source: "server",
    });
    expect(fetchImpl.mock.calls.some(([u]: [string]) => String(u).endsWith("/api/v2/instance"))).toBe(true);
  });

  it("falls back to v1 on 404 and uses upload_limit + poll_limits generically", async () => {
    const fetchImpl = mastoFetch(null, 200, {
      uri: "a.example",
      title: "akko",
      version: "2.0",
      max_toot_chars: 5000,
      upload_limit: 20971520,
      poll_limits: { max_options: 10, max_characters_per_option: 140 },
    });
    const l = await fetchComposeLimits(
      { origin: "https://a.example", family: "mastodon" },
      fetchImpl,
    );
    expect(l.source).toBe("server");
    expect(l.maxChars).toBe(5000);
    // Generic v1 cap backs both kinds when the specific block is absent.
    expect(l.maxImageBytes).toBe(20971520);
    expect(l.maxVideoBytes).toBe(20971520);
    expect(l.maxPollOptions).toBe(10);
    expect(l.maxPollOptionChars).toBe(140);
    expect(l.supportedLanguages).toBeNull();
  });

  it("never falls back on timeout/500: retries, then reports fallback", async () => {
    const fail: jest.Mock = jest.fn(async (): Promise<Response> => new Response("", { status: 500 }));
    const l = await fetchComposeLimits(
      { origin: "https://m.example", family: "mastodon" },
      fail,
      { retries: 2, retryDelayMs: 0 },
    );
    expect(l.source).toBe("fallback");
    expect(l.maxChars).toBe(500);
    // 1 initial + 2 retries.
    expect(fail).toHaveBeenCalledTimes(3);
  });

  it("a transient failure then success resolves server (backoff, no sleep in tests)", async () => {
    let n = 0;
    const flaky: jest.Mock = jest.fn(async (url: string | URL): Promise<Response> => {
      n++;
      if (String(url).endsWith("/api/v1/instance")) return new Response("", { status: 404 });
      if (n <= 2) throw new Error("net down");
      return new Response(
        JSON.stringify({ version: "4.4.3", configuration: { statuses: { max_characters: 750 } } }),
        { status: 200 },
      );
    });
    const l = await fetchComposeLimits(
      { origin: "https://m.example", family: "mastodon" },
      flaky,
      { retries: 3, retryDelayMs: 0 },
    );
    expect(l).toMatchObject({ maxChars: 750, source: "server" });
    expect(n).toBeGreaterThan(1);
  });

  it("Misskey meta carries chars + langs with source server", async () => {
    const ok: jest.Mock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ maxNoteTextLength: 8192, langs: ["en", "ja"] }),
    }));
    const l = await fetchComposeLimits({ origin: "https://s.example", family: "misskey" }, ok);
    expect(l).toMatchObject({ maxChars: 8192, supportedLanguages: ["en", "ja"], source: "server" });
    // Family static: Misskey CW cap rides along even when meta says nothing.
    expect(l.maxCwChars).toBe(100);
  });
});

describe("countComposeChars URL trailing punctuation (repair X6.2 step 3)", () => {
  const cases: Array<[string, string, number]> = [
    // [family, text, expected]
    ["mastodon", "see https://x.y/a.", 4 + 23 + 1],
    ["mastodon", "see https://x.y/a,", 4 + 23 + 1],
    ["mastodon", "see https://x.y/a!", 4 + 23 + 1],
    // Balanced closers stay inside the URL (flat 23): only the "(" counts.
    ["mastodon", "(https://x.y/a)", 1 + 23],
    ["mastodon", "hi https://example.com/a/very/long/path?x=1", 3 + 23],
    ["mastodon", "a https://x.y/one. b https://x.y/two!", 2 + 23 + 1 + 3 + 23 + 1],
    ["misskey", "see https://x.y/a.", "see https://x.y/a.".length],
  ];
  it.each(cases)("counts %s %p as %d", (family, text, expected) => {
    expect(countComposeChars(family as "mastodon" | "misskey", text)).toBe(expected);
  });

  it("honours a server urlWeight", () => {
    expect(countComposeChars("mastodon", "see https://x.y/a.", 30)).toBe(4 + 30 + 1);
  });
});

describe("buildPostDraft validation (repair X6.2 step 3)", () => {
  function limitsFor(family: "misskey" | "mastodon", over: Partial<ComposeLimits> = {}): ComposeLimits {
    const base = composeDefaultsFor(family);
    return { ...base, ...over };
  }
  function vctx(
    family: "misskey" | "mastodon",
    flavor: "misskey" | "sharkey" | "mastodon",
    limits: ComposeLimits,
  ) {
    const c = { ...buildCapabilities(flavor, undefined as never) };
    return { family, gates: composeGates(family, c, null), limits };
  }

  const validationCases: Array<{
    name: string;
    family: "misskey" | "mastodon";
    flavor: "misskey" | "sharkey" | "mastodon";
    limits: Partial<ComposeLimits>;
    state: Parameters<typeof emptyComposeState>[0];
    ok: boolean;
  }> = [
    {
      name: "Misskey CW over 100 fails, exactly 100 passes",
      family: "misskey",
      flavor: "sharkey",
      limits: {},
      state: { text: "x", cwEnabled: true, cw: "c".repeat(101) },
      ok: false,
    },
    {
      name: "Misskey CW at the cap passes",
      family: "misskey",
      flavor: "sharkey",
      limits: {},
      state: { text: "x", cwEnabled: true, cw: "c".repeat(100) },
      ok: true,
    },
    {
      name: "duplicate poll choices fail",
      family: "misskey",
      flavor: "sharkey",
      limits: {},
      state: { text: "x", poll: { choices: ["yes", " yes "], multiple: false, durationSeconds: 60 } },
      ok: false,
    },
    {
      name: "distinct poll choices pass",
      family: "misskey",
      flavor: "sharkey",
      limits: {},
      state: { text: "x", poll: { choices: ["yes", "no"], multiple: false, durationSeconds: 60 } },
      ok: true,
    },
    {
      name: "poll option over the server length fails, at the length passes",
      family: "mastodon",
      flavor: "mastodon",
      limits: { maxPollOptionChars: 5 },
      state: { text: "x", poll: { choices: ["toolong", "ok"], multiple: false, durationSeconds: 600 } },
      ok: false,
    },
    {
      name: "poll option at the server length passes",
      family: "mastodon",
      flavor: "mastodon",
      limits: { maxPollOptionChars: 5 },
      state: { text: "x", poll: { choices: ["five5", "ok"], multiple: false, durationSeconds: 600 } },
      ok: true,
    },
    {
      name: "poll over the server max expiry fails",
      family: "mastodon",
      flavor: "mastodon",
      limits: { maxPollSeconds: 3600 },
      state: { text: "x", poll: { choices: ["a", "b"], multiple: false, durationSeconds: 7200 } },
      ok: false,
    },
    {
      name: "poll under the server min expiry fails",
      family: "mastodon",
      flavor: "mastodon",
      limits: { minPollSeconds: 300 },
      state: { text: "x", poll: { choices: ["a", "b"], multiple: false, durationSeconds: 60 } },
      ok: false,
    },
    {
      name: "Mastodon schedule under 5 minutes fails, over passes",
      family: "mastodon",
      flavor: "mastodon",
      limits: {},
      state: {
        text: "x",
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      },
      ok: false,
    },
    {
      name: "Mastodon schedule over 5 minutes passes",
      family: "mastodon",
      flavor: "mastodon",
      limits: {},
      state: {
        text: "x",
        scheduledAt: new Date(Date.now() + 6 * 60_000).toISOString(),
      },
      ok: true,
    },
    {
      name: "specified with only an @mention in text still fails",
      family: "misskey",
      flavor: "misskey",
      limits: {},
      state: { text: "psst @alice", visibilityRaw: "specified" },
      ok: false,
    },
    {
      name: "specified with picked recipients passes",
      family: "misskey",
      flavor: "misskey",
      limits: {},
      state: { text: "psst", visibilityRaw: "specified", visibleUserIds: ["u1"] },
      ok: true,
    },
  ];

  it.each(validationCases)("$name", ({ family, flavor, limits, state, ok }) => {
    const ctx = vctx(family, flavor, limitsFor(family, limits));
    // Scheduled cases need the schedule gate on.
    if (state?.scheduledAt) {
      ctx.gates = composeGates(family, { ...buildCapabilities(flavor, undefined as never) }, {
        scheduled: {},
      } as never);
    }
    const r = buildPostDraft(emptyComposeState(state), ctx);
    expect(r.ok).toBe(ok);
  });
});

describe("composePrefsOf + narrowest-unknown default (repair X6.2 step 4)", () => {
  const mastoMe = (source: Record<string, unknown>) => makeAccount({ ext: { mastodon: { source } } });
  const misskeyMe = (me: Record<string, unknown>) => makeAccount({ ext: { me } });

  it("reads Mastodon source.privacy/sensitive/language", () => {
    expect(composePrefsOf(mastoMe({ privacy: "unlisted", sensitive: true, language: "ja" }))).toEqual({
      visibilityRaw: "unlisted",
      localOnly: false,
      sensitive: true,
      language: "ja",
    });
  });

  it("reads Misskey defaultNoteVisibility/defaultNoteLocalOnly", () => {
    expect(composePrefsOf(misskeyMe({ defaultNoteVisibility: "home", defaultNoteLocalOnly: true }))).toEqual({
      visibilityRaw: "home",
      localOnly: true,
      sensitive: false,
      language: null,
    });
  });

  it("null me and unknown shapes read as no prefs", () => {
    expect(composePrefsOf(null)).toEqual({ visibilityRaw: null, localOnly: false, sensitive: false, language: null });
    expect(composePrefsOf({} as never).visibilityRaw).toBeNull();
  });

  it("an unknown preferredRaw narrows, never public", () => {
    expect(defaultVisibilityFor("mastodon", null, "list:weird").raw).toBe("private");
    expect(defaultVisibilityFor("misskey", null, "list:weird").raw).toBe("followers");
    // Known values still round-trip verbatim.
    expect(defaultVisibilityFor("mastodon", null, "unlisted").raw).toBe("unlisted");
    // Absent still keeps today's family default.
    expect(defaultVisibilityFor("mastodon", null).raw).toBe("public");
    expect(defaultVisibilityFor("misskey", null).raw).toBe("public");
  });

  it("replies still never widen the parent, even with a wider pref", () => {
    const parent = { visibility: { kind: "followers", localOnly: false, raw: "followers" } } as never;
    expect(defaultVisibilityFor("misskey", parent, "public").raw).toBe("followers");
  });
});

describe("sensitive/language emission (repair X6.2 step 5)", () => {
  function vctx(family: "misskey" | "mastodon", flavor: "misskey" | "mastodon") {
    return {
      family,
      gates: composeGates(family, buildCapabilities(flavor, undefined as never), null),
      limits: composeDefaultsFor(family),
    };
  }

  it("Mastodon emits sensitive + language, Misskey drops both", () => {
    const md = buildPostDraft(
      emptyComposeState({ text: "hi", sensitive: true, language: "ja" }),
      vctx("mastodon", "mastodon"),
    );
    expect(md.ok).toBe(true);
    if (md.ok) expect(md.draft).toMatchObject({ sensitive: true, language: "ja" });
    const mk = buildPostDraft(
      emptyComposeState({ text: "hi", sensitive: true, language: "ja" }),
      vctx("misskey", "misskey"),
    );
    expect(mk.ok).toBe(true);
    if (mk.ok) {
      expect(mk.draft).not.toHaveProperty("sensitive");
      expect(mk.draft).not.toHaveProperty("language");
    }
  });

  it("absent values stay absent on Mastodon (server default wins)", () => {
    const r = buildPostDraft(emptyComposeState({ text: "hi" }), vctx("mastodon", "mastodon"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft).not.toHaveProperty("sensitive");
      expect(r.draft).not.toHaveProperty("language");
    }
  });
});

describe("autocomplete unicode (repair X6.2 step 8)", () => {
  const cases: Array<[string, number, string, string]> = [
    // [text, caret, kind, query]
    ["#日本語", 4, "hashtag", "日本語"],
    ["see #café", 9, "hashtag", "café"],
    ["hi @josé", 8, "mention", "josé"],
    ["hi @josé!", 8, "mention", "josé"],
    ["x :日本", 5, "emoji", "日本"],
  ];
  it.each(cases)("triggers %s at %d as %s %p", (text, caret, kind, query) => {
    const t = autocompleteTriggerAt(text, caret);
    expect(t).toMatchObject({ kind, query, end: caret });
    expect(text.slice(t!.start, t!.end)).toBe(`${kind === "mention" ? "@" : kind === "hashtag" ? "#" : ":"}${query}`);
  });

  it("replaces the full unicode token with no stray characters", () => {
    const t = autocompleteTriggerAt("#日本語", 4)!;
    const next = applyCompletion("#日本語", t, "#日本語タグ");
    expect(next).toEqual({ text: "#日本語タグ ", caret: "#日本語タグ".length + 1 });
  });
});

describe("formatByteLimit (repair X6.2 step 2)", () => {
  it("formats bytes with the runtime locale, never a literal", () => {
    expect(formatByteLimit(10 * 1024 * 1024)).toMatch(/10/);
    expect(formatByteLimit(16 * 1024 * 1024)).toMatch(/16/);
    expect(formatByteLimit(99 * 1024 * 1024)).toMatch(/99/);
    expect(formatByteLimit(500)).toMatch(/500/);
  });
});
