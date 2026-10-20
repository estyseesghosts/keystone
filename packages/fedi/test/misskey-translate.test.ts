// Phase 1 item A — port of /tmp/opencode/translate-check.mjs into the repo as
// real tests against `src/api/translate` (the /tmp script already imported the
// real TS source via node type-stripping). Assertions preserved one-for-one.
// The live cases quoted in the comments were observed on dvd.chat
// (state/logs/2026-10-16-translate-scope.md).
import {
  decideTranslation,
  distanceRatio,
  hasForeignScript,
  hasTranslatableText,
  normalizeForCompare,
  translatableText,
  translationDiffers,
} from "../src/misskey/translate";

describe("gate: structured tokens never count as translatable", () => {
  it("plain prose", () => expect(hasTranslatableText("hello world")).toBe(true));
  it("emoji-only", () => expect(hasTranslatableText("😂😂🎉")).toBe(false));
  it("custom-emoji-only", () => expect(hasTranslatableText(":aru_0130::aru_0220:")).toBe(false));
  it("hashtags-only", () => expect(hasTranslatableText("#foo #bar #🍵")).toBe(false));
  it("url-only", () => expect(hasTranslatableText("https://dvd.chat/@jm")).toBe(false));
  it("mention-only", () => expect(hasTranslatableText("@alice")).toBe(false));
  it("mention+url", () => expect(hasTranslatableText("@alice https://x.y/z")).toBe(false));
  it("numbers-only", () => expect(hasTranslatableText("2026-10-16")).toBe(false));
  it("null", () => expect(hasTranslatableText(null)).toBe(false));
  it("empty", () => expect(hasTranslatableText("")).toBe(false));
  it("mixed keeps prose", () =>
    expect(hasTranslatableText("Hello @alice 😂 https://x.y #tag")).toBe(true));
  it("chinese+emoji", () => expect(hasTranslatableText("等下班 😊")).toBe(true));
  it("leetspeak", () => expect(hasTranslatableText("p1netree on github eta s0n")).toBe(true));
});

describe("extraction", () => {
  it("identity", () => expect(translatableText("hello world")).toBe("hello world"));
  it("strips structured tokens, keeps prose", () => {
    const mixed = translatableText(
      "Hello @alice, see https://x.y/z #tag 😂 :blob: [label](https://a.b)",
    );
    expect(mixed.includes("@alice")).toBe(false);
    expect(mixed.includes("https://")).toBe(false);
    expect(mixed.includes("#tag")).toBe(false);
    expect(mixed.includes("😂")).toBe(false);
    expect(mixed.includes(":blob:")).toBe(false);
    expect(mixed.includes("label")).toBe(false);
    expect(mixed.includes("Hello")).toBe(true);
    expect(mixed.includes("see")).toBe(true);
  });
});

describe("script + normalize + distance", () => {
  it("latin not foreign", () => expect(hasForeignScript("hello")).toBe(false));
  it("accented latin not foreign", () => expect(hasForeignScript("café naïve")).toBe(false));
  it("cyrillic foreign", () => expect(hasForeignScript("Дякую")).toBe(true));
  it("han foreign", () => expect(hasForeignScript("你好")).toBe(true));
  it("empty not foreign", () => expect(hasForeignScript("")).toBe(false));
  it("normalize", () => expect(normalizeForCompare("  Hello\nWORLD  ")).toBe("hello world"));
  it("distance identical", () => expect(distanceRatio("abc", "abc")).toBe(0));
  it("distance trivial", () =>
    expect(
      distanceRatio(
        normalizeForCompare("this is my sign to take webdev a little more seriously"),
        normalizeForCompare("This is my sign to take web dev a little more seriously."),
      ) < 0.25,
    ).toBe(true));
  it("distance real", () =>
    expect(
      distanceRatio(
        normalizeForCompare("Дякую за підтримку!"),
        normalizeForCompare("Thank you for your support!"),
      ) > 0.25,
    ).toBe(true));
});

describe("policy", () => {
  it("differs german", () => expect(translationDiffers("German")).toBe(true));
  it("same english", () => expect(translationDiffers("English")).toBe(false));
  it("same subtag", () => expect(translationDiffers("en")).toBe(false));
  it("misdetect identical → hidden", () =>
    expect(
      decideTranslation("keystone test https://dvd.chat/@jm", {
        sourceLang: "German",
        text: "keystone test https://dvd.chat/@jm",
      }),
    ).toEqual({ show: false }));
  it("real translation → shown, labeled", () =>
    expect(
      decideTranslation("等下班", { sourceLang: "Chinese", text: "Waiting to get off work" }),
    ).toEqual({ show: true, label: "Chinese" }));
  it("same-language noise → hidden", () =>
    expect(
      decideTranslation("this is my sign to take webdev a little more seriously", {
        sourceLang: "English",
        text: "This is my sign to take web dev a little more seriously.",
      }),
    ).toEqual({ show: false }));
  it("misfire override → shown, generic label", () =>
    expect(
      decideTranslation("Дякую за підтримку! Слава Україні!", {
        sourceLang: "English",
        text: "Thank you for your support! Glory to Ukraine!",
      }),
    ).toEqual({ show: true, label: null }));
  it("hallucination suppressed", () =>
    expect(
      decideTranslation("p1netree on github eta s0n", {
        sourceLang: "English",
        text: "Started this last night and I already have working federation with Misskey and Sharkey! The whole fedi interop thing is amazing and wonderful!",
      }),
    ).toEqual({ show: false }));
});
