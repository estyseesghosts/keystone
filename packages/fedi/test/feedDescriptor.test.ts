import {
  formatFeedDescriptor,
  isFeedDescriptor,
  parseFeedDescriptor,
  type FeedDescriptor,
  type ParsedFeedDescriptor,
} from "../src/core/feedDescriptor";

const VALID: Array<{ descriptor: FeedDescriptor; parsed: ParsedFeedDescriptor }> = [
  { descriptor: "timeline|home", parsed: { kind: "timeline", timeline: "home" } },
  { descriptor: "timeline|local", parsed: { kind: "timeline", timeline: "local" } },
  { descriptor: "timeline|social", parsed: { kind: "timeline", timeline: "social" } },
  { descriptor: "timeline|global", parsed: { kind: "timeline", timeline: "global" } },
  { descriptor: "list|abc123", parsed: { kind: "list", id: "abc123" } },
  { descriptor: "antenna|9s6xvz", parsed: { kind: "antenna", id: "9s6xvz" } },
  { descriptor: "channel|general", parsed: { kind: "channel", id: "general" } },
  { descriptor: "clip|01J9Z", parsed: { kind: "clip", id: "01J9Z" } },
  { descriptor: "tag|misskey", parsed: { kind: "tag", tag: "misskey" } },
  { descriptor: "tag|猫", parsed: { kind: "tag", tag: "猫" } },
  { descriptor: "search|hello world", parsed: { kind: "search", query: "hello world" } },
  { descriptor: "search|#tag @user", parsed: { kind: "search", query: "#tag @user" } },
  { descriptor: "explore|posts", parsed: { kind: "explore" } },
  { descriptor: "bookmarks", parsed: { kind: "bookmarks" } },
  { descriptor: "mentions", parsed: { kind: "mentions" } },
  {
    descriptor: "user|9abc|posts",
    parsed: { kind: "user", id: "9abc", tab: "posts" },
  },
  {
    descriptor: "user|9abc|replies",
    parsed: { kind: "user", id: "9abc", tab: "replies" },
  },
  {
    descriptor: "user|9abc|all",
    parsed: { kind: "user", id: "9abc", tab: "all" },
  },
  {
    descriptor: "user|9abc|media",
    parsed: { kind: "user", id: "9abc", tab: "media" },
  },
  {
    descriptor: "user|9abc|featured",
    parsed: { kind: "user", id: "9abc", tab: "featured" },
  },
];

describe("feedDescriptor", () => {
  it.each(VALID.map((v) => [v.descriptor] as [FeedDescriptor]))(
    "parses %s",
    (descriptor) => {
      const want = VALID.find((v) => v.descriptor === descriptor)?.parsed;
      expect(parseFeedDescriptor(descriptor)).toEqual(want);
    },
  );

  it.each(VALID.map((v) => [v.descriptor] as [FeedDescriptor]))(
    "round-trips %s through format",
    (descriptor) => {
      expect(formatFeedDescriptor(parseFeedDescriptor(descriptor))).toBe(descriptor);
    },
  );

  it.each(VALID.map((v) => [v.parsed] as [ParsedFeedDescriptor]))(
    "round-trips parsed %j through parse",
    (parsed) => {
      expect(parseFeedDescriptor(formatFeedDescriptor(parsed))).toEqual(parsed);
    },
  );

  it("accepts every valid descriptor in the guard", () => {
    for (const { descriptor } of VALID) {
      expect(isFeedDescriptor(descriptor)).toBe(true);
    }
  });

  const INVALID: unknown[] = [
    "",
    "timeline",
    "timeline|",
    "timeline|bogus",
    "timeline|home|extra",
    "Timeline|home",
    "list|",
    "list|   ",
    "list|a|b",
    "antenna|",
    "channel|",
    "clip|",
    "tag|",
    "search|",
    "search|   ",
    "explore|",
    "explore|tags",
    "user|x|bogus",
    "user||posts",
    "user|x|posts|extra",
    "user|x",
    "bookmarks|x",
    "mentions|1",
    "|",
    "||",
    "foo|bar",
    "timeline||home",
    42,
    null,
    undefined,
    {},
    ["timeline|home"],
  ];

  it.each(INVALID.map((v, i) => [i, v] as [number, unknown]))(
    "rejects invalid input #%i",
    (_i, value) => {
      expect(isFeedDescriptor(value)).toBe(false);
      expect(() => parseFeedDescriptor(value as string)).toThrow(
        expect.objectContaining({ name: "FediError" }),
      );
    },
  );

  it("rejects ids containing the separator on format", () => {
    expect(() =>
      formatFeedDescriptor({ kind: "list", id: "a|b" }),
    ).toThrow();
    expect(() =>
      formatFeedDescriptor({ kind: "user", id: "", tab: "posts" }),
    ).toThrow();
    expect(() =>
      formatFeedDescriptor({ kind: "search", query: "  " }),
    ).toThrow();
  });
});
