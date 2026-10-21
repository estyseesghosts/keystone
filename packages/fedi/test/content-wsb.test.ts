// WS-B content rendering: structural markers (bullet / heading /
// invisible) across the AST readers, the timeline fold, and tag pruning.
// fromHtml mapping itself is pinned in content-html.test.ts (MD4 block).
import {
  br,
  bullet,
  foldTree,
  heading,
  invisible,
  isBlankContent,
  plainTextOf,
  pruneTagBlocks,
  t,
  textOf,
  type ContentNode,
} from "../src/index";

describe("structural marker readers", () => {
  it("textOf/plainTextOf count the bullet and skip the hidden run", () => {
    const nodes: ContentNode[] = [
      heading(1, [t("Title")]),
      br(),
      br(),
      bullet(),
      t("one"),
      { kind: "invisible", text: "hidden" },
    ];
    expect(textOf(nodes)).toBe("Title\u2022 one");
    expect(plainTextOf(nodes)).toBe("Title\n\n\u2022 one");
  });

  it("isBlankContent treats lone markers as blank", () => {
    expect(isBlankContent([bullet()])).toBe(true);
    expect(isBlankContent([invisible("x")])).toBe(true);
    expect(isBlankContent([bullet(), t("  ")])).toBe(true);
    expect(isBlankContent([heading(2, [t("x")])])).toBe(false);
    expect(isBlankContent([heading(2, [])])).toBe(true);
  });
});

describe("fold with structural markers", () => {
  it("keeps a bullet whole and budgets its marker", () => {
    const folded = foldTree([bullet(), t("x".repeat(800))]);
    expect(folded.folded).toBe(true);
    expect(textOf(folded.nodes).startsWith("\u2022 ")).toBe(true);
    expect(textOf(folded.nodes).endsWith("…")).toBe(true);
  });

  it("an invisible node costs nothing and never leaks", () => {
    const nodes: ContentNode[] = [t("a"), invisible("very/long/hidden"), t("b")];
    const folded = foldTree(nodes);
    expect(folded.folded).toBe(false);
    expect(textOf(folded.nodes)).toBe("ab");
  });

  it("folds inside heading children like any container", () => {
    const folded = foldTree([heading(1, [t("x".repeat(800))])]);
    expect(folded.folded).toBe(true);
    expect(textOf(folded.nodes).endsWith("…")).toBe(true);
  });
});

describe("tag pruning around structural markers", () => {
  it("a bullet between tags breaks the run (no cross-item block)", () => {
    const nodes: ContentNode[] = [
      { kind: "hashtag", tag: "a", href: null, children: [t("#a")] },
      br(),
      br(),
      bullet(),
      { kind: "hashtag", tag: "b", href: null, children: [t("#b")] },
    ];
    const pruned = pruneTagBlocks(nodes);
    expect(pruned.blocks).toEqual([]);
    expect(pruned.allTags).toEqual(["a", "b"]);
    expect(textOf(pruned.nodes)).toBe("#a\u2022 #b");
  });

  it("a tag block after a heading prunes with the heading kept", () => {
    const nodes: ContentNode[] = [
      heading(2, [t("Tags")]),
      br(),
      br(),
      { kind: "hashtag", tag: "a", href: null, children: [t("#a")] },
      t(" "),
      { kind: "hashtag", tag: "b", href: null, children: [t("#b")] },
    ];
    const pruned = pruneTagBlocks(nodes);
    expect(pruned.blocks).toEqual([["a", "b"]]);
    expect(textOf(pruned.nodes)).toBe("Tags");
  });

  it("an invisible node between tags breaks the run (never merges text)", () => {
    const nodes: ContentNode[] = [
      { kind: "hashtag", tag: "a", href: null, children: [t("#a")] },
      invisible("x"),
      { kind: "hashtag", tag: "b", href: null, children: [t("#b")] },
    ];
    const pruned = pruneTagBlocks(nodes);
    expect(pruned.blocks).toEqual([]);
    expect(textOf(pruned.nodes)).toBe("#a#b");
  });
});
