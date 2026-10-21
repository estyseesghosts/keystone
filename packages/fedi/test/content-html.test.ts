// HTML → AST tests (slice 2.4): allow-list mapping, the ported XSS cases
// from the old DOM sanitizer, and the quoteMarker/presentation reunion
// running over parser output.
import { contentFromHtml, shortcodeOf } from "../src/core/content/fromHtml";
import { bold, br, isBlankContent, plainTextOf, t, textOf, type ContentNode } from "../src/core/content/ast";
import {
  findTextualQuoteMarker,
  stripQuoteMarker,
} from "../src/mastodon/quoteMarker";
import { foldTree, pruneTagBlocks } from "../src/mastodon/presentation";

describe("blocks and inline formatting", () => {
  it("paragraphs join with br pairs, trailing breaks trimmed", () => {
    expect(contentFromHtml("<p>a</p><p>b</p>")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
  });

  it("br is a lone break, blank paragraphs are skipped", () => {
    expect(contentFromHtml("<p>a<br>b</p>")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
    expect(contentFromHtml("<p>a</p><p>  </p><p>b</p>")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
  });

  it("bold/italic/strike/code/pre/blockquote map", () => {
    expect(contentFromHtml("<p><strong>b</strong> <em>i</em> <del>s</del></p>")).toEqual([
      {
        kind: "bold",
        children: [{ kind: "text", text: "b" }],
      },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "i" }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "s" }] },
    ]);
    expect(contentFromHtml("<p><code>x</code></p>")).toEqual([{ kind: "code", code: "x" }]);
    expect(contentFromHtml("<pre><code>y</code></pre>")).toEqual([
      { kind: "codeBlock", language: null, code: "y" },
    ]);
    expect(contentFromHtml("<blockquote><p>q</p></blockquote>")).toEqual([
      { kind: "quote", children: [{ kind: "text", text: "q" }] },
    ]);
  });

  it("headings and list items break, entities decode once", () => {
    expect(textOf(contentFromHtml("<h1>T</h1><ul><li>a</li><li>b</li></ul>"))).toBe("T\u2022 a\u2022 b");
    expect(contentFromHtml("<p>a &amp; b &lt;c&gt;</p>")).toEqual([
      { kind: "text", text: "a & b <c>" },
    ]);
  });

  it("unknown tags degrade to children", () => {
    expect(contentFromHtml("<p><u>u</u> <div>d</div></p>")).toEqual([{ kind: "text", text: "u d" }]);
  });
});

describe("bio/field newlines (E4: no normalization eats \\n)", () => {
  it("Akkoma <br/>-joined bios keep every line break", () => {
    // Wire shape recorded live 2026-10-21 (akk1 @ :4000, set via
    // accounts/update_credentials, read back verbatim).
    const wire = "line one of the bio<br/>line two of the bio<br/><br/>line four after a blank";
    expect(plainTextOf(contentFromHtml(wire))).toBe(
      "line one of the bio\nline two of the bio\n\nline four after a blank",
    );
  });

  it("paragraph bios keep their breaks (blank line between blocks)", () => {
    expect(plainTextOf(contentFromHtml("<p>line one</p><p>line two</p>"))).toBe(
      "line one\n\nline two",
    );
  });

  it("plain field values with newlines survive the HTML path untouched", () => {
    // Misskey-family field values are plain text (Akkoma recorded the
    // same shape live); the ProfileHeader sends them through
    // contentFromHtml, which must not collapse the breaks.
    const nodes = contentFromHtml("first link\nsecond link");
    expect(nodes).toEqual([{ kind: "text", text: "first link\nsecond link" }]);
    expect(plainTextOf(nodes)).toBe("first link\nsecond link");
  });
});

describe("anchors and emoji", () => {
  const mentionHtml =
    '<p>hi <span class="h-card"><a href="https://a.b/@u" class="u-url mention">@<span>u</span></a></span></p>';

  it("mention anchors become mention nodes, never bare links", () => {
    expect(contentFromHtml(mentionHtml)).toEqual([
      { kind: "text", text: "hi " },
      {
        kind: "mention",
        href: "https://a.b/@u",
        children: [{ kind: "text", text: "@u" }],
      },
    ]);
  });

  it("Mastodon hashtag hrefs and Akkoma data-tags resolve", () => {
    expect(
      contentFromHtml('<p><a href="https://a.b/tags/keystone" class="mention hashtag">#x</a></p>'),
    ).toEqual([
      {
        kind: "hashtag",
        tag: "keystone",
        href: "https://a.b/tags/keystone",
        children: [{ kind: "text", text: "#x" }],
      },
    ]);
    expect(contentFromHtml('<p><a href="https://a.b/tag/y" class="hashtag" data-tag="y">#y</a></p>')).toEqual([
      {
        kind: "hashtag",
        tag: "y",
        href: "https://a.b/tag/y",
        children: [{ kind: "text", text: "#y" }],
      },
    ]);
  });

  it("plain links keep href + children", () => {
    expect(contentFromHtml('<p><a href="https://a.b/c">see</a></p>')).toEqual([
      { kind: "link", href: "https://a.b/c", children: [{ kind: "text", text: "see" }] },
    ]);
  });

  it("custom-emoji images keep code + src; other images drop", () => {
    expect(
      contentFromHtml(
        '<p><img rel="emoji" class="emojione custom-emoji" alt=":blob:" title=":blob:" src="https://a.b/blob.png"></p>',
      ),
    ).toEqual([{ kind: "customEmoji", name: "blob", host: null, src: "https://a.b/blob.png" }]);
    expect(contentFromHtml('<p><img src="https://a.b/photo.png"></p>')).toEqual([]);
    expect(
      contentFromHtml('<p><img class="emojione" alt=":x:" src="javascript:alert(1)"></p>'),
    ).toEqual([]);
  });

  it("shortcodeOf parses :name: and :name@host:", () => {
    expect(shortcodeOf(":blob:")).toEqual({ name: "blob", host: null });
    expect(shortcodeOf(":a@h.example:")).toEqual({ name: "a", host: "h.example" });
    expect(shortcodeOf("blob")).toBeNull();
    expect(shortcodeOf(null)).toBeNull();
  });
});

describe("XSS cases (ported from the old sanitizer)", () => {
  it("script/style subtrees drop wholesale", () => {
    expect(contentFromHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
    expect(textOf(contentFromHtml('<style>p{color:red}</style><p>x</p>'))).toBe("x");
  });

  it("svg/math drop with their subtree (mXSS carriers)", () => {
    expect(textOf(contentFromHtml('<svg><g><text>evil</text></g></svg><p>x</p>'))).toBe("x");
    expect(textOf(contentFromHtml('<math><mi>evil</mi></math><p>x</p>'))).toBe("x");
  });

  it("javascript: hrefs degrade the anchor to its text", () => {
    expect(contentFromHtml('<p><a href="javascript:alert(1)">click</a></p>')).toEqual([
      { kind: "text", text: "click" },
    ]);
    expect(contentFromHtml('<p><a href="java\nscript:alert(1)">click</a></p>')).toEqual([
      { kind: "text", text: "click" },
    ]);
    expect(contentFromHtml('<p><a href="data:text/html,<p>x</p>">click</a></p>')).toEqual([
      { kind: "text", text: "click" },
    ]);
  });

  it("event attributes, targets, and ids never survive", () => {
    const nodes = contentFromHtml(
      '<p><a href="https://a.b/" onclick="alert(1)" target="_blank" id="x" style="color:red">hi</a></p>',
    );
    expect(nodes).toEqual([
      { kind: "link", href: "https://a.b/", children: [{ kind: "text", text: "hi" }] },
    ]);
    expect(JSON.stringify(nodes)).not.toContain("onclick");
  });

  it("relative and credentialed hrefs degrade to text", () => {
    expect(contentFromHtml('<p><a href="/local">x</a></p>')).toEqual([
      { kind: "text", text: "x" },
    ]);
    expect(contentFromHtml('<p><a href="https://u:p@a.b/">x</a></p>')).toEqual([
      { kind: "text", text: "x" },
    ]);
  });

  it("iframe/object/embed/form controls drop with content", () => {
    expect(textOf(contentFromHtml('<p>a</p><iframe src="https://a.b/">evil</iframe>'))).toBe("a");
    expect(
      textOf(contentFromHtml('<form><input value="evil"></form><p>x</p>')),
    ).toBe("x");
  });

  it("empty and unparseable input yields no nodes, never throws", () => {
    expect(contentFromHtml("")).toEqual([]);
    expect(contentFromHtml(null)).toEqual([]);
    expect(contentFromHtml(undefined)).toEqual([]);
    expect(() => contentFromHtml("<p><a href")).not.toThrow();
  });
});

describe("reunion: quoteMarker over parser output", () => {
  it("finds a suffix marker in its own final paragraph", () => {
    const nodes = contentFromHtml(
      '<p>commentary</p><p>RE: <a href="https://a.b/notes/1">https://a.b/notes/1</a></p>',
    );
    const marker = findTextualQuoteMarker(nodes);
    expect(marker?.uri).toBe("https://a.b/notes/1");
    expect(marker?.position).toBe("suffix");
    const stripped = stripQuoteMarker(nodes, marker!);
    expect(textOf(stripped)).toBe("commentary");
  });

  it("a bare localhost URL in text is read too", () => {
    const nodes = contentFromHtml("<p>nice post</p><p>RE: http://localhost:3000/notes/1</p>");
    const marker = findTextualQuoteMarker(nodes);
    expect(marker?.uri).toBe("http://localhost:3000/notes/1");
    expect(textOf(stripQuoteMarker(nodes, marker!))).toBe("nice post");
  });

  it("mid-sentence RE: is not a marker", () => {
    const nodes = contentFromHtml("<p>RE: this and that</p>");
    expect(findTextualQuoteMarker(nodes)).toBeNull();
  });
});

describe("reunion: prune + fold over parser output", () => {
  it("prunes tag blocks, keeps lone tags inline", () => {
    const nodes = contentFromHtml(
      '<p>post <a href="https://a.b/tags/a" class="mention hashtag">#a</a> ' +
        '<a href="https://a.b/tags/b" class="mention hashtag">#b</a> done</p>',
    );
    const pruned = pruneTagBlocks(nodes);
    expect(pruned.blocks).toEqual([["a", "b"]]);
    expect(pruned.allTags).toEqual(["a", "b"]);
    expect(textOf(pruned.nodes)).toBe("post  done");
  });

  it("folds long trees with an ellipsis, links free", () => {
    const long: ContentNode[] = [
      { kind: "text", text: `${"w ".repeat(500)}` },
      { kind: "link", href: "https://a.b/very/long", children: [{ kind: "text", text: "x" }] },
    ];
    const folded = foldTree(long);
    expect(folded.folded).toBe(true);
    expect(textOf(folded.nodes).length).toBeLessThanOrEqual(752);
    expect(textOf(folded.nodes).endsWith("…")).toBe(true);
  });
});

describe("MD4 remainder (WS-B): invisible spans, bullets, headings", () => {
  it("keeps span.invisible as a hidden node — never visible text (v1 hid them with CSS)", () => {
    const nodes = contentFromHtml(
      '<p>https://example.social/<span class="invisible">very/long/hidden/part</span><span class="ellipsis">…</span></p>',
    );
    expect(nodes).toEqual([
      t("https://example.social/"),
      { kind: "invisible", text: "very/long/hidden/part" },
      t("\u2026"),
    ]);
    // The hidden run never surfaces: not in the visible text, not in the
    // plain-text projection, and it budgets nothing against the fold.
    expect(textOf(nodes)).toBe("https://example.social/\u2026");
    expect(plainTextOf(nodes)).toBe("https://example.social/\u2026");
    expect(isBlankContent([{ kind: "invisible", text: "x" }])).toBe(true);
  });

  it("an invisible span inside an anchor keeps the link whole", () => {
    const nodes = contentFromHtml(
      '<p><a href="https://example.social/very/long">https://example.social/<span class="invisible">very/long</span></a></p>',
    );
    expect(nodes).toEqual([
      {
        kind: "link",
        href: "https://example.social/very/long",
        children: [
          t("https://example.social/"),
          { kind: "invisible", text: "very/long" },
        ],
      },
    ]);
  });

  it("span.mchip content renders inline (never dropped, never a block)", () => {
    expect(
      contentFromHtml(
        '<p><span class="mchip"><a href="https://example.com/x">label</a></span> after</p>',
      ),
    ).toEqual([
      {
        kind: "link",
        href: "https://example.com/x",
        children: [{ kind: "text", text: "label" }],
      },
      { kind: "text", text: " after" },
    ]);
  });

  it("keeps h-card mention spans (never invisible)", () => {
    const nodes = contentFromHtml(
      '<p><span class="h-card"><a href="https://example.social/@a" class="u-url mention">@<span>a</span></a></span></p>',
    );
    expect(JSON.stringify(nodes)).toContain("mention");
  });

  it("list items open with a bullet marker, not a text prefix", () => {
    expect(contentFromHtml("<ul><li>one</li><li>two</li></ul>")).toEqual([
      { kind: "bullet" },
      t("one"),
      br(),
      br(),
      { kind: "bullet" },
      t("two"),
    ]);
  });

  it("empty list items are skipped (no stray bullet)", () => {
    expect(contentFromHtml("<ul><li></li><li>two</li></ul>")).toEqual([
      { kind: "bullet" },
      t("two"),
    ]);
    expect(contentFromHtml("<ul><li>   </li></ul>")).toEqual([]);
  });

  it("headings keep their level instead of flattening to bold", () => {
    expect(contentFromHtml("<h1>Title</h1>")).toEqual([
      { kind: "heading", level: 1, children: [t("Title")] },
    ]);
    expect(contentFromHtml("<h6>fine</h6>")).toEqual([
      { kind: "heading", level: 6, children: [t("fine")] },
    ]);
    expect(isBlankContent(contentFromHtml("<h2>  </h2>"))).toBe(true);
  });
});
