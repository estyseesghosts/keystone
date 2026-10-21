// Phase 2 adapt tests: EVERY wire → core mapping is exercised against the
// per-flavor fixtures (misskey, sharkey, pinetree). The fixtures are
// SYNTHESISED (see test/fixtures/README.md and manifest.json) — they
// prove the mapping handles each documented shape, not that a live server
// emits it. Run scripts/record_fixtures.py on the backend machine to
// replace them with recorded bodies.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptAccount,
  adaptDriveFile,
  adaptFollowRequest,
  adaptGroupedNotification,
  adaptMe,
  adaptNote,
  adaptNotification,
  adaptPoll,
  adaptUserRelation,
  decodeCursor,
  encodeCursor,
  pageOf,
} from "../src/misskey/adapt";
import type {
  DriveFile,
  GroupedNotificationItem,
  NotificationItem,
  Note,
  Poll,
  UserDetailed,
  UserRelation,
  FollowRequest,
  MeDetailed,
} from "../src/misskey/wire";
import { postFromWire } from "./helpers";

const FLAVORS = ["misskey", "sharkey", "pinetree"] as const;

function fixture<T>(flavor: string, name: string): T {
  // Jest port: `describe/it/expect` are globals (no vitest import).
  // Every flavor — pinetree included — reads from
  // `packages/fedi/test/fixtures/` (see `manifest.json` for provenance;
  // all bodies synthesised until recorded against a live server).
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

describe("adaptNote (all three Misskey flavors)", () => {
  for (const flavor of FLAVORS) {
    it(`${flavor}: maps identity, author, content and cw`, () => {
      const note = fixture<Note>(flavor, "note.json");
      const post = adaptNote(note);
      expect(post.id).toBe(note.id);
      expect(post.createdAt).toBe(note.createdAt);
      expect(post.accountId).toBe(note.userId);
      expect(post.author.id).toBe(note.user.id);
      expect(post.content.mfm).toBe(note.text);
      expect(post.cw).toBe(note.cw);
    });

    it(`${flavor}: maps counts and media ids`, () => {
      const note = fixture<Note>(flavor, "note.json");
      const post = adaptNote(note);
      expect(post.counts.replies).toBe(note.repliesCount);
      expect(post.counts.boosts).toBe(note.renoteCount);
      expect(post.counts.reactions).toBe(note.reactionCount);
      expect(post.mediaIds).toEqual(note.fileIds);
      expect(post.media.map((m) => m.id)).toEqual(note.files.map((f) => f.id));
    });
  }

  it("keeps Misskey home as kind quiet with raw home (never rewritten)", () => {
    const post = adaptNote(fixture<Note>("misskey", "note.json"));
    expect(post.visibility.kind).toBe("quiet");
    expect(post.visibility.raw).toBe("home");
    expect(post.visibility.localOnly).toBe(false);
  });

  it("keeps Sharkey localOnly separate from the kind", () => {
    const post = adaptNote(fixture<Note>("sharkey", "note.json"));
    expect(post.visibility.kind).toBe("followers");
    expect(post.visibility.localOnly).toBe(true);
    expect(post.visibility.raw).toBe("followers");
    expect(post.ext.reactionAcceptance).toBe("likeOnlyForRemote");
  });

  it("maps the reaction summary: entries, order, mine and packed urls", () => {
    const post = adaptNote(fixture<Note>("misskey", "note.json"));
    expect(post.reactions?.total).toBe(4);
    expect(post.reactions?.entries.map((e) => e.key)).toEqual(["👍", "❤", ":blobcat:"]);
    expect(post.reactions?.mine).toBe("❤");
    expect(post.reactions?.entries.find((e) => e.key === "❤")?.mine).toBe(true);
    expect(post.reactions?.entries.find((e) => e.key === ":blobcat:")?.url).toBe(
      "https://misskey.example.com/emoji/blobcat.webp",
    );
    expect(post.reactions?.myReactions).toEqual(["❤"]);
    expect(post.ext.myReactionPacked).toBe(true);
  });

  it("keeps remote reaction keys verbatim (Sharkey)", () => {
    const post = adaptNote(fixture<Note>("sharkey", "note.json"));
    expect(post.reactions?.entries.map((e) => e.key)).toEqual([
      "❤",
      ":wave@remote.example:",
    ]);
    expect(post.reactions?.entries[1].url).toBe(
      "https://remote.example.com/emoji/wave.png",
    );
  });

  it("records the absence of a packed myReaction (never faked)", () => {
    const notif = fixture<NotificationItem>("misskey", "notification.json");
    const post = adaptNote(notif.note as Note);
    expect(post.reactions?.mine).toBeNull();
    expect(post.ext.myReactionPacked).toBe(false);
  });

  it("maps the Pinetree quote extensions to ext + quoteUnavailable", () => {
    const post = adaptNote(fixture<Note>("pinetree", "note.json"));
    expect(post.ext.quoteTargetUri).toBe(
      "https://remote.example.com/notes/9remotenote0000001",
    );
    expect(post.ext.quoteTargetUnavailable).toBe(true);
    expect(post.ext.quoteAuthorizationStatus).toBe("accepted");
    expect(post.quoteUnavailable).toBe(true);
    expect(post.quote).toBeNull();
  });

  it("Misskey/Sharkey notes carry no quote extensions (absent, not false)", () => {
    const post = adaptNote(fixture<Note>("misskey", "note.json"));
    expect(post.ext.quoteTargetUri).toBeNull();
    expect(post.quoteUnavailable).toBe(false);
  });

  it("recurses into packed reply/renote and ignores unknown wire fields", () => {
    const note = fixture<Note>("sharkey", "note.json");
    const post = adaptNote(note);
    expect(post.renote?.id).toBe("9sharkeynote000002");
    // The packed renote is itself a pure-renote wrapper.
    expect(post.renote?.renoteId).toBe("9sharkeynote000003");
    // Unknown wire fields are dropped, never carried into the model.
    expect(Object.keys(post.renote?.ext ?? {})).not.toContain("extraUnknownField");
  });

  it("maps a poll with votes summed and votersCount never coerced", () => {
    const post = adaptNote(fixture<Note>("misskey", "note.json"));
    expect(post.poll?.multiple).toBe(false);
    expect(post.poll?.votesCount).toBe(4);
    expect(post.poll?.votersCount).toBeNull();
    expect(post.poll?.options).toEqual([
      { text: "yes", votesCount: 3, voted: true },
      { text: "no", votesCount: 1, voted: false },
    ]);
  });
});

describe("adaptAccount / adaptMe (all three flavors)", () => {
  for (const flavor of FLAVORS) {
    it(`${flavor}: maps identity and display names`, () => {
      const user = fixture<UserDetailed>(flavor, "user.json");
      const account = adaptAccount(user);
      expect(account.id).toBe(user.id);
      expect(account.username).toBe(user.username);
      expect(account.host).toBe(user.host ?? null);
      expect(account.displayName).toBe(user.name ?? user.username);
    });
  }

  it("maps the Misskey detailed profile fully", () => {
    const user = fixture<UserDetailed>("misskey", "user.json");
    const account = adaptAccount(user);
    expect(account.acct).toBe("ann");
    expect(account.bio.mfm).toContain("MFM **bio**");
    expect(account.headerUrl).toBe(user.bannerUrl);
    expect(account.statusesCount).toBe(56);
    expect(account.followersCount).toBe(12);
    expect(account.cat).toBe(true);
    expect(account.ffVisibility).toBe("public");
    expect(account.pinnedPostIds).toEqual(["9fz3examplenote0001"]);
    expect(account.isFollowing).toBe(true);
    expect(account.hasPendingFollowRequestFromYou).toBe(false);
  });

  it("a remote user's acct carries the host", () => {
    const notif = fixture<NotificationItem>("misskey", "notification.json");
    const account = adaptAccount(notif.user as NonNullable<NotificationItem["user"]>);
    expect(account.acct).toBe("bob@sharkey.example");
    expect(account.host).toBe("sharkey.example");
  });

  it("Pinetree's absent newer fields stay absent/empty — never faked", () => {
    const user = fixture<UserDetailed>("pinetree", "user.json");
    const account = adaptAccount(user);
    expect(account.ffVisibility).toBeNull();
    expect(account.pinnedPostIds).toBeNull();
    expect(account.pinnedPosts).toBeNull();
    expect(account.isFollowing).toBeUndefined();
    expect(account.hasPendingFollowRequestFromYou).toBeUndefined();
    expect(account.birthday).toBeNull();
  });

  it("adaptMe carries the raw i bag in ext.me for the profile editor", () => {
    const me = fixture<MeDetailed>("misskey", "user.json");
    const account = adaptMe(me);
    expect(account.ext.me?.username).toBe("ann");
    expect(account.ext.me?.followersCount).toBe(12);
  });
});

describe("adaptDriveFile (all three flavors)", () => {
  it("maps image/video/file kinds from the MIME prefix", () => {
    expect(adaptDriveFile(fixture<DriveFile>("misskey", "drive-file.json")).kind).toBe(
      "image",
    );
    expect(adaptDriveFile(fixture<DriveFile>("sharkey", "drive-file.json")).kind).toBe(
      "video",
    );
    expect(adaptDriveFile(fixture<DriveFile>("pinetree", "drive-file.json")).kind).toBe(
      "file",
    );
  });

  it("maps name/comment/properties/folder verbatim", () => {
    const media = adaptDriveFile(fixture<DriveFile>("misskey", "drive-file.json"));
    expect(media.name).toBe("diagram.png");
    expect(media.description).toBe("a diagram");
    expect(media.meta).toEqual({ width: 640, height: 480 });
    expect(media.folderId).toBe("9examplefolder0001");
    expect(media.previewUrl).toContain("diagram-thumb");
    expect(media.isSensitive).toBe(false);
  });

  it("keeps Sharkey sensitivity and duration metadata", () => {
    const media = adaptDriveFile(fixture<DriveFile>("sharkey", "drive-file.json"));
    expect(media.isSensitive).toBe(true);
    expect(media.meta?.duration).toBe(12.5);
  });
});

describe("adaptPoll", () => {
  const wire: Poll = {
    multiple: true,
    expiresAt: "2020-01-01T00:00:00.000Z",
    expiredAfter: null,
    choices: [
      { text: "a", votes: 2, isVoted: true },
      { text: "b", votes: 0, isVoted: false },
    ],
  };

  it("derives expired from the clock at adapt time", () => {
    expect(adaptPoll(wire, Date.now())?.expired).toBe(true);
    expect(adaptPoll({ ...wire, expiresAt: "2999-01-01T00:00:00.000Z" })?.expired).toBe(
      false,
    );
    expect(adaptPoll({ ...wire, expiresAt: null })?.expired).toBe(false);
  });

  it("sums votes and never coerces votersCount", () => {
    const poll = adaptPoll(wire);
    expect(poll?.votesCount).toBe(2);
    expect(poll?.votersCount).toBeNull();
    expect(poll?.multiple).toBe(true);
    expect(adaptPoll(null)).toBeNull();
  });
});

describe("adaptNotification (all three flavors)", () => {
  it("maps a Misskey reaction row: kind, actor, reaction, post", () => {
    const n = adaptNotification(fixture<NotificationItem>("misskey", "notification.json"));
    expect(n.kind).toBe("reaction");
    expect(n.rawType).toBe("reaction");
    expect(n.actors).toHaveLength(1);
    expect(n.actors[0].account?.acct).toBe("bob@sharkey.example");
    expect(n.actors[0].reaction).toBe("🎉");
    expect(n.post?.id).toBe("9fz3examplenote0001");
    expect(n.reaction).toBe("🎉");
  });

  it("read is unknown where the wire packs no isRead (Misskey/Sharkey)", () => {
    expect(
      adaptNotification(fixture<NotificationItem>("misskey", "notification.json")).read,
    ).toBeNull();
    expect(
      adaptNotification(fixture<NotificationItem>("sharkey", "notification.json")).read,
    ).toBeNull();
  });

  it("keeps Pinetree's packed isRead", () => {
    const n = adaptNotification(
      fixture<NotificationItem>("pinetree", "notification.json"),
    );
    expect(n.read).toBe(true);
    expect(n.kind).toBe("follow");
    expect(n.post).toBeNull();
  });

  it("unknown wire types map to kind unknown with rawType kept", () => {
    const raw = fixture<NotificationItem>("misskey", "notification.json");
    const n = adaptNotification({ ...raw, type: "someFutureThing" });
    expect(n.kind).toBe("unknown");
    expect(n.rawType).toBe("someFutureThing");
  });

  it("a flat row without a packed user keeps an id-only actor", () => {
    const raw = fixture<NotificationItem>("misskey", "notification.json");
    const n = adaptNotification({ ...raw, user: null, userId: "9x" });
    expect(n.actors).toEqual([{ id: "9x", account: null, reaction: "🎉" }]);
  });
});

describe("adaptGroupedNotification (misskey + sharkey)", () => {
  it("aggregates actors, pairs reactions and keeps id-only actors", () => {
    const g = adaptGroupedNotification(
      fixture<GroupedNotificationItem>("misskey", "notification-grouped.json"),
    );
    expect(g.kind).toBe("reaction");
    // users[] packed two; userIds[] listed three — the third is id-only.
    expect(g.actors.map((a) => a.id)).toEqual([
      "9exampleuser00002",
      "9exampleuser00003",
      "9exampleuser00004",
    ]);
    expect(g.actors[2].account).toBeNull();
    expect(g.actors[0].reaction).toBe("🎉");
    expect(g.actors[1].reaction).toBe("👍");
    expect(g.actors[2].reaction).toBeNull();
    expect(g.ext.groupedReactions).toHaveLength(2);
    expect(g.post?.id).toBe("9fz3examplenote0001");
  });

  it("never duplicates an actor listed twice", () => {
    const g = adaptGroupedNotification(
      fixture<GroupedNotificationItem>("sharkey", "notification-grouped.json"),
    );
    expect(g.actors).toHaveLength(1);
    expect(g.actors[0].account?.username).toBe("booster");
    expect(g.read).toBeNull();
  });
});

describe("adaptUserRelation / adaptFollowRequest", () => {
  it("keeps absent relation flags absent (unknown, never false)", () => {
    const rel = adaptUserRelation({ id: "u1", isFollowing: true } as UserRelation);
    expect(rel.isFollowing).toBe(true);
    expect(rel.isMuted).toBeUndefined();
    expect(rel.isBlocking).toBeUndefined();
  });

  it("adapts both sides of a follow request", () => {
    const req = adaptFollowRequest({
      id: "fr1",
      follower: fixture<Note>("misskey", "notification.json").user,
      followee: fixture<Note>("misskey", "note.json").user,
    } as unknown as FollowRequest);
    expect(req.follower.username).toBe("bob");
    expect(req.followee.username).toBe("ann");
  });
});

describe("cursors and pages", () => {
  it("round-trips a Misskey cursor opaquely", () => {
    const cursor = encodeCursor({ untilId: "abc" });
    expect(cursor).not.toBeNull();
    expect(decodeCursor(cursor)).toEqual({ untilId: "abc" });
    expect(decodeCursor(null)).toEqual({});
    expect(decodeCursor("not json" as never)).toEqual({});
    expect(encodeCursor(null)).toBeNull();
  });

  it("pageOf ends on a short or empty page (the app's walk guard)", () => {
    const note = fixture<NotificationItem>("misskey", "notification.json").note as Note;
    const short = pageOf([note], 5, adaptNote);
    expect(short.end).toBe(true); // 1 < 5: the listing is exhausted
    expect(decodeCursor(short.cursor)).toEqual({ untilId: note.id });
    const empty = pageOf([], 5, adaptNote);
    expect(empty.end).toBe(true);
    expect(empty.cursor).toBeNull();
    expect(empty.items).toEqual([]);
  });

  it("pageOf carries the last id as the next cursor on a full page", () => {
    const note = fixture<NotificationItem>("misskey", "notification.json").note as Note;
    const page = pageOf([note], 1, adaptNote);
    expect(page.end).toBe(false);
    expect(decodeCursor(page.cursor)).toEqual({ untilId: note.id });
    expect(page.items[0].id).toBe(note.id);
  });
});

describe("adaptNote quote mapping (F5)", () => {
  it("maps a packed renote with own text to quote (quote-renote renders)", () => {
    const post = adaptNote(fixture<Note>("sharkey", "note.json"));
    expect(post.renote?.id).toBe("9sharkeynote000002");
    expect(post.quote?.id).toBe("9sharkeynote000002");
    expect(post.quoteUnavailable).toBe(false);
  });

  it("keeps quote null for a pure renote (appearNoteOf folds it)", () => {
    const pure = postFromWire({
      id: "w1",
      renoteId: "o1",
      renote: { id: "o1", text: "original" },
    });
    expect(pure.renote?.id).toBe("o1");
    expect(pure.quote).toBeNull();
  });

  it("keeps quote null when the target is unpacked (unavailable, never faked)", () => {
    const q = postFromWire({ id: "q1", text: "commentary", renoteId: "gone" });
    expect(q.renote).toBeNull();
    expect(q.quote).toBeNull();
  });
});
