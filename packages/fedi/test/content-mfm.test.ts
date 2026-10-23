// MFM → AST tests (slice 2.4): full node coverage, `fn` degradation,
// newline/paragraph breaks, empty and unparseable input.
import { contentFromMfm, convertNode } from "../src/core/content/fromMfm";
import { parse } from "mfm-js";
describe("inline formatting", () => {
  it("bold/italic/strike keep children", () => {
    expect(contentFromMfm("**b** *i* ~~s~~")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "i" }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "s" }] },
    ]);
  });

  it("inline code and fenced code blocks", () => {
    expect(contentFromMfm("`x`")).toEqual([{ kind: "code", code: "x" }]);
    expect(contentFromMfm("```js\nx\n```")).toEqual([
      { kind: "codeBlock", language: "js", code: "x" },
    ]);
  });

  it("quotes", () => {
    expect(contentFromMfm("> quoted")).toEqual([
      { kind: "quote", children: [{ kind: "text", text: "quoted" }] },
    ]);
  });
});

describe("references", () => {
  it("mentions carry the verbatim acct as text", () => {
    expect(contentFromMfm("@user@host hi")).toEqual([
      { kind: "mention", href: null, children: [{ kind: "text", text: "@user@host" }] },
      { kind: "text", text: " hi" },
    ]);
  });

  it("hashtags resolve tag + label", () => {
    expect(contentFromMfm("#tag hi")).toEqual([
      { kind: "hashtag", tag: "tag", href: null, children: [{ kind: "text", text: "#tag" }] },
      { kind: "text", text: " hi" },
    ]);
  });

  it("bare urls and labeled links", () => {
    expect(contentFromMfm("https://example.com/x")).toEqual([
      {
        kind: "link",
        href: "https://example.com/x",
        children: [{ kind: "text", text: "https://example.com/x" }],
      },
    ]);
    expect(contentFromMfm("[label](https://example.com/x)")).toEqual([
      {
        kind: "link",
        href: "https://example.com/x",
        children: [{ kind: "text", text: "label" }],
      },
    ]);
  });

  it("emoji codes and unicode emoji", () => {
    expect(contentFromMfm(":blobcat:")).toEqual([
      { kind: "customEmoji", name: "blobcat", host: null, src: null },
    ]);
    expect(contentFromMfm("😂")).toEqual([{ kind: "unicodeEmoji", emoji: "😂" }]);
  });
});

describe("fn extras", () => {
  it("known functions survive with name + args + children", () => {
    expect(contentFromMfm("$[spin hi]")).toEqual([
      { kind: "fn", name: "spin", args: {}, children: [{ kind: "text", text: "hi" }] },
    ]);
    expect(contentFromMfm("$[x2 hi]")).toEqual([
      { kind: "fn", name: "x2", args: {}, children: [{ kind: "text", text: "hi" }] },
    ]);
  });

  it("unknown functions degrade to children, never dropped", () => {
    expect(contentFromMfm("$[bogus hi]")).toEqual([{ kind: "text", text: "hi" }]);
  });

  it("small/center survive as named fn nodes", () => {
    expect(contentFromMfm("<small>hi</small>")).toEqual([
      { kind: "fn", name: "small", args: {}, children: [{ kind: "text", text: "hi" }] },
    ]);
    expect(contentFromMfm("<center>hi</center>")).toEqual([
      { kind: "fn", name: "center", args: {}, children: [{ kind: "text", text: "hi" }] },
    ]);
  });
});

describe("specials", () => {
  it("search degrades to its content, math to code", () => {
    const search = parse("hello [search]");
    expect(search[0].type).toBe("search");
    expect(convertNode(search[0])).toEqual([{ kind: "text", text: "hello [search]" }]);
    const math = parse("\\(x^2\\)");
    expect(math[0].type).toBe("mathInline");
    expect(convertNode(math[0])).toEqual([{ kind: "code", code: "x^2" }]);
  });
});

describe("line structure", () => {
  it("single newlines are br, blank lines are br pairs", () => {
    expect(contentFromMfm("a\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
    expect(contentFromMfm("a\n\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "br" },
      { kind: "text", text: "b" },
    ]);
  });
});

describe("edges", () => {
  it("empty and null input yield no nodes", () => {
    expect(contentFromMfm("")).toEqual([]);
    expect(contentFromMfm(null)).toEqual([]);
    expect(contentFromMfm(undefined)).toEqual([]);
  });

  it("adversarial input never throws and never loses content", () => {
    for (const bad of ["```unclosed", "<", "&", "$[", "**", ">"]) {
      expect(() => contentFromMfm(bad)).not.toThrow();
      expect(contentFromMfm(bad).length).toBeGreaterThan(0);
    }
  });
});

describe("F11: remote custom emoji in MFM text", () => {
  it("splits :name@host: codes out of text runs", () => {
    expect(contentFromMfm("hi :wave@remote.example: bye")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "customEmoji", name: "wave", host: "remote.example", src: null },
      { kind: "text", text: " bye" },
    ]);
  });

  it("leaves local codes to the parser and code spans verbatim", () => {
    expect(contentFromMfm(":blobcat: `:wave@remote.example:`")).toEqual([
      { kind: "customEmoji", name: "blobcat", host: null, src: null },
      { kind: "text", text: " " },
      { kind: "code", code: ":wave@remote.example:" },
    ]);
  });

  it("splits codes nested in formatting", () => {
    expect(contentFromMfm("**go :go@remote.example:**")).toEqual([
      {
        kind: "bold",
        children: [
          { kind: "text", text: "go " },
          { kind: "customEmoji", name: "go", host: "remote.example", src: null },
        ],
      },
    ]);
  });
});

describe("carriage returns", () => {
  it("\\r\\n is one break, lone \\r is a break", () => {
    expect(contentFromMfm("a\r\nb\rc")).toEqual([
      { kind: "text", text: "a" },
      { kind: "br" },
      { kind: "text", text: "b" },
      { kind: "br" },
      { kind: "text", text: "c" },
    ]);
  });
});
