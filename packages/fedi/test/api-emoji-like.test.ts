// Like-button liked state (F18 follow-up): the white pill means exactly
// one thing — my reaction IS my configured like. Canonical local forms
// (`:name:` vs `:name@.:`) compare equal; distinct remote hosts never do;
// either heart form counts when the like itself is a heart.

import { isHeartReaction, isLikeActive, sameEmojiKey } from "../src/api/emoji";

describe("sameEmojiKey", () => {
  it("equates exact and canonical-local forms only", () => {
    expect(sameEmojiKey(":wow:", ":wow:")).toBe(true);
    expect(sameEmojiKey(":wow:", ":wow@.:")).toBe(true);
    expect(sameEmojiKey(":wow@.:", ":wow:")).toBe(true);
    expect(sameEmojiKey(":wow@a:", ":wow@a:")).toBe(true);
    expect(sameEmojiKey(":wow@a:", ":wow@b:")).toBe(false);
    expect(sameEmojiKey(":wow@a:", ":wow:")).toBe(false);
    expect(sameEmojiKey(":wow:", ":other:")).toBe(false);
    expect(sameEmojiKey("❤", "❤")).toBe(true);
    expect(sameEmojiKey("❤", "👍")).toBe(false);
  });
});

describe("isLikeActive", () => {
  it("is true only when my reaction is the configured like", () => {
    expect(isLikeActive("❤", "❤")).toBe(true);
    expect(isLikeActive("❤", "❤️")).toBe(true);
    expect(isLikeActive(":wow@.:", ":wow@.:")).toBe(true);
    expect(isLikeActive(":wow:", ":wow@.:")).toBe(true);
    expect(isLikeActive("❤", "👍")).toBe(false);
    expect(isLikeActive("❤", null)).toBe(false);
    expect(isLikeActive(":wow@.:", "👍")).toBe(false);
    // A legacy heart under a custom like reads as unliked.
    expect(isLikeActive(":wow@.:", "❤")).toBe(false);
    // Same name on another host is another emoji.
    expect(isLikeActive(":wow@a:", ":wow@b:")).toBe(false);
  });

  it("recognises both heart forms", () => {
    expect(isHeartReaction("❤")).toBe(true);
    expect(isHeartReaction("❤️")).toBe(true);
    expect(isHeartReaction(":wow@.:" )).toBe(false);
  });
});
