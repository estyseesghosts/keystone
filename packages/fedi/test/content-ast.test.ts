// Content AST unit tests (slice 2.4): constructors, readers, URL policy,
// mention/hashtag routing helpers, serializability.
import {
  bold,
  br,
  codeBlock,
  codeNode,
  customEmoji,
  fnNode,
  hashtag,
  hashtagTagOf,
  hasUnsafeUrlChars,
  isBlankContent,
  italic,
  link,
  mention,
  bareLinkLabel,
  collectBareLinkHrefs,
  contentFromTranslatedText,
  mentionAccountIdOf,
  mentionLabelOf,
  plainTextOf,
  quoteNode,
  safeHttpUrl,
  shortenBareUrl,
  safeUrl,
  strike,
  t,
  textOf,
  translatedHashtagOf,
  unicodeEmoji,
  type ContentNode,
} from "../src/core/content/ast";
import { contentFromFieldValue } from "../src/core/content/fields";

describe("constructors", () => {
  it("builds each node kind", () => {
    expect(t("hi")).toEqual({ kind: "text", text: "hi" });
    expect(br()).toEqual({ kind: "br" });
    expect(link("https://a.b/c", [t("c")])).toEqual({
      kind: "link",
      href: "https://a.b/c",
      children: [{ kind: "text", text: "c" }],
    });
    expect(mention("https://a.b/@u", [t("@u")])).toEqual({
      kind: "mention",
      href: "https://a.b/@u",
      children: [{ kind: "text", text: "@u" }],
    });
    expect(hashtag("tag", "https://a.b/tags/tag", [t("#tag")])).toEqual({
      kind: "hashtag",
      tag: "tag",
      href: "https://a.b/tags/tag",
      children: [{ kind: "text", text: "#tag" }],
    });
    expect(customEmoji("blob", "h.example", "https://h.example/b.png")).toEqual({
      kind: "customEmoji",
      name: "blob",
      host: "h.example",
      src: "https://h.example/b.png",
    });
    expect(unicodeEmoji("😂")).toEqual({ kind: "unicodeEmoji", emoji: "😂" });
    expect(bold([t("b")])).toEqual({ kind: "bold", children: [{ kind: "text", text: "b" }] });
    expect(italic([t("i")])).toEqual({ kind: "italic", children: [{ kind: "text", text: "i" }] });
    expect(strike([t("s")])).toEqual({ kind: "strike", children: [{ kind: "text", text: "s" }] });
    expect(codeNode("x")).toEqual({ kind: "code", code: "x" });
    expect(codeBlock("js", "x")).toEqual({ kind: "codeBlock", language: "js", code: "x" });
    expect(quoteNode([t("q")])).toEqual({
      kind: "quote",
      children: [{ kind: "text", text: "q" }],
    });
    expect(fnNode("spin", {}, [t("z")])).toEqual({
      kind: "fn",
      name: "spin",
      args: {},
      children: [{ kind: "text", text: "z" }],
    });
  });
});

describe("serializability", () => {
  it("round-trips through JSON", () => {
    const nodes: ContentNode[] = [
      t("hi "),
      mention("https://a.b/@u", [t("@u")]),
      br(),
      hashtag("tag", null, [t("#tag")]),
      customEmoji("b", null, null),
      unicodeEmoji("😂"),
      bold([italic([t("x")])]),
      codeNode("y"),
      codeBlock(null, "z"),
      quoteNode([t("q")]),
      fnNode("x2", {}, [t("w")]),
      link("https://a.b/", [t("a")]),
      strike([t("s")]),
    ];
    expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
  });
});

describe("textOf", () => {
  it("concatenates labels, code literals, and code payloads", () => {
    expect(
      textOf([
        t("a"),
        link("https://a.b/", [t("label")]),
        mention(null, [t("@u@h")]),
        hashtag("tag", null, [t("#tag")]),
        customEmoji("b", null, null),
        customEmoji("r", "h.example", null),
        unicodeEmoji("😂"),
        codeNode("x"),
        bold([t("y")]),
      ]),
    ).toBe("alabel@u@h#tag:b::r@h.example:😂xy");
  });

  it("br contributes nothing", () => {
    expect(textOf([t("a"), br(), t("b")])).toBe("ab");
  });
});

describe("plainTextOf", () => {
  it("projects labels, emoji literals, and code like textOf", () => {
    expect(
      plainTextOf([
        t("a"),
        link("https://a.b/", [t("label")]),
        mention(null, [t("@u@h")]),
        hashtag("tag", null, [t("#tag")]),
        customEmoji("b", null, null),
        customEmoji("r", "h.example", null),
        unicodeEmoji("😂"),
        codeNode("x"),
        bold([t("y")]),
        quoteNode([t("q")]),
      ]),
    ).toBe("alabel@u@h#tag:b::r@h.example:😂xyq");
  });

  it("keeps line breaks as newlines", () => {
    expect(plainTextOf([t("a"), br(), t("b")])).toBe("a\nb");
    expect(plainTextOf([t("a"), br(), br(), t("b")])).toBe("a\n\nb");
  });
});

describe("isBlankContent", () => {
  it("blank for empty, whitespace, and lone breaks", () => {
    expect(isBlankContent([])).toBe(true);
    expect(isBlankContent([t("  "), br()])).toBe(true);
    expect(isBlankContent([bold([t(" ")])])).toBe(true);
  });

  it("non-blank for text, emoji, and code", () => {
    expect(isBlankContent([t("x")])).toBe(false);
    expect(isBlankContent([customEmoji("b", null, null)])).toBe(false);
    expect(isBlankContent([unicodeEmoji("😂")])).toBe(false);
    expect(isBlankContent([codeNode("x")])).toBe(false);
    expect(isBlankContent([codeBlock(null, " ")])).toBe(true);
  });
});

describe("URL policy", () => {
  it("hasUnsafeUrlChars rejects controls and spaces", () => {
    expect(hasUnsafeUrlChars("https://a.b/")).toBe(false);
    expect(hasUnsafeUrlChars("java\nscript:alert(1)")).toBe(true);
    expect(hasUnsafeUrlChars("https://a.b/x y")).toBe(true);
    expect(hasUnsafeUrlChars("https://a.b/\t")).toBe(true);
  });

  it("safeUrl keeps absolute http/https/mailto without credentials", () => {
    expect(safeUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeUrl("http://a.b/")).toBe("http://a.b/");
    expect(safeUrl("mailto:x@y.z")).toBe("mailto:x@y.z");
  });

  it("safeUrl drops javascript:, data:, relative, protocol-relative, credentials", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("java\0script:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<p>x</p>")).toBeNull();
    expect(safeUrl("/local/path")).toBeNull();
    expect(safeUrl("//a.b/c")).toBeNull();
    expect(safeUrl("https://user:pass@a.b/")).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl("")).toBeNull();
  });

  it("safeHttpUrl additionally drops mailto:", () => {
    expect(safeHttpUrl("https://a.b/e.png")).toBe("https://a.b/e.png");
    expect(safeHttpUrl("mailto:x@y.z")).toBeNull();
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("mentionAccountIdOf", () => {
  const mentions = [{ id: "9", url: "https://a.b/@u" }];
  it("resolves on normalized href", () => {
    expect(mentionAccountIdOf("https://a.b/@u", mentions)).toBe("9");
  });

  it("null for unknown, unsafe, or missing href", () => {
    expect(mentionAccountIdOf("https://a.b/@other", mentions)).toBeNull();
    expect(mentionAccountIdOf("javascript:alert(1)", mentions)).toBeNull();
    expect(mentionAccountIdOf(null, mentions)).toBeNull();
  });
});

describe("hashtagTagOf", () => {
  it("prefers Akkoma data-tag", () => {
    expect(hashtagTagOf({ class: "hashtag", href: "https://a.b/tag/x", "data-tag": "y" })).toBe(
      "y",
    );
  });

  it("reads Mastodon /tags/ tail, decoding percent-encoding", () => {
    expect(hashtagTagOf({ class: "mention hashtag", href: "https://a.b/tags/keystone" })).toBe(
      "keystone",
    );
  });

  it("null without the hashtag class or with junk tails", () => {
    expect(hashtagTagOf({ class: "mention", href: "https://a.b/tags/x" })).toBeNull();
    expect(hashtagTagOf({ class: "hashtag", href: "not a url" })).toBeNull();
    expect(hashtagTagOf({ class: "hashtag", href: "https://a.b/tags/a%20b" })).toBeNull();
  });
});

describe("bare-link chips (v1 .mchip parity)", () => {
  it("shortens bare URLs: scheme stripped, truncated with …", () => {
    expect(shortenBareUrl("https://www.bbc.co.uk/news/live/ckgel5xp2xv9t")).toBe(
      "www.bbc.co.uk/news/live/ckgel5x…",
    );
    expect(shortenBareUrl("https://a.b/c")).toBe("a.b/c");
    expect(shortenBareUrl("http://a.b/c")).toBe("a.b/c");
  });

  it("chips Misskey bare URLs (visible text is the href)", () => {
    const href = "https://example.social/notes/abc123";
    expect(bareLinkLabel(link(href, [{ kind: "text", text: href }]))).toBe(
      "example.social/notes/abc123",
    );
  });

  it("chips Mastodon server-shortened links (visible + invisible)", () => {
    const href = "https://example.social/very/long/hidden/part";
    expect(
      bareLinkLabel(
        link(href, [
          { kind: "text", text: "example.social/very/long…" },
          { kind: "invisible", text: "hidden/part" },
        ]),
      ),
    ).toBe("example.social/very/long…");
  });

  it("never chips labeled links, empty labels, or non-web schemes", () => {
    expect(bareLinkLabel(link("https://a.b/x", [{ kind: "text", text: "click here" }]))).toBeNull();
    expect(bareLinkLabel(link("https://a.b/x", []))).toBeNull();
    expect(bareLinkLabel(link("mailto:a@b.c", [{ kind: "text", text: "mailto:a@b.c" }]))).toBeNull();
    expect(
      bareLinkLabel(
        link("https://a.b/x", [
          { kind: "text", text: "see " },
          { kind: "code", code: "x" },
        ]),
      ),
    ).toBeNull();
  });
});

describe("translated text nodes", () => {
  it("finds mentions and links, keeps newlines", () => {
    expect(contentFromTranslatedText("hi @u@example.social, see https://a.b/x")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", href: null, children: [{ kind: "text", text: "@u@example.social" }] },
      { kind: "text", text: ", see " },
      { kind: "link", href: "https://a.b/x", children: [{ kind: "text", text: "https://a.b/x" }] },
    ]);
  });

  it("leaves emails and punctuation outside the token", () => {
    expect(contentFromTranslatedText("mail me@example.com, ok?")).toEqual([
      { kind: "text", text: "mail me@example.com, ok?" },
    ]);
    expect(contentFromTranslatedText("hey @u, see https://a.b/x.")).toEqual([
      { kind: "text", text: "hey " },
      { kind: "mention", href: null, children: [{ kind: "text", text: "@u" }] },
      { kind: "text", text: ", see " },
      { kind: "link", href: "https://a.b/x", children: [{ kind: "text", text: "https://a.b/x" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("splits lines and ignores empty input", () => {
    expect(contentFromTranslatedText("a\n\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
    expect(contentFromTranslatedText("")).toEqual([]);
    expect(contentFromTranslatedText(null)).toEqual([]);
  });

  it("collapses markdown hashtag links to plain tag text, never a URL chip", () => {
    expect(
      contentFromTranslatedText("see [#presentaçao](https://masto.br/tags/presenta%C3%A7ao) ok"),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "text", text: "#presentaçao" },
      { kind: "text", text: " ok" },
    ]);
  });

  it("collapses bare hashtag URLs to plain tag text", () => {
    expect(contentFromTranslatedText("see https://masto.br/tags/foo ok")).toEqual([
      { kind: "text", text: "see " },
      { kind: "text", text: "#foo" },
      { kind: "text", text: " ok" },
    ]);
    expect(contentFromTranslatedText("see https://masto.br/?q=photo ok")).toEqual([
      { kind: "text", text: "see " },
      { kind: "text", text: "#photo" },
      { kind: "text", text: " ok" },
    ]);
  });

  it("leaves non-hashtag URLs as links", () => {
    expect(contentFromTranslatedText("see https://a.b/notes/1 ok")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        href: "https://a.b/notes/1",
        children: [{ kind: "text", text: "https://a.b/notes/1" }],
      },
      { kind: "text", text: " ok" },
    ]);
  });
});

describe("translatedHashtagOf", () => {
  it("reads markdown hashtag links by their label", () => {
    expect(translatedHashtagOf("[#presentaçao](https://masto.br/tags/presenta%C3%A7ao)")).toBe(
      "#presentaçao",
    );
  });

  it("reads /tags/ and /hashtag/ tails, decoded", () => {
    expect(translatedHashtagOf("https://masto.br/tags/foo")).toBe("#foo");
    expect(translatedHashtagOf("https://x.example/hashtag/presenta%C3%A7ao")).toBe("#presentaçao");
  });

  it("reads pixelfed-style ?q= / ?tag= params", () => {
    expect(translatedHashtagOf("https://masto.br/?q=presenta%C3%A7ao")).toBe("#presentaçao");
    expect(translatedHashtagOf("https://pix.example/?tag=photo")).toBe("#photo");
  });

  it("rejects non-hashtag URLs and junk", () => {
    expect(translatedHashtagOf("https://a.b/notes/1")).toBeNull();
    expect(translatedHashtagOf("https://a.b/tags/")).toBeNull();
    expect(translatedHashtagOf("not a url")).toBeNull();
    expect(translatedHashtagOf("mailto:a@b.c")).toBeNull();
  });
});

describe("mentionLabelOf", () => {
  it("normalizes lone-handle labels", () => {
    expect(mentionLabelOf([t("@u@h.social")])).toBe("@u@h.social");
    expect(mentionLabelOf([t("  @u  ")])).toBe("@u");
  });

  it("rejects display names, emails, and richer labels", () => {
    expect(mentionLabelOf([t("Laura")])).toBeNull();
    expect(mentionLabelOf([t("me@example.com")])).toBeNull();
    expect(mentionLabelOf([t("contact @u@h.social")])).toBeNull();
    expect(mentionLabelOf([t("@u@")])).toBeNull();
    expect(mentionLabelOf([t("@u"), t("x")])).toBeNull();
  });
});

describe("contentFromFieldValue", () => {
  it("renders markdown links as links", () => {
    expect(contentFromFieldValue("[my site](https://example.com)")).toEqual([
      {
        kind: "link",
        href: "https://example.com/",
        children: [{ kind: "text", text: "my site" }],
      },
    ]);
  });

  it("normalizes handle-labelled markdown to a mention, href kept", () => {
    expect(contentFromFieldValue("[@u@h.social](https://h.social/@u)")).toEqual([
      {
        kind: "mention",
        href: "https://h.social/@u",
        children: [{ kind: "text", text: "@u@h.social" }],
      },
    ]);
  });

  it("chips bare mentions and bare URLs, keeps prose", () => {
    expect(contentFromFieldValue("hi @u@h.social, see https://a.b/x")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", href: null, children: [{ kind: "text", text: "@u@h.social" }] },
      { kind: "text", text: ", see " },
      { kind: "link", href: "https://a.b/x", children: [{ kind: "text", text: "https://a.b/x" }] },
    ]);
  });

  it("strips hashtag-labelled markdown to a plain hashtag", () => {
    expect(contentFromFieldValue("[#tag](https://x.example/?q=tag)")).toEqual([
      { kind: "hashtag", tag: "tag", href: null, children: [{ kind: "text", text: "#tag" }] },
    ]);
  });

  it("parses HTML anchors and leaves emails alone", () => {
    expect(contentFromFieldValue('<a href="https://h.social/@u">@u@h.social</a>')).toEqual([
      {
        kind: "mention",
        href: "https://h.social/@u",
        children: [{ kind: "text", text: "@u@h.social" }],
      },
    ]);
    expect(contentFromFieldValue("me@example.com")).toEqual([
      { kind: "text", text: "me@example.com" },
    ]);
  });

  it("returns no nodes for empty input, keeps newlines literal", () => {
    expect(contentFromFieldValue("")).toEqual([]);
    expect(contentFromFieldValue(null)).toEqual([]);
    expect(contentFromFieldValue("a\nb")).toEqual([{ kind: "text", text: "a\nb" }]);
  });
});

describe("collectBareLinkHrefs", () => {
  it("collects bare links in order, nested included", () => {
    expect(
      collectBareLinkHrefs([
        link("https://a.b/1", [{ kind: "text", text: "https://a.b/1" }]),
        { kind: "bold", children: [link("https://a.b/2", [{ kind: "text", text: "https://a.b/2" }])] },
        link("https://a.b/3", [{ kind: "text", text: "labeled" }]),
      ]),
    ).toEqual(["https://a.b/1", "https://a.b/2"]);
  });
});
