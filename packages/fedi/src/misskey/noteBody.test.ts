// Note-body omit-null pins (D3.1): create and edit share one builder.
// Create omits blank/absent fields; edit sends explicit nulls for cleared
// text/cw and explicit `fileIds: []` / `poll: null` for known-cleared
// media/polls, but still omits unknown (`undefined`) fields.

import { createEditNoteBody, createNoteBody, wireVisibility } from "./noteBody";

describe("noteBody omit-null", () => {
  it("create omits blank text/cw and absent optionals", () => {
    expect(
      createNoteBody({
        text: "  ",
        cw: "",
        visibility: { kind: "direct", localOnly: false },
        visibleUserIds: ["u1"],
        mediaIds: [],
      }),
    ).toEqual({ visibility: "specified", visibleUserIds: ["u1"] });
  });

  it("create sends trimmed text, localOnly, recipients only when specified", () => {
    expect(
      createNoteBody({
        text: "  hello  ",
        visibility: { kind: "followers", localOnly: true, raw: "home" },
        visibleUserIds: ["u1"],
        reactionAcceptance: "likeOnly",
        noQuote: true,
        poll: { choices: ["a", "b"], multiple: true, expiredAfter: 60 },
      }),
    ).toEqual({
      visibility: "home",
      text: "hello",
      localOnly: true,
      reactionAcceptance: "likeOnly",
      noQuote: true,
      poll: { choices: ["a", "b"], multiple: true, expiredAfter: 60 },
    });
  });

  it("edit sends explicit nulls for cleared text/cw but omits absent optionals", () => {
    expect(
      createEditNoteBody({
        text: "hi",
        cw: "   ",
        visibility: { kind: "public", localOnly: false },
        noQuote: false,
      }),
    ).toEqual({
      text: "hi",
      cw: null,
      visibility: "public",
      noQuote: false,
    });
  });

  it("edit sends fileIds: [] when the caller knows media is cleared, omits when unknown", () => {
    expect(
      createEditNoteBody({
        text: "hi",
        visibility: { kind: "public", localOnly: false },
        mediaIds: [],
      }),
    ).toMatchObject({ fileIds: [] });
    expect(
      createEditNoteBody({
        text: "hi",
        visibility: { kind: "public", localOnly: false },
      }),
    ).not.toHaveProperty("fileIds");
  });

  it("edit sends poll: null to clear, omits an unknown poll, builds a present one", () => {
    expect(
      createEditNoteBody({
        text: "hi",
        visibility: { kind: "public", localOnly: false },
        poll: null,
      }),
    ).toMatchObject({ poll: null });
    expect(
      createEditNoteBody({
        text: "hi",
        visibility: { kind: "public", localOnly: false },
      }),
    ).not.toHaveProperty("poll");
  });

  it("edit keeps the create-shaped poll with omit-null optionals", () => {
    expect(
      createEditNoteBody({
        text: "hi",
        visibility: { kind: "public", localOnly: false },
        poll: { choices: ["a", "b"] },
      }),
    ).toEqual({
      text: "hi",
      cw: null,
      visibility: "public",
      poll: { choices: ["a", "b"] },
    });
  });

  it("wireVisibility round-trips raw and maps quiet/direct", () => {
    expect(wireVisibility({ visibility: { kind: "followers", localOnly: true, raw: "home" } })).toBe(
      "home",
    );
    expect(wireVisibility({ visibility: { kind: "quiet", localOnly: false } })).toBe("home");
    expect(wireVisibility({ visibility: { kind: "direct", localOnly: false } })).toBe(
      "specified",
    );
    expect(wireVisibility({})).toBe("public");
  });
});
