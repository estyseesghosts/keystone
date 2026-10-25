// X6.4 link/emoji disclosure + mention-chip rule (F6, F7 AST half).
// Every case fails before the fix (no `mismatch` marking, disguised
// mentions stay chips, plaintext emoji `src` loads) and passes after.
import { contentFromFieldValue } from "../src/core/content/fields";
import { contentFromHtml } from "../src/core/content/fromHtml";
import { contentFromMfm } from "../src/core/content/fromMfm";
import {
  isMentionChip,
  labelHostOfText,
  mismatchForLink,
  t,
} from "../src/core/content/ast";

describe("labelHostOfText", () => {
  it("names the host of URL and bare-host labels", () => {
    expect(labelHostOfText("https://bank.com/login")).toBe("bank.com");
    expect(labelHostOfText("HTTPS://Bank.COM/x")).toBe("bank.com");
    expect(labelHostOfText("bank.com/login")).toBe("bank.com");
    expect(labelHostOfText("www.bank.com")).toBe("www.bank.com");
  });

  it("rejects prose, emails, and trailing-dot tricks", () => {
    expect(labelHostOfText("click here")).toBeNull();
    expect(labelHostOfText("Free gift")).toBeNull();
    expect(labelHostOfText("user@bank.com")).toBeNull();
    expect(labelHostOfText("bank.com.")).toBeNull();
    expect(labelHostOfText("")).toBeNull();
    expect(labelHostOfText("mailto:post@bank.com")).toBeNull();
  });
});

describe("mismatchForLink", () => {
  it("marks a URL-shaped label on a different host", () => {
    expect(mismatchForLink("https://bank.com/login", "https://evil.example/login")).toEqual({
      labelHost: "bank.com",
      targetHost: "evil.example",
    });
    expect(mismatchForLink("bank.com/login", "https://evil.example/")).toEqual({
      labelHost: "bank.com",
      targetHost: "evil.example",
    });
  });

  it("passes honest and non-URL labels", () => {
    expect(mismatchForLink("https://a.b/c", "https://a.b/c")).toBeNull();
    expect(mismatchForLink("a.b same host", "https://a.b/c")).toBeNull();
    expect(mismatchForLink("click here", "https://evil.example/")).toBeNull();
    expect(mismatchForLink("bank.com", "mailto:post@bank.com")).toBeNull();
  });
});

describe("link mismatch marking (F6)", () => {
  it("marks HTML links whose label names another host", () => {
    expect(
      contentFromHtml('<p><a href="https://evil.example/login">https://bank.com/login</a></p>'),
    ).toEqual([
      {
        kind: "link",
        href: "https://evil.example/login",
        children: [{ kind: "text", text: "https://bank.com/login" }],
        mismatch: { labelHost: "bank.com", targetHost: "evil.example" },
      },
    ]);
  });

  it("leaves honest HTML links unmarked (key absent)", () => {
    const nodes = contentFromHtml('<p><a href="https://a.b/c">see</a></p>');
    expect(nodes).toEqual([
      { kind: "link", href: "https://a.b/c", children: [{ kind: "text", text: "see" }] },
    ]);
    expect("mismatch" in (nodes[0] as object)).toBe(false);
  });

  it("marks MFM labeled links on mismatch, leaves honest ones alone", () => {
    expect(contentFromMfm("[https://bank.com/x](https://evil.example/x)")).toEqual([
      {
        kind: "link",
        href: "https://evil.example/x",
        children: [{ kind: "text", text: "https://bank.com/x" }],
        mismatch: { labelHost: "bank.com", targetHost: "evil.example" },
      },
    ]);
    const honest = contentFromMfm("[label](https://example.com/x)");
    expect(honest).toEqual([
      {
        kind: "link",
        href: "https://example.com/x",
        children: [{ kind: "text", text: "label" }],
      },
    ]);
    expect("mismatch" in (honest[0] as object)).toBe(false);
  });

  it("marks field markdown links on mismatch", () => {
    expect(contentFromFieldValue("[bank.com](https://evil.example)")).toEqual([
      {
        kind: "link",
        href: "https://evil.example/",
        children: [{ kind: "text", text: "bank.com" }],
        mismatch: { labelHost: "bank.com", targetHost: "evil.example" },
      },
    ]);
  });
});

describe("mention-chip rule (F6)", () => {
  it("demotes a disguised mention to a plain link", () => {
    expect(contentFromHtml('<p><a class="mention" href="https://evil.example">Free gift</a></p>')).toEqual([
      {
        kind: "link",
        href: "https://evil.example/",
        children: [{ kind: "text", text: "Free gift" }],
      },
    ]);
  });

  it("keeps display-name labels on profile URLs as mentions", () => {
    expect(
      contentFromHtml('<p><a class="u-url mention" href="https://ex.ample/users/bob">Bobby</a></p>'),
    ).toEqual([
      {
        kind: "mention",
        href: "https://ex.ample/users/bob",
        children: [{ kind: "text", text: "Bobby" }],
      },
    ]);
  });

  it("keeps handle labels as mentions even on unrelated hrefs (label routes in-app)", () => {
    const nodes = contentFromHtml('<p><a class="mention" href="https://evil.example">@alice@good.example</a></p>');
    expect(nodes).toEqual([
      {
        kind: "mention",
        href: "https://evil.example/",
        children: [{ kind: "text", text: "@alice@good.example" }],
      },
    ]);
  });

  it("isMentionChip gates on handle labels and account URLs", () => {
    expect(isMentionChip([t("@u@h.social")], "https://evil.example")).toBe(true);
    expect(isMentionChip([t("Free gift")], "https://evil.example")).toBe(false);
    expect(isMentionChip([t("Free gift")], "https://ex.ample/users/bob")).toBe(true);
    expect(isMentionChip([t("Alice")], "https://bsky.app/profile/alice.bsky.social")).toBe(true);
    expect(isMentionChip([t("Free gift")], "https://bsky.brid.gy/r/https://bsky.app/profile/x.y")).toBe(true);
    expect(isMentionChip([t("Free gift")], null)).toBe(false);
  });
});

describe("emoji src https-only (F7 AST half)", () => {
  it("renders plaintext emoji sources as literal :code: text, never a node", () => {
    expect(
      contentFromHtml('<p><img class="emoji" alt=":a:" src="http://tracker.example/p.gif"></p>'),
    ).toEqual([{ kind: "text", text: ":a:" }]);
    expect(
      contentFromHtml(
        '<p><img class="emoji" alt=":a@tracker.example:" src="http://tracker.example/p.gif"></p>',
      ),
    ).toEqual([{ kind: "text", text: ":a@tracker.example:" }]);
  });

  it("still drops unsafe (non-http) emoji sources entirely", () => {
    expect(contentFromHtml('<p><img class="emojione" alt=":x:" src="javascript:alert(1)"></p>')).toEqual([]);
  });
});
