// Fork recommendations feed (dvd-sharkey): pure helpers + wire module.
// Jest port: `describe/it/expect` are globals (no vitest import).
import { ApiError } from "../src/core/errors";
import {
  decodeRecCursor,
  defaultRecLanguage,
  defaultRecommendationSettings,
  encodeRecCursor,
  recLangForLocale,
  recommendationSettingsOf,
  recommendationsEnabled,
} from "../src/core/recommendations";
import {
  adaptRecommendationNotes,
  fetchRecommendationInterests,
  fetchRecommendationPage,
  markRecommendationNotInterested,
  probeRecommendations,
  recommendationsSupportFor,
  reportRecommendationDwell,
  resetRecommendationsSupportCache,
  updateRecommendationSettings,
} from "../src/misskey/recommendations";
import { formatFeedDescriptor, isFeedDescriptor, parseFeedDescriptor } from "../src/core/feedDescriptor";

function wireNote(id: string, factors?: unknown) {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: "u1",
    user: {
      id: "u1",
      name: null,
      username: "a",
      host: null,
      avatarUrl: null,
      avatarBlurhash: null,
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: "unknown",
    },
    text: "hello",
    cw: null,
    visibility: "public" as const,
    localOnly: false,
    reactionAcceptance: null,
    renoteCount: 0,
    repliesCount: 0,
    reactionCount: 0,
    reactions: {},
    reactionEmojis: {},
    fileIds: [],
    files: [],
    replyId: null,
    renoteId: null,
    reply: null,
    renote: null,
    mentions: [],
    tags: [],
    emojis: {},
    myReaction: null,
    poll: null,
    ...(factors !== undefined ? { _recommendationFactors_: factors } : {}),
  };
}

const BREAKDOWN = {
  type: "score",
  score: 1.234,
  subtotal: 1.0,
  topic: "tech",
  rows: [],
};

function unsupported(): ApiError {
  return new ApiError("nope", 404, "errors.unsupported.recommendations");
}

describe("recommendations helpers", () => {
  it("maps locales to recommender langs", () => {
    expect(recLangForLocale("ja")).toBe("ja");
    expect(recLangForLocale("ja-JP")).toBe("ja");
    expect(recLangForLocale("zh-CN")).toBe("zh");
    expect(recLangForLocale("yue-HK")).toBe("zh");
    expect(recLangForLocale("en")).toBe("en");
    expect(recLangForLocale("fr")).toBe("en");
    expect(recLangForLocale(null)).toBe("en");
    expect(defaultRecLanguage("zh-TW")).toBe("zh");
  });

  it("defaults enabled true when the field is missing", () => {
    expect(recommendationsEnabled(null)).toBe(true);
    expect(recommendationsEnabled({ ext: {} })).toBe(true);
    expect(recommendationsEnabled({ ext: { me: {} } })).toBe(true);
    expect(
      recommendationsEnabled({ ext: { me: { recommendationSettings: { enabled: false } } } }),
    ).toBe(false);
    expect(
      recommendationsEnabled({ ext: { me: { recommendationSettings: { enabled: true } } } }),
    ).toBe(true);
  });

  it("reads settings off ext.me with sane fallbacks", () => {
    const got = recommendationSettingsOf({
      ext: { me: { recommendationSettings: { enabled: false, recommendNsfw: true } } },
    });
    expect(got?.enabled).toBe(false);
    expect(got?.recommendNsfw).toBe(true);
    expect(got?.factors.relevancy).toBe(1);
    expect(got?.followedRatio).toBe(0.3);
    expect(recommendationSettingsOf(null)).toBeNull();
  });

  it("builds default settings from the locale", () => {
    const d = defaultRecommendationSettings("ja-JP");
    expect(d.languages).toEqual(["ja"]);
    expect(d.factors.relevancy).toBe(1);
    expect(d.engagement.boost).toBe(1);
    expect(d.followedRatio).toBe(0.3);
  });

  it("round-trips offset cursors, unknown reads as 0", () => {
    expect(decodeRecCursor(encodeRecCursor(25))).toBe(25);
    expect(decodeRecCursor(null)).toBe(0);
    expect(decodeRecCursor('{"untilId":"x"}' as never)).toBe(0);
    expect(decodeRecCursor("rec:abc" as never)).toBe(0);
  });

  it("parses the recommendations descriptor", () => {
    expect(parseFeedDescriptor("recommendations")).toEqual({ kind: "recommendations" });
    expect(formatFeedDescriptor({ kind: "recommendations" })).toBe("recommendations");
    expect(isFeedDescriptor("recommendations")).toBe(true);
  });
});

describe("recommendations wire", () => {
  beforeEach(() => resetRecommendationsSupportCache());

  it("pages by offset and keeps the breakdown transient", async () => {
    const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
    const call = async <T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ endpoint, params });
      return [wireNote("n1", BREAKDOWN), wireNote("n2")] as unknown as T;
    };
    const page = await fetchRecommendationPage(call, "https://x.example", null, {
      limit: 10,
      lang: "en",
      withSensitive: false,
      withRenotes: true,
    });
    expect(calls[0].endpoint).toBe("notes/recommendations");
    expect(calls[0].params).toMatchObject({ limit: 10, offset: 0, lang: "en" });
    expect(page.items).toHaveLength(2);
    expect(page.items[0].ext.recommendation).toMatchObject({ type: "score", topic: "tech" });
    expect(page.items[1].ext.recommendation).toBeUndefined();
    // Short page ends the queue.
    expect(page.end).toBe(true);
    expect(recommendationsSupportFor("https://x.example")).toBe(true);
  });

  it("advances the offset cursor across pages", async () => {
    const call = async <T>(): Promise<T> =>
      Array.from({ length: 10 }, (_, i) => wireNote(`n${i}`)) as unknown as T;
    const first = await fetchRecommendationPage(call, "https://x.example", null, { limit: 10 });
    expect(first.end).toBe(false);
    expect(decodeRecCursor(first.cursor)).toBe(10);
    const second = await fetchRecommendationPage(call, "https://x.example", first.cursor, {
      limit: 10,
    });
    expect(second.items).toHaveLength(10);
    expect(decodeRecCursor(second.cursor)).toBe(20);
  });

  it("marks unsupported on 404 and caches it", async () => {
    const call = async <T>(): Promise<T> => {
      throw unsupported();
    };
    await expect(fetchRecommendationPage(call, "https://old.example", null, {})).rejects.toThrow();
    expect(recommendationsSupportFor("https://old.example")).toBe(false);
    // Cached absence: probe answers false without wire traffic.
    let wired = false;
    const probeCall = async <T>(): Promise<T> => {
      wired = true;
      throw unsupported();
    };
    await expect(probeRecommendations(probeCall, "https://old.example")).resolves.toBe(false);
    expect(wired).toBe(false);
  });

  it("probes true on success", async () => {
    const call = async <T>(): Promise<T> => [] as unknown as T;
    await expect(probeRecommendations(call, "https://new.example")).resolves.toBe(true);
    expect(recommendationsSupportFor("https://new.example")).toBe(true);
  });

  it("chunks dwell to 50 per call and swallows errors", async () => {
    const seen: number[] = [];
    const call = async <T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
      seen.push((params.items as unknown[]).length);
      return {} as T;
    };
    const items = Array.from({ length: 120 }, (_, i) => ({ noteId: `n${i}`, dwellMs: 1000 }));
    await reportRecommendationDwell(call, "https://x.example", items);
    expect(seen).toEqual([50, 50, 20]);
    const failing = async <T>(): Promise<T> => {
      throw new Error("offline");
    };
    await expect(
      reportRecommendationDwell(failing, "https://y.example", [{ noteId: "n", dwellMs: 900 }]),
    ).resolves.toBeUndefined();
  });

  it("not-interested sends the unwrapped id", async () => {
    const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
    const call = async <T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ endpoint, params });
      return {} as T;
    };
    await markRecommendationNotInterested(call, "https://x.example", "inner-id");
    expect(calls[0]).toEqual({ endpoint: "notes/recommendations/not-interested", params: { noteId: "inner-id" } });
  });

  it("interests fall back to empty on failure", async () => {
    const ok = async <T>(): Promise<T> =>
      ({ interested: ["tech", 1], disinterested: "nope" }) as unknown as T;
    await expect(fetchRecommendationInterests(ok, "https://x.example")).resolves.toEqual({
      interested: ["tech"],
      disinterested: [],
    });
    const bad = async <T>(): Promise<T> => {
      throw new Error("boom");
    };
    await expect(fetchRecommendationInterests(bad, "https://x.example")).rejects.toThrow();
  });

  it("updateSettings posts the patch and adapts me", async () => {
    const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
    const me = {
      id: "u1",
      username: "a",
      name: null,
      host: null,
      avatarUrl: null,
      avatarBlurhash: null,
      isBot: false,
      isCat: false,
      emojis: {},
      onlineStatus: "unknown",
      recommendationSettings: { enabled: false },
    };
    const call = async <T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ endpoint, params });
      return me as unknown as T;
    };
    const account = await updateRecommendationSettings(call, "https://x.example", { enabled: false });
    expect(calls[0].endpoint).toBe("i/update");
    expect(calls[0].params).toEqual({ recommendationSettings: { enabled: false } });
    expect(account.id).toBe("u1");
  });

  it("ignores notes without a valid breakdown", () => {
    const posts = adaptRecommendationNotes([wireNote("n1", { type: "nope" }), wireNote("n2")]);
    expect(posts[0].ext.recommendation).toBeUndefined();
    expect(posts[1].ext.recommendation).toBeUndefined();
  });
});
