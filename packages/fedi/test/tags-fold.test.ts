// Phase 1 item A — port of /tmp/opencode/tags-fold-check.mjs into the repo as
// real tests against `src/api/tags` + `src/api/fold` (the /tmp script ran
// against an esbuild bundle; these import the real sources). Assertions
// preserved one-for-one from the script.
// Jest port: `describe/it/expect` are globals (no vitest import).
import { foldMfm } from "../src/api/fold";
import { parseTagBlocks } from "../src/api/tags";

describe("parseTagBlocks — block detection", () => {
  it("emoji-spaced block count", () => {
    const r = parseTagBlocks("hello #a 😂 #b :custom: #c world");
    expect(r.blocks).toEqual([["a", "b", "c"]]);
    expect(r.prunedText).toBe("hello  world");
    expect(r.blockedTags).toEqual(["a", "b", "c"]);
    expect(r.allTags).toEqual(["a", "b", "c"]);
  });

  it("lone tag no block", () => {
    const r = parseTagBlocks("#solo stays");
    expect(r.blocks).toEqual([]);
    expect(r.prunedText).toBe("#solo stays");
    expect(r.blockedTags).toEqual([]);
    expect(r.allTags).toEqual(["solo"]);
  });

  it("trailing block", () => {
    const r = parseTagBlocks("trailing one #two #three");
    expect(r.blocks).toEqual([["two", "three"]]);
    expect(r.prunedText).toBe("trailing one");
    expect(r.blockedTags).toEqual(["two", "three"]);
  });

  it("newline spacer block", () => {
    const r = parseTagBlocks("#a\n#b");
    expect(r.blocks).toEqual([["a", "b"]]);
    expect(r.prunedText).toBe("");
  });

  it("multi-block", () => {
    const r = parseTagBlocks("multi #a #b middle #c #d end");
    expect(r.blocks).toEqual([["a", "b"], ["c", "d"]]);
    expect(r.prunedText).toBe("multi  middle  end");
    expect(r.blockedTags).toEqual(["a", "b", "c", "d"]);
  });

  it("mixed blocks exclude the lone tag", () => {
    const r = parseTagBlocks("#lone intro #a #b");
    expect(r.blocks).toEqual([["a", "b"]]);
    expect(r.blockedTags).toEqual(["a", "b"]);
    expect(r.allTags).toEqual(["lone", "a", "b"]);
    expect(r.prunedText).toBe("#lone intro");
  });

  it("no-double-cover: blocked tags leave the prose", () => {
    const r = parseTagBlocks("post #x #y done");
    expect(r.allTags.includes("x") && r.allTags.includes("y")).toBe(true);
    expect(r.prunedText.includes("#x") || r.prunedText.includes("#y")).toBe(false);
  });

  it("dedupe preserves first-seen order", () => {
    expect(parseTagBlocks("#b #a #b #a").blockedTags).toEqual(["b", "a"]);
  });

  it("null", () => {
    expect(parseTagBlocks(null)).toEqual({
      prunedText: "",
      blocks: [],
      blockedTags: [],
      allTags: [],
    });
  });

  it("empty", () => {
    expect(parseTagBlocks("")).toEqual({
      prunedText: "",
      blocks: [],
      blockedTags: [],
      allTags: [],
    });
  });

  it("tagless intact", () => {
    const r = parseTagBlocks("no tags here");
    expect(r.prunedText).toBe("no tags here");
    expect(r.blocks).toEqual([]);
  });
});

describe("foldMfm — fold budgets", () => {
  it("long folds within budget on a word boundary", () => {
    const long = "w ".repeat(500); // 1000 chars of prose
    const f = foldMfm(long);
    expect(f.truncated).toBe(true);
    expect(f.text.length <= 750).toBe(true);
    expect(/\s$/.test(f.text) || f.text.length === 0).toBe(false);
  });

  it("short intact", () => expect(foldMfm("short post")).toEqual({ text: "short post", truncated: false }));
  it("null fold", () => expect(foldMfm(null)).toEqual({ text: "", truncated: false }));
  it("empty fold", () => expect(foldMfm("")).toEqual({ text: "", truncated: false }));

  it("mentions/links don't count", () => {
    const prose700 = "x".repeat(700) + " tail end here";
    const f = foldMfm(
      `${prose700} @alice @bob https://example.com/very/long/path [label](https://a.b/c)`,
    );
    expect(f.text.includes("@alice")).toBe(true);
    expect(f.text.includes("https://example.com/very/long/path")).toBe(true);
  });

  it("hashtags DO count", () => {
    const taggy = `${"y".repeat(740)} #countedtag`;
    expect(foldMfm(taggy).truncated).toBe(true);
  });

  it("a tag straddling the budget is never sliced", () => {
    const edge = `${"z".repeat(749)} #nevercut`;
    const f = foldMfm(edge);
    expect(f.text.includes("#nev") && !f.text.includes("#nevercut")).toBe(false);
    expect(f.truncated).toBe(true);
    expect(f.text).toBe(`${"z".repeat(749)} `);
  });

  it("zero-count node after the cut is dropped", () => {
    const manyMentions = `${"q".repeat(800)} @late @later`;
    const f = foldMfm(manyMentions);
    expect(f.text.includes("@late")).toBe(false);
    expect(f.truncated).toBe(true);
  });
});
