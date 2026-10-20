// Akkoma MFM path (slice 2.4): statuses packing `pleroma.content`
// `text/plain` carry MFM source on the model, so the renderer takes the
// MFM path; vanilla Mastodon statuses stay HTML-only.
import { fixture } from "./helpers";
import {
  adaptStatus,
  mfmSourceOf,
  statusContentOf,
} from "../src/mastodon/adapt";
import type { Status } from "../src/mastodon/wire";
import { contentFromMfm } from "../src/core/content/fromMfm";
import { textOf } from "../src/core/content/ast";

describe("mfmSourceOf", () => {
  it("reads Akkoma pleroma.content text/plain", () => {
    const raw = fixture<Status>("akkoma/status.json");
    expect(mfmSourceOf(raw)).toBe("hello from akkoma @akk1");
  });

  it("null without the Akkoma bag, with a non-object, or when empty", () => {
    const raw = fixture<Status>("mastodon/status.json");
    expect(mfmSourceOf(raw)).toBeNull();
    expect(mfmSourceOf({ ...raw, pleroma: { content: "nope" } })).toBeNull();
    expect(mfmSourceOf({ ...raw, pleroma: { content: { "text/plain": "" } } })).toBeNull();
  });
});

describe("statusContentOf / adaptStatus", () => {
  it("Akkoma posts carry BOTH html and mfm; plain follows the MFM", () => {
    const raw = fixture<Status>("akkoma/status.json");
    const content = statusContentOf(raw);
    expect(content.html).toBe(raw.content);
    expect(content.mfm).toBe("hello from akkoma @akk1");
    expect(content.plain).toBe("hello from akkoma akk1");
  });

  it("vanilla Mastodon posts stay HTML-only", () => {
    const post = adaptStatus(fixture<Status>("mastodon/status.json"));
    expect(post.content.html).toBeDefined();
    expect(post.content.mfm).toBeUndefined();
  });

  it("nested quotes without the Akkoma bag stay HTML-only", () => {
    const post = adaptStatus(fixture<Status>("akkoma/status.json"));
    expect(post.quote?.content.html).toBe("<p>the akkoma-quoted post</p>");
    expect(post.quote?.content.mfm).toBeUndefined();
  });

  it("the MFM source parses to a mention-bearing tree", () => {
    const post = adaptStatus(fixture<Status>("akkoma/status.json"));
    const nodes = contentFromMfm(post.content.mfm);
    expect(nodes[1]).toEqual({
      kind: "mention",
      href: null,
      children: [{ kind: "text", text: "@akk1" }],
    });
    expect(textOf(nodes)).toBe("hello from akkoma @akk1");
  });
});
