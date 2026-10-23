// Phase 2 core-model tests: the pure helpers must carry exactly the
// semantics their Misskey-wire predecessors had (api/types.ts) — the UI
// migration is behaviour-preserving, so these are the guard rails.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import {
  parseAcct,
  appendOlder,
  collapseReposts,
  appearNoteOf,
  handleOf,
  hasRealDisplayName,
  headNameOf,
  displayNameOf,
  isPureRenote,
  mfmContent,
  plainFromMfm,
  reactionMap,
  replaceWithPage,
  visibilityKindOf,
  visibilityOf,
  withFavourite,
  withReaction,
  type Account,
  type Post,
} from "../src/core/models";

function account(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    username: `user${id}`,
    acct: `user${id}`,
    host: null,
    name: null,
    displayName: `user${id}`,
    bio: { plain: "" },
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 0,
    followingCount: 0,
    statusesCount: 0,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [],
    movedTo: null,
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
    ...over,
  };
}

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    createdAt: "2026-10-17T00:00:00.000Z",
    author: account("a"),
    accountId: "a",
    content: { mfm: "hello", plain: "hello" },
    cw: null,
    visibility: visibilityOf("public", false),
    counts: { replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0 },
    reactions: null,
    favourite: null,
    media: [],
    mediaIds: [],
    poll: null,
    card: null,
    quote: null,
    quoteState: null,
    quoteUnavailable: false,
    renote: null,
    reply: null,
    replyToId: null,
    renoteId: null,
    uri: null,
    url: null,
    emojis: {},
    mentions: [],
    tags: [],
    editedAt: null,
    filtered: [],
    pinned: false,
    ext: {},
    ...over,
  };
}

describe("visibility", () => {
  it("maps Misskey home to quiet and keeps raw verbatim", () => {
    const v = visibilityOf("home", false);
    expect(v.kind).toBe("quiet");
    expect(v.raw).toBe("home");
    expect(v.localOnly).toBe(false);
  });

  it("maps each known wire value", () => {
    expect(visibilityKindOf("public")).toBe("public");
    expect(visibilityKindOf("unlisted")).toBe("quiet");
    expect(visibilityKindOf("followers")).toBe("followers");
    expect(visibilityKindOf("private")).toBe("followers");
    expect(visibilityKindOf("specified")).toBe("direct");
    expect(visibilityKindOf("direct")).toBe("direct");
  });

  it("never rounds an unknown value up to public", () => {
    expect(visibilityKindOf("list:abc123")).toBe("direct");
    expect(visibilityKindOf("")).toBe("direct");
  });

  it("keeps localOnly separate from kind", () => {
    const v = visibilityOf("public", true);
    expect(v.kind).toBe("public");
    expect(v.localOnly).toBe(true);
    expect(v.raw).toBe("public");
  });
});

describe("plainFromMfm", () => {
  it("strips emoji codes to their names", () => {
    expect(plainFromMfm("hi :blobcat: there")).toBe("hi blobcat there");
    expect(plainFromMfm(":name@remote.example:")).toBe("name@remote.example");
  });

  it("unwraps links to their labels and bare urls", () => {
    expect(plainFromMfm("[label](https://example.com)")).toBe("label");
    expect(plainFromMfm("<https://example.com>")).toBe("https://example.com");
    expect(plainFromMfm("https://example.com")).toBe("https://example.com");
  });

  it("keeps mention and hashtag text without the sigil", () => {
    expect(plainFromMfm("@user@host hello")).toBe("user@host hello");
    expect(plainFromMfm("#tag")).toBe("tag");
  });

  it("strips inline markers and quote markers", () => {
    expect(plainFromMfm("**bold** *it* `code`")).toBe("bold it code");
    expect(plainFromMfm("> quoted")).toBe("quoted");
    expect(plainFromMfm("<plain>**raw**</plain>")).toBe("**raw**");
  });

  it("handles null/empty input", () => {
    expect(plainFromMfm(null)).toBe("");
    expect(plainFromMfm(undefined)).toBe("");
  });

  it("mfmContent leaves empty source without an mfm field", () => {
    expect(mfmContent("").mfm).toBeUndefined();
    expect(mfmContent("x").mfm).toBe("x");
  });
});

describe("isPureRenote / appearNoteOf", () => {
  const wrapper = post("w", {
    renoteId: "o",
    renote: post("o"),
    content: { plain: "" },
  });

  it("treats a contentless wrapper as a pure renote", () => {
    expect(isPureRenote(wrapper)).toBe(true);
    expect(appearNoteOf(wrapper).id).toBe("o");
  });

  it("treats a wrapper with any own content as a quote", () => {
    expect(isPureRenote({ ...wrapper, cw: "cw" })).toBe(false);
    expect(isPureRenote({ ...wrapper, content: mfmContent("text") })).toBe(false);
    expect(isPureRenote({ ...wrapper, replyToId: "x" })).toBe(false);
    expect(isPureRenote({ ...wrapper, mediaIds: ["m"] })).toBe(false);
    expect(
      isPureRenote({
        ...wrapper,
        poll: {
          multiple: false,
          expiresAt: null,
          expired: false,
          votesCount: 0,
          votersCount: null,
          options: [{ text: "a", votesCount: 0, voted: false }],
        },
      }),
    ).toBe(false);
  });

  it("falls back to the wrapper when the original is unavailable", () => {
    expect(appearNoteOf({ ...wrapper, renote: null }).id).toBe("w");
  });

  it("never treats a plain post as a pure renote", () => {
    expect(isPureRenote(post("p"))).toBe(false);
    expect(appearNoteOf(post("p")).id).toBe("p");
  });
});

describe("withReaction", () => {
  const base = post("n", {
    reactions: {
      total: 2,
      entries: [
        { key: "👍", count: 2, mine: false, url: null },
      ],
      mine: null,
      myReactions: [],
      urls: { ":blob:": "https://example.com/blob.png" },
    },
    counts: { replies: 0, boosts: 0, quotes: 0, reactions: 2, favourites: 0 },
  });

  it("adds a reaction and bumps the total", () => {
    const next = withReaction(base, "❤");
    expect(next.reactions?.mine).toBe("❤");
    expect(next.reactions?.total).toBe(3);
    expect(next.reactions?.entries).toEqual([
      { key: "👍", count: 2, mine: false, url: null },
      { key: "❤", count: 1, mine: true, url: null },
    ]);
  });

  it("switches: removes the previous entry and adds the new one", () => {
    const liked = withReaction(base, "❤");
    const switched = withReaction(liked, "🎉");
    expect(switched.reactions?.mine).toBe("🎉");
    expect(switched.reactions?.total).toBe(3);
    expect(switched.reactions?.entries.map((e) => e.key)).toEqual(["👍", "🎉"]);
  });

  it("clearing removes the entry", () => {
    const liked = withReaction(base, "👍");
    expect(liked.reactions?.total).toBe(3);
    const cleared = withReaction(liked, null);
    expect(cleared.reactions?.mine).toBeNull();
    expect(cleared.reactions?.total).toBe(2);
    expect(cleared.reactions?.entries).toEqual([
      { key: "👍", count: 2, mine: false, url: null },
    ]);
  });

  it("is a no-op when the reaction is unchanged", () => {
    const liked = withReaction(base, "❤");
    expect(withReaction(liked, "❤")).toBe(liked);
  });

  it("resolves the emoji url from the packed map", () => {
    const next = withReaction(base, ":blob:");
    expect(next.reactions?.entries.find((e) => e.key === ":blob:")?.url).toBe(
      "https://example.com/blob.png",
    );
  });

  it("never drives the total below zero", () => {
    const empty = post("n", {
      reactions: { total: 0, entries: [], mine: "❤", myReactions: ["❤"], urls: {} },
    });
    const next = withReaction(empty, null);
    expect(next.reactions?.total).toBe(0);
  });
});

describe("collapseReposts", () => {
  const renoter = (id: string) => account(id);
  const original = post("o");
  const wrapperOf = (id: string, userId: string) =>
    post(id, {
      renoteId: "o",
      renote: original,
      content: { plain: "" },
      author: renoter(userId),
    });

  it("collapses an original plus its reposts to the first repost", () => {
    const feed = [wrapperOf("r1", "u1"), wrapperOf("r2", "u2"), original];
    const { reps, renotersByRep } = collapseReposts(feed);
    expect(reps).toEqual(new Set(["r1"]));
    expect(renotersByRep.get("r1")?.map((u) => u.id)).toEqual(["u1", "u2"]);
  });

  it("keeps quotes visible — they never collapse", () => {
    const quote = post("q", {
      renoteId: "o",
      renote: original,
      content: mfmContent("my take"),
    });
    const { reps } = collapseReposts([quote, wrapperOf("r1", "u1"), original]);
    expect(reps.has("q")).toBe(true);
    expect(reps.has("r1")).toBe(true);
    expect(reps.has("o")).toBe(false);
  });

  it("aggregates renoters once each, in feed order", () => {
    const feed = [wrapperOf("r1", "u1"), wrapperOf("r2", "u1"), wrapperOf("r3", "u2")];
    const { renotersByRep } = collapseReposts(feed);
    expect(renotersByRep.get("r1")?.map((u) => u.id)).toEqual(["u1", "u2"]);
  });

  it("does not mutate its input and returns fresh collections", () => {
    const feed = [wrapperOf("r1", "u1")];
    const first = collapseReposts(feed);
    const second = collapseReposts(feed);
    expect(first.reps).not.toBe(second.reps);
    expect(first.renotersByRep).not.toBe(second.renotersByRep);
    expect(feed).toHaveLength(1);
  });

  it("groups by renoteId even without a packed original", () => {
    const orphan = post("r9", {
      renoteId: "gone",
      renote: null,
      content: { plain: "" },
    });
    const { reps, renotersByRep } = collapseReposts([orphan, post("x")]);
    expect(reps.has("r9")).toBe(true);
    expect(renotersByRep.has("r9")).toBe(true);
  });
});

describe("display-name helpers", () => {
  it("displayNameOf falls back to username only when name is empty", () => {
    expect(displayNameOf({ name: "Ann", username: "a" })).toBe("Ann");
    expect(displayNameOf({ name: null, username: "a" })).toBe("a");
    expect(displayNameOf({ name: "", username: "a" })).toBe("a");
  });

  it("handleOf includes the host only for remote accounts", () => {
    expect(handleOf({ username: "a", host: null })).toBe("@a");
    expect(handleOf({ username: "a", host: "ex.ample" })).toBe("@a@ex.ample");
  });

  it("parseAcct splits mention labels into lookup refs, rejects non-handles", () => {
    expect(parseAcct("@bob")).toEqual({ username: "bob", host: null });
    expect(parseAcct("bob")).toEqual({ username: "bob", host: null });
    expect(parseAcct("@bob@ex.ample")).toEqual({ username: "bob", host: "ex.ample" });
    expect(parseAcct("bob@ex.ample")).toEqual({ username: "bob", host: "ex.ample" });
    // Bridged actors carry dots in the username part.
    expect(parseAcct("@alice.bsky.social@bsky.brid.gy")).toEqual({
      username: "alice.bsky.social",
      host: "bsky.brid.gy",
    });
    expect(parseAcct("@.leading@bsky.brid.gy")).toBeNull();
    expect(parseAcct("@trailing.@bsky.brid.gy")).toBeNull();
    expect(parseAcct(null)).toBeNull();
    expect(parseAcct("")).toBeNull();
    expect(parseAcct("@")).toBeNull();
    expect(parseAcct("not a handle")).toBeNull();
    expect(parseAcct("@a@b@c")).toBeNull();
    expect(parseAcct("@bob@")).toBeNull();
  });

  it("hasRealDisplayName rejects the handle echoed back as a name", () => {
    expect(hasRealDisplayName({ name: "Ann", username: "a", host: null })).toBe(true);
    expect(hasRealDisplayName({ name: null, username: "a", host: null })).toBe(false);
    expect(hasRealDisplayName({ name: "pndc", username: "pndc", host: null })).toBe(false);
    expect(hasRealDisplayName({ name: "@pndc", username: "pndc", host: null })).toBe(false);
    expect(
      hasRealDisplayName({ name: "@pndc@host", username: "pndc", host: "host" }),
    ).toBe(false);
    expect(
      hasRealDisplayName({ name: "pndc@host", username: "pndc", host: "host" }),
    ).toBe(false);
  });

  it("headNameOf falls back to the whole handle, never a bare username", () => {
    expect(headNameOf({ name: "Ann", username: "a", host: null })).toBe("Ann");
    expect(headNameOf({ name: null, username: "a", host: null })).toBe("@a");
    expect(headNameOf({ name: null, username: "a", host: "ex" })).toBe("@a@ex");
  });
});

describe("paging helpers", () => {
  it("appendOlder dedupes by id and reports how many were new", () => {
    const cur = [post("1"), post("2")];
    const res = appendOlder(cur, [post("2"), post("3")]);
    expect(res.added).toBe(1);
    expect(res.items.map((p) => p.id)).toEqual(["1", "2", "3"]);
    const none = appendOlder(res.items, [post("3")]);
    expect(none.added).toBe(0);
    expect(none.items).toBe(res.items);
  });

  it("replaceWithPage dedupes within the page", () => {
    expect(replaceWithPage([post("1"), post("1"), post("2")]).map((p) => p.id)).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("reactionMap", () => {
  it("derives the key→count map preserving entry order", () => {
    const map = reactionMap({
      total: 5,
      entries: [
        { key: "a", count: 3, mine: false, url: null },
        { key: "b", count: 2, mine: true, url: null },
      ],
      mine: "b",
      myReactions: ["b"],
      urls: {},
    });
    expect(Object.keys(map)).toEqual(["a", "b"]);
    expect(map).toEqual({ a: 3, b: 2 });
    expect(reactionMap(null)).toEqual({});
  });
});

describe("withFavourite", () => {
  it("moves the flag and the count together, clamped at zero", () => {
    const base = post("f1", {
      favourite: { count: 2, mine: false },
      counts: { replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 2 },
    });
    const on = withFavourite(base, true);
    expect(on.favourite).toEqual({ count: 3, mine: true });
    expect(on.counts.favourites).toBe(3);
    const off = withFavourite(on, false);
    expect(off.favourite).toEqual({ count: 2, mine: false });
    expect(withFavourite(withFavourite(off, false), false).favourite?.count).toBe(2);
    const zero = withFavourite(
      post("f2", {
        favourite: { count: 0, mine: true },
        counts: { replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0 },
      }),
      false,
    );
    expect(zero.favourite).toEqual({ count: 0, mine: false });
  });

  it("never touches reactions and is a no-op without favourite state", () => {
    const base = post("f3", {
      favourite: { count: 1, mine: false },
      reactions: {
        total: 5,
        entries: [{ key: "🎉", count: 5, mine: true, url: null }],
        mine: "🎉",
        myReactions: ["🎉"],
        urls: {},
      },
    });
    const on = withFavourite(base, true);
    expect(on.reactions).toBe(base.reactions); // favourites ≠ reactions
    const misskey = post("f4", { favourite: null });
    expect(withFavourite(misskey, true)).toBe(misskey);
  });
});
