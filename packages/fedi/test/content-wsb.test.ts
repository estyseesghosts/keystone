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
  matrix,
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

  it("reads matrix children as text, never blank", () => {
    const nodes: ContentNode[] = [matrix("@jm:nope.chat", [t("@jm:nope.chat")])];
    expect(textOf(nodes)).toBe("@jm:nope.chat");
    expect(plainTextOf(nodes)).toBe("@jm:nope.chat");
    expect(isBlankContent(nodes)).toBe(false);
  });

  it("never cuts or extends inside a matrix node when folding", () => {
    const id = "@jm:nope.chat";
    const mx = matrix(id, [t(id)]);
    // Past the remaining budget the matrix drops whole — its label is
    // never cut and no ellipsis extends inside it.
    const dropped = foldTree([t("x".repeat(740)), mx]);
    expect(dropped.folded).toBe(true);
    expect(dropped.nodes).toEqual([t(`${"x".repeat(740)}…`)]);
    // Within budget it passes through intact.
    const kept = foldTree([mx, t("x".repeat(800))]);
    expect(kept.folded).toBe(true);
    expect(kept.nodes[0]).toEqual(mx);
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
