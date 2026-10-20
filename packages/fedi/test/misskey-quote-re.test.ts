// Phase 1 item A — port of /tmp/opencode/quote-re-check.mjs (widened RE:
// heuristic: leading-or-terminal) into the repo as real tests against
// `src/api/quote`. Assertions preserved one-for-one from the script, which
// already imported the real source module.
import {
  cleanQuoteUrl,
  getQuoteTarget,
  parseLeadingQuote,
  parseTextualQuote,
  parseTextualQuotes,
  structuredUrisOf,
  urisMatch,
} from "../src/misskey/quote";
import type { Note } from "../src/misskey/wire";
import type { Post } from "../src/core/models";
import { postFromWire, type WireNotePatch } from "./helpers";

const N = (over: WireNotePatch = {}): Post =>
  postFromWire({
    id: "n1",
    text: null,
    cw: null,
    replyId: null,
    poll: null,
    fileIds: [],
    renoteId: null,
    renote: null,
    quoteTargetUri: null,
    quoteTargetUnavailable: false,
    quoteAuthorizationStatus: null,
    ...over,
  });

describe("parseTextualQuote — suffix legacy", () => {
  it("suffix uri", () => {
    const s = parseTextualQuote("commentary\nRE: https://example.social/notes/123");
    expect(s?.uri).toBe("https://example.social/notes/123");
  });
  it("suffix position", () => {
    const s = parseTextualQuote("commentary\nRE: https://example.social/notes/123");
    expect(s?.position).toBe("suffix");
  });
  it("suffix end at len", () => {
    const text = "commentary\nRE: https://example.social/notes/123";
    expect(parseTextualQuote(text)?.end).toBe(text.length);
  });
  it("suffix trailing punct", () => {
    const s = parseTextualQuote("RE: https://example.social/notes/123.");
    expect(s?.uri).toBe("https://example.social/notes/123");
    expect(s?.position).toBe("suffix");
  });
  it("suffix mid-sentence reject", () =>
    expect(parseTextualQuote("see RE: https://x.y/z for details")).toBeNull());
  it("suffix multi-token reject", () =>
    expect(parseTextualQuote("notes RE: https://x.y/z extra")).toBeNull());
  it("suffix lowercase reject", () =>
    expect(parseTextualQuote("notes re: https://x.y/z")).toBeNull());
  it("suffix scheme-less reject", () =>
    expect(parseTextualQuote("notes RE: example.social/notes/1")).toBeNull());
  it("suffix credential reject", () =>
    expect(parseTextualQuote("notes RE: https://user@example.social/1")).toBeNull());
  it("suffix non-web reject", () =>
    expect(parseTextualQuote("notes RE: javascript:alert(1)")).toBeNull());
  it("suffix null", () => expect(parseTextualQuote(null)).toBeNull());
});

describe("parseLeadingQuote — prefix", () => {
  it("prefix uri / start / end / position", () => {
    const p = parseLeadingQuote("RE: https://meow.social/@u/123\nSome commentary here.");
    expect(p?.uri).toBe("https://meow.social/@u/123");
    expect(p?.start).toBe(0);
    expect(p?.end).toBe("RE: https://meow.social/@u/123\n".length);
    expect(p?.position).toBe("prefix");
  });
  it("prefix comment-on-same-line reject", () =>
    expect(parseLeadingQuote("RE: https://x.y/z plus words")).toBeNull());
  it("prefix lowercase reject", () =>
    expect(parseLeadingQuote("re: https://x.y/z\nbody")).toBeNull());
  it("prefix mid-text reject", () =>
    expect(parseLeadingQuote("hi\nRE: https://x.y/z\n")).toBeNull());
  it("prefix scheme-less reject", () =>
    expect(parseLeadingQuote("RE: example.social/1\nbody")).toBeNull());
  it("prefix credential reject", () =>
    expect(parseLeadingQuote("RE: https://u@example.social/1\nb")).toBeNull());
  it("prefix non-web reject", () =>
    expect(parseLeadingQuote("RE: data:text/plain,hi\nb")).toBeNull());
  it("prefix trailing punct", () =>
    expect(parseLeadingQuote("RE: https://x.y/z.\nbody")?.uri).toBe("https://x.y/z"));
  it("prefix null", () => expect(parseLeadingQuote(null)).toBeNull());
});

describe("parseTextualQuotes — wrapper", () => {
  it("wrapper none", () => expect(parseTextualQuotes("just words https://x.y/z")).toEqual([]));
  it("both-ends-conflict", () => {
    const both = parseTextualQuotes("RE: https://a.b/1\nmiddle\nRE: https://a.b/2");
    expect(both.length).toBe(2);
    expect(both.map((m) => m.position)).toEqual(["prefix", "suffix"]);
    expect(both.map((m) => m.uri)).toEqual(["https://a.b/1", "https://a.b/2"]);
  });
  it("whole-text merges to one", () => {
    const same = parseTextualQuotes("RE: https://a.b/1");
    expect(same.length).toBe(1);
    expect([same[0].start, same[0].end]).toEqual([0, "RE: https://a.b/1".length]);
  });
  it("both-ends-same separate non-overlapping ranges", () => {
    const same = parseTextualQuotes("RE: https://a.b/1\nbody\nRE: https://a.b/1");
    expect(same.length).toBe(2);
    expect(same.map((m) => m.uri)).toEqual(["https://a.b/1", "https://a.b/1"]);
    expect(same[0].end <= same[1].start).toBe(true);
  });
});

describe("getQuoteTarget precedence", () => {
  it("prefix-only textual", () =>
    expect(getQuoteTarget(N({ text: "RE: https://a.b/1\ncommentary" }))).toEqual({
      uri: "https://a.b/1",
      source: "textual-fallback",
    }));
  it("both-differ prefers suffix", () =>
    expect(getQuoteTarget(N({ text: "RE: https://a.b/1\nmid\nRE: https://a.b/2" }))).toEqual({
      uri: "https://a.b/2",
      source: "textual-fallback",
    }));
  it("structured wins over prefix", () => {
    const t = getQuoteTarget(
      N({
        text: "RE: https://a.b/1\ncommentary",
        renoteId: "q1",
        renote: { id: "q1", uri: "https://a.b/1" } as Note,
      }),
    );
    expect(t?.source).toBe("structured");
    expect(t?.noteId).toBe("q1");
  });
  it("structured wins over conflicting suffix", () =>
    expect(
      getQuoteTarget(
        N({
          text: "commentary\nRE: https://evil.example/9",
          renoteId: "q1",
          renote: { id: "q1", uri: "https://a.b/1" } as Note,
        }),
      ),
    ).toEqual({ source: "structured", noteId: "q1", uri: "https://a.b/1" }));
  it("no markers no target", () =>
    expect(getQuoteTarget(N({ text: "plain words", renoteId: null }))).toBeNull());
});

describe("urisMatch / structuredUrisOf / cleanQuoteUrl", () => {
  it("uris exact", () => expect(urisMatch("https://a.b/1", "https://a.b/1")).toBe(true));
  it("uris trailing slash", () => expect(urisMatch("https://a.b/1", "https://a.b/1/")).toBe(false));
  it("uris different path", () =>
    expect(urisMatch("https://m.s/@u/1", "https://m.s/notes/1")).toBe(false));
  it("clean trims punct", () => expect(cleanQuoteUrl("https://a.b/1...")).toBe("https://a.b/1"));
  it("clean rejects relative", () => expect(cleanQuoteUrl("/notes/1")).toBeNull());
  it("structured uris", () =>
    expect(
      structuredUrisOf(
        N({ renote: { uri: "https://a.b/ap/1", url: "https://a.b/@u/1" } as Note }),
      ),
    ).toEqual(["https://a.b/ap/1", "https://a.b/@u/1"]));
  it("structured uris include the Mastodon-family quote target", () => {
    const base = N({});
    const post: Post = {
      ...base,
      quote: {...base, uri: "https://a.b/ap/9", url: "https://a.b/@u/9"},
    };
    expect(structuredUrisOf(post)).toEqual(["https://a.b/ap/9", "https://a.b/@u/9"]);
  });
});
