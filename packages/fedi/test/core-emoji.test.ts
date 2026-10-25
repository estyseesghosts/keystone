// X5.3 — tolerant packed-emoji lookup (core/emoji).
// Both packed shapes resolve: colon-wrapped (`:name:` / `:name@host:`)
// and bare (`name` / `name@host`). Lookup order: exact key, then bare
// `name@host`, then `name` (local codes only; remote never falls back to
// a local lookalike).
import { lookupPackedEmojis } from "../src/core/emoji";

describe("lookupPackedEmojis (X5.3)", () => {
  it("resolves a local code from either packed shape", () => {
    const url = "https://misskey.example.com/emoji/blobcat.webp";
    expect(lookupPackedEmojis({ ":blobcat:": url }, ":blobcat:")).toBe(url);
    expect(lookupPackedEmojis({ blobcat: url }, ":blobcat:")).toBe(url);
  });

  it("resolves a remote code from either packed shape", () => {
    const url = "https://remote.example.com/emoji/wave.png";
    expect(lookupPackedEmojis({ ":wave@remote.example:": url }, ":wave@remote.example:")).toBe(url);
    expect(lookupPackedEmojis({ "wave@remote.example": url }, ":wave@remote.example:")).toBe(url);
  });

  it("prefers the exact key when both shapes are present", () => {
    const packed = { ":blobcat:": "https://a/wrapped.webp", blobcat: "https://a/bare.webp" };
    expect(lookupPackedEmojis(packed, ":blobcat:")).toBe("https://a/wrapped.webp");
  });

  it("falls back from :name@.: to the bare name for local codes", () => {
    const url = "https://x/blob.webp";
    expect(lookupPackedEmojis({ blob: url }, ":blob@.:")).toBe(url);
    expect(lookupPackedEmojis({ ":blob:": url }, ":blob@.:")).toBe(url);
  });

  it("never resolves a remote code to a local lookalike", () => {
    expect(lookupPackedEmojis({ wave: "https://x/wave.png" }, ":wave@remote.example:")).toBeNull();
  });

  it("returns null for missing, empty, or blank inputs", () => {
    expect(lookupPackedEmojis(null, ":blobcat:")).toBeNull();
    expect(lookupPackedEmojis({}, ":blobcat:")).toBeNull();
    expect(lookupPackedEmojis({ blobcat: "https://x/b.png" }, "   ")).toBeNull();
  });
});
