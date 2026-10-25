// HTML → AST tests (slice 2.4): allow-list mapping, the ported XSS cases
// from the old DOM sanitizer, and the quoteMarker/presentation reunion
// running over parser output.
import { contentFromHtml, shortcodeOf } from "../src/core/content/fromHtml";
import { bold, br, collectBareLinkHrefs, isBlankContent, plainTextOf, t, textOf, type ContentNode } from "../src/core/content/ast";
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

  it("a server-shortened link (visible text + invisible remainder) is bare", () => {
    const nodes = contentFromHtml(
      '<p><a href="https://example.social/very/long">https://example.social/<span class="invisible">very/long</span></a></p>',
    );
    expect(collectBareLinkHrefs(nodes)).toEqual(["https://example.social/very/long"]);
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

describe("inter-block whitespace (pretty-printed HTML)", () => {
  it("drops whitespace-only runs between blocks (no phantom blank lines)", () => {
    expect(contentFromHtml("<p>a</p>\n<p>b</p>")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
  });

  it("keeps inline spacing around inline nodes", () => {
    expect(contentFromHtml("<p>a <b>b</b> c</p>")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " c" },
    ]);
  });
});

describe("hashtag redirect links (phishing surface)", () => {
  it("unclassed hashtag-labelled anchors become plain hashtags", () => {
    expect(contentFromHtml('<p><a href="https://pixelfed.social/?q=photo">#photo</a></p>')).toEqual([
      { kind: "hashtag", tag: "photo", href: null, children: [{ kind: "text", text: "#photo" }] },
    ]);
  });

  it("richer labels stay links", () => {
    expect(contentFromHtml('<p><a href="https://a.b/c">#photo <b>x</b></a></p>')).toEqual([
      {
        kind: "link",
        href: "https://a.b/c",
        children: [
          { kind: "text", text: "#photo " },
          { kind: "bold", children: [{ kind: "text", text: "x" }] },
        ],
      },
    ]);
  });
});

describe("mention-labelled anchors (in-app chips)", () => {
  it("unclassed handle-labelled anchors become mentions, href kept", () => {
    expect(contentFromHtml('<p><a href="https://doma.in/@handle">@handle@doma.in</a></p>')).toEqual([
      {
        kind: "mention",
        href: "https://doma.in/@handle",
        children: [{ kind: "text", text: "@handle@doma.in" }],
      },
    ]);
  });

  it("richer labels stay links", () => {
    expect(contentFromHtml('<p><a href="https://a.b/c">contact @u@h.social</a></p>')).toEqual([
      {
        kind: "link",
        href: "https://a.b/c",
        children: [{ kind: "text", text: "contact @u@h.social" }],
      },
    ]);
  });

  it("matrix-labelled anchors become matrix nodes, href dropped", () => {
    expect(contentFromHtml('<p><a href="https://x.example/chat">@jm:nope.chat</a></p>')).toEqual([
      {
        kind: "matrix",
        userId: "@jm:nope.chat",
        children: [{ kind: "text", text: "@jm:nope.chat" }],
      },
    ]);
  });
});

describe("live Mastodon field markup (@ctr@mstdn.ca, recorded 2026-10-24)", () => {
  it("keeps a real h-card mention as an in-app mention", () => {
    expect(
      contentFromHtml(
        '<span class="h-card" translate="no"><a href="https://mastodon.social/@disectamembra" class="u-url mention">@<span>disectamembra@mastodon.social</span></a></span>',
      ),
    ).toEqual([
      {
        kind: "mention",
        href: "https://mastodon.social/@disectamembra",
        children: [{ kind: "text", text: "@disectamembra@mastodon.social" }],
      },
    ]);
  });

  it("rejoins Mastodon's shredded Matrix ID, dropping the hallucinated mention", () => {
    // The user wrote `@JM:nope.chat`; the server linked `@JM` as a
    // bogus mstdn.ca mention and left `:nope.chat` dangling.
    expect(
      contentFromHtml(
        '<span class="h-card" translate="no"><a href="https://mstdn.ca/@JM" class="u-url mention">@<span>JM</span></a></span>:nope.chat',
      ),
    ).toEqual([
      {
        kind: "matrix",
        userId: "@JM:nope.chat",
        children: [{ kind: "text", text: "@JM:nope.chat" }],
      },
    ]);
  });

  it("keeps a bridged (Bridgy Fed) mention as an in-app mention, href kept", () => {
    // Live shape recorded 2026-10-24: Mastodon status 117488106059876736
    // (@ctr@mstdn.ca) mentions `@foxtails.me@bsky.brid.gy` as a truncated
    // `@foxtails.me` label on the bridge redirect URL
    // (`GET /api/v1/statuses/117488106059876736`, no auth). The parser
    // keeps the anchor verbatim — the truncated label is repaired at tap
    // time from the href, never here.
    expect(
      contentFromHtml(
        '<p><span class="h-card" translate="no"><a href="https://bsky.brid.gy/r/https://bsky.app/profile/foxtails.me" class="u-url mention">@<span>foxtails.me</span></a></span></p>',
      ),
    ).toEqual([
      {
        kind: "mention",
        href: "https://bsky.brid.gy/r/https://bsky.app/profile/foxtails.me",
        children: [{ kind: "text", text: "@foxtails.me" }],
      },
    ]);
  });
});

describe("P4.2 fromHtml gaps (non-XSS: parser branches the XSS suite never hits)", () => {
  it("shortcodeOf trims and rejects empty names/hosts and spaces", () => {
    expect(shortcodeOf("  :blob:  ")).toEqual({ name: "blob", host: null });
    expect(shortcodeOf(":@h:")).toBeNull();
    expect(shortcodeOf(":n@:")).toBeNull();
    expect(shortcodeOf(":has space:")).toBeNull();
  });

  it("emoji images fall back to title, then to the file stem", () => {
    expect(
      contentFromHtml('<p><img class="emoji" title=":wave:" src="https://a.b/wave.png"></p>'),
    ).toEqual([{ kind: "customEmoji", name: "wave", host: null, src: "https://a.b/wave.png" }]);
    const stemmed = contentFromHtml(
      '<p><img class="emoji" src="https://a.b/emoji/thinking.png?v=2"></p>',
    );
    expect(stemmed).toMatchObject([{ kind: "customEmoji", name: "thinking", host: null }]);
  });

  it("an emoji image with no usable code is dropped, never guessed", () => {
    const long = "a".repeat(65);
    expect(contentFromHtml(`<p><img class="emoji" src="https://a.b/${long}.png"></p>`)).toEqual([]);
  });

  it("a lone emoji span is one opaque emoji node, never prose", () => {
    expect(contentFromHtml('<p><span class="emoji">🔥</span></p>')).toEqual([
      { kind: "unicodeEmoji", emoji: "🔥" },
    ]);
  });

  it("center becomes an fn node, an empty code block becomes nothing", () => {
    expect(contentFromHtml("<p><center>hi</center></p>")).toEqual([
      { kind: "fn", name: "center", args: {}, children: [{ kind: "text", text: "hi" }] },
    ]);
    expect(contentFromHtml("<p><code></code></p>")).toEqual([]);
  });

  it("a hashtag anchor with no label text still gets a #tag label", () => {
    expect(
      contentFromHtml('<p><a class="hashtag" href="https://a.b/tags/x" data-tag="x"></a></p>'),
    ).toEqual([
      {
        kind: "hashtag",
        tag: "x",
        href: "https://a.b/tags/x",
        children: [{ kind: "text", text: "#x" }],
      },
    ]);
  });

  it("mention+hashtag classes resolve as a hashtag, not a mention", () => {
    const nodes = contentFromHtml(
      '<p><a class="mention hashtag" href="https://a.b/tags/y" data-tag="y">#y</a></p>',
    );
    expect(nodes).toEqual([
      {
        kind: "hashtag",
        tag: "y",
        href: "https://a.b/tags/y",
        children: [{ kind: "text", text: "#y" }],
      },
    ]);
  });

  it("mailto links stay links; comments vanish; divs keep paragraph breaks", () => {
    expect(contentFromHtml('<p><a href="mailto:a@b.c">mail</a></p>')).toEqual([
      { kind: "link", href: "mailto:a@b.c", children: [{ kind: "text", text: "mail" }] },
    ]);
    expect(contentFromHtml("<p>a<!--c-->b</p>")).toEqual([{ kind: "text", text: "ab" }]);
    expect(contentFromHtml("<div><p>a</p><p>b</p></div>")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
  });

  it("a blank blockquote leaves no node behind", () => {
    expect(contentFromHtml("<blockquote><p>  </p></blockquote>")).toEqual([]);
  });
});

describe("X6.3 hostile nesting (F5: depth-32 degradation, never throws)", () => {
  it("never throws on 5000 nested <b>", () => {
    const html = "<b>".repeat(5000) + "x" + "</b>".repeat(5000);
    let nodes: ContentNode[] = [];
    expect(() => {
      nodes = contentFromHtml(html);
    }).not.toThrow();
    expect(nodes.length).toBeGreaterThan(0);
    expect(textOf(nodes)).toContain("x");
  });

  it("never throws on 3000 nested list wrappers", () => {
    const html = "<ul><li>".repeat(3000) + "x" + "</li></ul>".repeat(3000);
    let nodes: ContentNode[] = [];
    expect(() => {
      nodes = contentFromHtml(html);
    }).not.toThrow();
    expect(nodes.length).toBeGreaterThan(0);
    expect(textOf(nodes)).toContain("x");
  });

  it("never throws on 3000 nested blockquotes", () => {
    const html = "<blockquote>".repeat(3000) + "x" + "</blockquote>".repeat(3000);
    let nodes: ContentNode[] = [];
    expect(() => {
      nodes = contentFromHtml(html);
    }).not.toThrow();
    expect(nodes.length).toBeGreaterThan(0);
    expect(textOf(nodes)).toContain("x");
  });

  it("degrades past depth 32 to plain text instead of dropping content", () => {
    const html = "<b>".repeat(40) + "deep" + "</b>".repeat(40);
    let nodes: ContentNode[] = [];
    expect(() => {
      nodes = contentFromHtml(html);
    }).not.toThrow();
    expect(textOf(nodes)).toContain("deep");
  });

  it("caps input at 200 KB", () => {
    const html = "<p>" + "x".repeat(200 * 1024 + 1024) + "</p>";
    let nodes: ContentNode[] = [];
    expect(() => {
      nodes = contentFromHtml(html);
    }).not.toThrow();
    expect(nodes.length).toBeGreaterThan(0);
    expect(textOf(nodes).length).toBeLessThanOrEqual(200 * 1024 + 3);
  });

  it("parses 100k adjacent spans in under 300 ms (quadratic fix)", () => {
    const html = "<span>x</span>".repeat(100000);
    const start = Date.now();
    const nodes = contentFromHtml(html);
    expect(Date.now() - start).toBeLessThan(300);
    expect(textOf(nodes).length).toBeGreaterThan(0);
  });

  it("parses 10k adjacent spans within the cap in under 300 ms", () => {
    const html = "<b>v</b>".repeat(10000);
    const start = Date.now();
    const nodes = contentFromHtml(html);
    expect(Date.now() - start).toBeLessThan(300);
    expect(textOf(nodes)).toBe("v".repeat(10000));
  });
});

describe("X6.3 fidelity (F13: ordered lists, tables, img alt)", () => {
  it("numbers ordered list items", () => {
    const nodes = contentFromHtml("<ol><li>one</li><li>two</li></ol>");
    // Adjacent text coalesces (the `1. ` prefix merges with its item —
    // same as the ul bullet/content join below); numbering is pinned by
    // the prefix text and the full projection.
    expect(nodes[0]).toEqual({ kind: "text", text: "1. one" });
    expect(plainTextOf(nodes)).toBe("1. one\n\n2. two");
  });

  it("keeps unordered lists on bullets, skipping empty items", () => {
    expect(contentFromHtml("<ul><li>one</li><li>two</li></ul>")).toEqual([
      { kind: "bullet" },
      t("one"),
      br(),
      br(),
      { kind: "bullet" },
      t("two"),
    ]);
  });

  it("skips empty ordered items but keeps numbering", () => {
    const nodes = contentFromHtml("<ol><li>one</li><li></li><li>three</li></ol>");
    expect(plainTextOf(nodes)).toBe("1. one\n\n3. three");
  });

  it("separates table cells with a space", () => {
    const nodes = contentFromHtml("<table><tr><td>a</td><td>b</td></tr></table>");
    expect(textOf(nodes).trim()).toBe("a b");
  });

  it("breaks table rows", () => {
    const nodes = contentFromHtml("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>");
    expect(nodes.filter((n) => n.kind === "br").length).toBe(2);
    expect(textOf(nodes)).toContain("a");
    expect(textOf(nodes)).toContain("b");
  });

  it("falls back to alt text for non-emoji images, still no load", () => {
    expect(contentFromHtml('<p><img src="https://a.b/photo.png" alt="a sunset"></p>')).toEqual([
      { kind: "text", text: "a sunset" },
    ]);
    // No alt, no node — never a blind fetch.
    expect(contentFromHtml('<p><img src="https://a.b/photo.png"></p>')).toEqual([]);
    // The emoji-gated path is unchanged: unsafe src still drops.
    expect(
      contentFromHtml('<p><img class="emojione" alt=":x:" src="javascript:alert(1)"></p>'),
    ).toEqual([]);
  });
});
