// Reference-only reaction write path (`misskey/reactionActions.ts` +
// `myReactions.ts`, replaced by post-shadow + toggle queue in Phase 4).
//
// Jest port: `describe/it/expect/beforeEach` are globals (no vitest
// import); `vi.fn` → `jest.fn`. The old test mocked `../api/client` and
// used Solid signals — both gone in this package: the backend is an
// explicit provider seam (`setReactionBackendProvider`) and the note list
// is a plain array. All four cases (T1–T4) preserved one-for-one.
//
// NOTE: the slice brief cites "six test cases" for these modules; the old
// file contains exactly four `it` blocks (T1–T4, counted by grep). All four
// are ported here — no delta, but the count claim is recorded as wrong.
import type { Post } from "../src/core/models";

import { requestReaction, setReactionBackendProvider } from "../src/misskey/reactionActions";
import { clearMyReaction, effectiveMyReaction } from "../src/misskey/myReactions";

const backendHolder: { current: {
  react: (...args: unknown[]) => Promise<void>;
  unreact: (...args: unknown[]) => Promise<void>;
  post: (...args: unknown[]) => Promise<Post>;
} | null } = { current: null };

setReactionBackendProvider(() => {
  if (!backendHolder.current) throw new Error("no reaction backend");
  const { react, unreact } = backendHolder.current;
  return {
    react: (id: string, reaction: string) => react(id, reaction),
    unreact: (id: string) => unreact(id),
  };
});

// minimal post factory
function post(id: string, mine: string | null = null): Post {
  return {
    id,
    createdAt: "2026-10-18T00:00:00.000Z",
    author: { id: "a", username: "u", acct: "u", host: null, name: null, displayName: "u", bio: { plain: "" }, url: null, uri: null, avatarUrl: null, avatarBlurhash: null, headerUrl: null, headerBlurhash: null, followersCount: 0, followingCount: 0, statusesCount: 0, locked: false, bot: false, cat: false, silenced: false, suspended: false, onlineStatus: null, location: null, birthday: null, createdAt: null, updatedAt: null, lastFetchedAt: null, emojis: {}, fields: [], movedTo: null, ffVisibility: null, pinnedPostIds: null, pinnedPosts: null, ext: {} },
    accountId: "a",
    content: { mfm: "hi", plain: "hi" },
    cw: null,
    visibility: { kind: "public", raw: "public", localOnly: false },
    counts: { replies: 0, boosts: 0, quotes: 0, reactions: 0, favourites: 0 },
    reactions: mine ? { total: 1, entries: [{ key: mine, count: 1, mine: true, url: null }], mine, myReactions: [mine], urls: {} } : { total: 0, entries: [], mine: null, myReactions: [], urls: {} },
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
  } as unknown as Post;
}

describe("reactionActions", () => {
  let react: jest.Mock;
  let unreact: jest.Mock;
  let postFn: jest.Mock;

  beforeEach(() => {
    react = jest.fn().mockResolvedValue(undefined);
    unreact = jest.fn().mockResolvedValue(undefined);
    postFn = jest.fn().mockResolvedValue(post("n"));
    backendHolder.current = { react, unreact, post: postFn };
    clearMyReaction("a");
    clearMyReaction("n");
  });

  it("T1 like sync", async () => {
    // Port fix (see file header): the old file built `post("a")` here while
    // asserting the write went to `"n"` — stale id, never executed upstream
    // (old vitest `include` covers only `test/**`). Uses `post("n")`.
    const n = post("n");
    let notes = [n];
    const host = {
      token: "tok",
      getNote: (id: string) => notes.find((x) => x.id === id),
      applyNote: (id: string, u: (p: Post) => Post) => {
        notes = notes.map((x) => (x.id === id ? u(x) : x));
      },
      refreshNote: async (id: string) => {
        const f = (await postFn(id)) as Post;
        notes = notes.map((x) => (x.id === id ? f : x));
      },
      setError: jest.fn(),
    };
    const p = requestReaction(host, n, "❤");
    // sync overlay
    expect(effectiveMyReaction(n)).toBe("❤");
    await p;
    expect(react).toHaveBeenCalledWith("n", "❤");
  });

  it("T2 reject rolls back", async () => {
    react.mockRejectedValueOnce(new Error("boom"));
    const n = post("n");
    let notes = [n];
    const host = {
      token: "tok",
      getNote: (id: string) => notes.find((x) => x.id === id),
      applyNote: (id: string, u: (p: Post) => Post) => {
        notes = notes.map((x) => (x.id === id ? u(x) : x));
      },
      refreshNote: async (id: string) => {
        const f = (await postFn(id)) as Post;
        notes = notes.map((x) => (x.id === id ? f : x));
      },
      setError: jest.fn(),
    };
    await requestReaction(host, n, "❤");
    expect(host.setError).toHaveBeenCalled();
  });

  it("T3 unlike calls unreact", async () => {
    const n = post("n", "❤");
    let notes = [n];
    const host = {
      token: "tok",
      getNote: (id: string) => notes.find((x) => x.id === id),
      applyNote: (id: string, u: (p: Post) => Post) => {
        notes = notes.map((x) => (x.id === id ? u(x) : x));
      },
      refreshNote: async (id: string) => {
        const f = (await postFn(id)) as Post;
        notes = notes.map((x) => (x.id === id ? f : x));
      },
      setError: jest.fn(),
    };
    await requestReaction(host, n, null);
    expect(unreact).toHaveBeenCalledWith("n");
  });

  it("T4 like then unlike during flight", async () => {
    let resolveReact!: () => void;
    const reactPromise = new Promise<void>((r) => {
      resolveReact = r;
    });
    react.mockReturnValueOnce(reactPromise);
    const n = post("n");
    let notes = [n];
    const host = {
      token: "tok",
      getNote: (id: string) => notes.find((x) => x.id === id),
      applyNote: (id: string, u: (p: Post) => Post) => {
        notes = notes.map((x) => (x.id === id ? u(x) : x));
      },
      refreshNote: async (id: string) => {
        const f = (await postFn(id)) as Post;
        notes = notes.map((x) => (x.id === id ? f : x));
      },
      setError: jest.fn(),
    };
    const p1 = requestReaction(host, n, "❤");
    // mid-flight unlike
    const p2 = requestReaction(host, host.getNote("n")!, null);
    resolveReact();
    await Promise.all([p1, p2]);
    // calls: react then unreact
    expect(react).toHaveBeenCalled();
    expect(unreact).toHaveBeenCalled();
  });
});
