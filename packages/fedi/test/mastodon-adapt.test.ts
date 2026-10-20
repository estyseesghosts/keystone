// Phase 3 adapt tests: EVERY Mastodon-family wire → core mapping is
// exercised against the per-flavor fixtures (mastodon, akkoma). The
// fixtures are SYNTHESISED and labelled (test/fixtures/README.md +
// manifest.json) — they prove the mapping handles each documented shape,
// not that a live server emits it. Run scripts/record_fixtures.py
// --remote on a machine that can reach a Mastodon/Akkoma instance to
// replace them with recorded bodies.
//
// Discipline pinned here (AGENTS.md §5 + keystodon.md §1.5):
// - favourites are NEVER merged into `reactions`;
// - `visibility.raw` is NEVER rewritten (Akkoma `local` reads kind
//   "quiet" + localOnly, raw stays "local");
// - unknown wire values are never rounded up (visibility → "direct",
//   notification types → kind "unknown" with rawType kept);
// - absent fields are never faked (votersCount stays null, `read` stays
//   null where the wire packs no is_seen, no emoji_reactions field →
//   reactions null).

import { readFileSync } from "node:fs";
import { join } from "node:path";
// Jest port: `describe/it/expect` are globals (no vitest import).
import {
  adaptAccount,
  adaptCredentialAccount,
  adaptMedia,
  adaptNotification,
  adaptPoll,
  adaptRelationship,
  adaptStatus,
  decodeContinuation,
  encodeContinuation,
  htmlContentOf,
  htmlToPlainText,
  pageOf,
  visibilityOfWire,
} from "../src/mastodon/adapt";
import { appearNoteOf, isPureRenote } from "../src/core/models";
import type {
  Account as WireAccount,
  CredentialAccount,
  MediaAttachment,
  Notification as WireNotification,
  Poll as WirePoll,
  Relationship as WireRelationship,
  Status,
} from "../src/mastodon/wire";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

describe("adaptStatus (vanilla Mastodon)", () => {
  it("maps identity, author, html content and cw", () => {
    const status = fixture<Status>("mastodon", "status.json");
    const post = adaptStatus(status);
    expect(post.id).toBe(status.id);
    expect(post.createdAt).toBe(status.created_at);
    expect(post.accountId).toBe(status.account.id);
    expect(post.author.id).toBe(status.account.id);
    expect(post.content.html).toBe(status.content);
    expect(post.content.mfm).toBeUndefined();
    expect(post.content.plain).toContain("Hello @alice");
    expect(post.content.plain).toContain(":keystone:");
    expect(post.cw).toBe("test fixture");
  });

  it("empty content has NO html source (boost wrappers are pure renotes)", () => {
    const wrap = fixture<Status>("mastodon", "status-reblog.json");
    const post = adaptStatus(wrap);
    expect(post.content.html).toBeUndefined();
    expect(post.content.plain).toBe("");
  });

  it("keeps visibility raw unlisted with kind quiet (never rewritten)", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.visibility.kind).toBe("quiet");
    expect(post.visibility.raw).toBe("unlisted");
    expect(post.visibility.localOnly).toBe(false);
  });

  it("maps counts, editedAt, filtered and pin/bookmark/boost flags", () => {
    const status = fixture<Status>("mastodon", "status.json");
    const post = adaptStatus(status);
    expect(post.counts.replies).toBe(2);
    expect(post.counts.boosts).toBe(3);
    expect(post.counts.quotes).toBe(1);
    expect(post.counts.favourites).toBe(7);
    expect(post.editedAt).toBe(status.edited_at);
    expect(post.filtered).toEqual([{ title: "spoilers", action: "warn" }]);
    expect(post.pinned).toBe(true);
    expect(post.ext.bookmarked).toBe(true);
    expect(post.ext.reblogged).toBe(false);
  });

  it("maps media with the status-level sensitivity and honest MIME", () => {
    const status = fixture<Status>("mastodon", "status.json");
    const post = adaptStatus(status);
    expect(post.media.map((m) => m.id)).toEqual(post.mediaIds);
    expect(post.media[0].kind).toBe("image");
    expect(post.media[1].kind).toBe("video");
    // The wire sends no MIME on vanilla Mastodon — absent stays "".
    expect(post.media[0].mimeType).toBe("");
    expect(post.media[0].isSensitive).toBe(true); // the STATUS is sensitive
    expect(post.media[0].description).toBe("a diagram");
    expect(post.media[0].meta).toEqual(status.media_attachments[0].meta);
  });

  it("maps the poll with per-option own_votes and votersCount verbatim", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.poll?.multiple).toBe(true);
    expect(post.poll?.votesCount).toBe(4);
    expect(post.poll?.votersCount).toBe(3);
    expect(post.poll?.expired).toBe(false);
    expect(post.poll?.options).toEqual([
      { text: "yes", votesCount: 3, voted: true },
      { text: "no", votesCount: 1, voted: false },
    ]);
  });

  it("maps the server link card", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.card?.url).toBe("https://joinmastodon.org/");
    expect(post.card?.title).toBe("Mastodon");
    expect(post.card?.image).toContain("preview_cards");
    expect(post.card?.providerName).toBe("");
  });

  it("maps mentions to ids and keeps the anchor URLs in ext.mentionUrls", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.mentions).toEqual(["2"]);
    expect(post.ext.mentionUrls).toEqual({ "2": "https://mastodon.example.com/@alice" });
    expect(post.tags).toEqual(["keystone"]);
    expect(post.emojis.keystone).toContain("custom_emojis/keystone.png");
  });

  it("vanilla Mastodon has NO reactions field → reactions null, favourite set", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.reactions).toBeNull();
    expect(post.favourite).toEqual({ count: 7, mine: true });
    expect(post.counts.reactions).toBe(0);
  });
});

describe("reblog wrappers map to renote (the plan's renote/reblog)", () => {
  it("maps reblog → renote + renoteId and keeps the wrapper pure", () => {
    const wrap = adaptStatus(fixture<Status>("mastodon", "status-reblog.json"));
    expect(wrap.renote?.id).toBe("113959271829458643");
    expect(wrap.renoteId).toBe("113959271829458643");
    expect(isPureRenote(wrap)).toBe(true);
    expect(appearNoteOf(wrap).id).toBe("113959271829458643");
    // Akkoma wrappers carry zeroed counts — they never render from the
    // wrapper (appearNoteOf shows the original).
    expect(wrap.counts.favourites).toBe(0);
    expect(wrap.author.bot).toBe(true);
  });

  it("a plain post is not a pure renote and appears as itself", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(isPureRenote(post)).toBe(false);
    expect(appearNoteOf(post).id).toBe(post.id);
  });
});

describe("quote shapes (Mastodon object vs Akkoma nested status)", () => {
  it("Mastodon {state, quoted_status}: quote + quoteState accepted", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status.json"));
    expect(post.quote?.id).toBe("113959271829458643");
    expect(post.quoteState).toBe("accepted");
    expect(post.quoteUnavailable).toBe(false);
    expect(post.quote?.content.html).toBe("<p>the quoted post</p>");
  });

  it("pending quotes still carry the target (rendering never depends on authorization)", () => {
    const post = adaptStatus(fixture<Status>("mastodon", "status-quote-pending.json"));
    expect(post.quoteState).toBe("pending");
    expect(post.quote?.id).toBe("113959271829458643");
    expect(post.quoteUnavailable).toBe(false);
  });

  it("a quote object with NO quoted_status is unavailable, not absent", () => {
    const raw = fixture<Status>("mastodon", "status-quote-pending.json");
    const post = adaptStatus({ ...raw, quote: { state: "pending" } });
    expect(post.quote).toBeNull();
    expect(post.quoteUnavailable).toBe(true);
  });

  it("Akkoma nests the quoted status itself (state accepted)", () => {
    const post = adaptStatus(fixture<Status>("akkoma", "status.json"));
    expect(post.quote?.id).toBe("9sMzZWf1bmVmYQxZqC");
    expect(post.quoteState).toBe("accepted");
    expect(post.quoteUnavailable).toBe(false);
  });

  it("quote null + quote_id set = unavailable (deleted target)", () => {
    const raw = fixture<Status>("akkoma", "status.json");
    const post = adaptStatus({ ...raw, quote: null });
    expect(post.quote).toBeNull();
    expect(post.quoteState).toBeNull();
    expect(post.quoteUnavailable).toBe(true);
  });

  it("no quote and no quote_id is just 'no quote'", () => {
    const raw = fixture<Status>("akkoma", "status.json");
    const post = adaptStatus({ ...raw, quote: null, quote_id: null });
    expect(post.quoteUnavailable).toBe(false);
  });
});

describe("visibility mapping (raw never rewritten, unknown never rounded up)", () => {
  it("Akkoma local reads kind quiet with localOnly true and raw local", () => {
    const vis = visibilityOfWire("local");
    expect(vis.kind).toBe("quiet");
    expect(vis.localOnly).toBe(true);
    expect(vis.raw).toBe("local");
  });

  it("public/unlisted/private/direct map to the normalized kinds", () => {
    expect(visibilityOfWire("public").kind).toBe("public");
    expect(visibilityOfWire("unlisted").kind).toBe("quiet");
    expect(visibilityOfWire("private").kind).toBe("followers");
    expect(visibilityOfWire("direct").kind).toBe("direct");
  });

  it("unknown wire values (limited, list:…) read direct — never public", () => {
    expect(visibilityOfWire("limited").kind).toBe("direct");
    expect(visibilityOfWire("list:42").kind).toBe("direct");
    expect(visibilityOfWire("list:42").raw).toBe("list:42");
    expect(visibilityOfWire("something-new").kind).toBe("direct");
  });

  it("an Akkoma local post keeps raw local on the model", () => {
    const post = adaptStatus(fixture<Status>("akkoma", "status.json"));
    expect(post.visibility).toEqual({ kind: "quiet", localOnly: true, raw: "local" });
  });
});

describe("reactions vs favourites (never merged, keystodon.md §1.5)", () => {
  it("Akkoma emoji_reactions map to a ReactionSummary", () => {
    const post = adaptStatus(fixture<Status>("akkoma", "status.json"));
    expect(post.reactions?.total).toBe(3);
    expect(post.reactions?.entries.map((e) => e.key)).toEqual(["🎉", "🤔"]);
    expect(post.reactions?.entries[0].mine).toBe(true);
    expect(post.reactions?.mine).toBe("🎉");
    expect(post.reactions?.myReactions).toEqual(["🎉"]);
    expect(post.reactions?.urls.think).toBeUndefined();
    expect(post.reactions?.urls["🤔"]).toBe("https://akkoma.example/emoji/thinking.png");
    expect(post.counts.reactions).toBe(3);
  });

  it("Akkoma ALSO carries favourites as their own state", () => {
    const post = adaptStatus(fixture<Status>("akkoma", "status.json"));
    expect(post.favourite).toEqual({ count: 1, mine: false });
    expect(post.counts.favourites).toBe(1);
  });

  it("no emoji_reactions field means reactions null (vanilla Mastodon)", () => {
    const raw = fixture<Status>("mastodon", "status.json");
    const post = adaptStatus({ ...raw, emoji_reactions: undefined });
    expect(post.reactions).toBeNull();
  });

  it("an empty emoji_reactions array is an empty summary, not null", () => {
    const raw = fixture<Status>("mastodon", "status.json");
    const post = adaptStatus({ ...raw, emoji_reactions: [] });
    expect(post.reactions).not.toBeNull();
    expect(post.reactions?.entries).toEqual([]);
    expect(post.reactions?.mine).toBeNull();
  });
});

describe("adaptAccount / adaptCredentialAccount", () => {
  it("maps identity, raw name + fallback displayName, host", () => {
    const account = adaptAccount(fixture<WireAccount>("mastodon", "account.json"));
    expect(account.id).toBe("1");
    expect(account.username).toBe("gargron");
    expect(account.acct).toBe("gargron");
    expect(account.host).toBeNull();
    expect(account.name).toBe("Eugen");
    expect(account.displayName).toBe("Eugen");
  });

  it("a remote acct carries the host and an empty display name falls back", () => {
    const raw = fixture<Status>("mastodon", "status-reblog.json").reblog as Status;
    const account = adaptAccount(raw.account);
    expect(account.acct).toBe("bob@remote.example");
    expect(account.host).toBe("remote.example");
    expect(account.name).toBe("");
    expect(account.displayName).toBe("bob");
  });

  it("maps bio as html Content, fields, emojis, moved and flags", () => {
    const account = adaptAccount(fixture<WireAccount>("mastodon", "account.json"));
    expect(account.bio.html).toContain("Developer of");
    expect(account.bio.mfm).toBeUndefined();
    expect(account.bio.plain).toBe("Developer of @Mastodon");
    expect(account.fields[0]).toEqual({
      name: "Pronouns",
      value: "they/them",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(account.emojis.keystone).toContain("custom_emojis/keystone.png");
    expect(account.avatarUrl).toContain("static/1.png"); // static preferred
    expect(account.headerUrl).toContain("static/1.png");
    expect(account.movedTo).toBeNull();
    expect(account.suspended).toBe(false);
    expect(account.silenced).toBe(false);
    // Absent from the wire → never faked.
    expect(account.ffVisibility).toBeNull();
    expect(account.pinnedPostIds).toBeNull();
    expect(account.pinnedPosts).toBeNull();
    expect(account.onlineStatus).toBeNull();
  });

  it("Akkoma account extras stay out of the neutral fields", () => {
    const raw = fixture<Status>("akkoma", "status.json").account as WireAccount;
    const account = adaptAccount(raw);
    expect(account.name).toBe("");
    expect(account.displayName).toBe("akk1");
    expect(account.cat).toBe(false);
    // pleroma.* is not carried into the neutral model (it rides only on
    // the self-verify bag below).
    expect(JSON.stringify(account.ext)).not.toContain("is_admin");
  });

  it("adaptCredentialAccount keeps self-only extras in ext.mastodon", () => {
    const me = fixture<CredentialAccount>("mastodon", "account.json");
    const account = adaptCredentialAccount(me);
    const bag = account.ext.mastodon as Record<string, unknown>;
    expect(bag.state).toBe("active");
    expect((bag.source as Record<string, unknown>).privacy).toBe("unlisted");
    expect(bag.role).toBeNull();
  });
});

describe("adaptMedia / adaptPoll", () => {
  it("maps only the documented type enum — unknown reads unknown", () => {
    const base = fixture<Status>("mastodon", "status.json").media_attachments[0];
    expect(adaptMedia(base, false).kind).toBe("image");
    expect(adaptMedia({ ...base, type: "gifv" }, false).kind).toBe("gifv");
    expect(adaptMedia({ ...base, type: "audio" }, false).kind).toBe("audio");
    expect(adaptMedia({ ...base, type: "weird-new-type" }, false).kind).toBe("unknown");
  });

  it("Akkoma's pleroma.mime_type is the only MIME source", () => {
    const raw = fixture<Status>("akkoma", "status.json")
      .media_attachments[0] as MediaAttachment;
    expect(adaptMedia(raw, false).mimeType).toBe("image/png");
  });

  it("keeps votersCount null where the server sends none (Akkoma single-choice)", () => {
    const wire: WirePoll = {
      id: "1",
      expires_at: null,
      expired: true,
      multiple: false,
      votes_count: 5,
      voters_count: null,
      options: [{ title: "a", votes_count: 5 }],
    };
    const poll = adaptPoll(wire);
    expect(poll.votersCount).toBeNull();
    expect(poll.votesCount).toBe(5);
    expect(poll.expired).toBe(true);
    expect(poll.options[0].voted).toBe(false);
  });
});

describe("adaptRelationship (absent flags stay unknown)", () => {
  it("maps the documented flag set", () => {
    const rel = adaptRelationship(fixture<WireRelationship>("mastodon", "relationship.json"));
    expect(rel.isFollowing).toBe(true);
    expect(rel.isFollowed).toBe(true);
    expect(rel.isBlocking).toBe(false);
    expect(rel.isMuted).toBe(false);
    expect(rel.hasPendingFollowRequestFromYou).toBe(false);
    expect(rel.hasPendingFollowRequestToYou).toBe(true);
    expect(rel.isRenoteMuted).toBe(false);
  });

  it("requested_by absent stays absent (unknown, never false)", () => {
    const raw = fixture<WireRelationship>("mastodon", "relationship.json");
    const rel = adaptRelationship({ ...raw, requested_by: undefined });
    expect(rel.hasPendingFollowRequestToYou).toBeUndefined();
    expect(rel.hasPendingFollowRequestFromYou).toBe(false);
  });

  it("a boost mute only exists while following", () => {
    const raw = fixture<WireRelationship>("mastodon", "relationship.json");
    expect(adaptRelationship({ ...raw, following: true, showing_reblogs: false }).isRenoteMuted).toBe(true);
    expect(adaptRelationship({ ...raw, following: false, showing_reblogs: false }).isRenoteMuted).toBe(false);
  });
});

describe("adaptNotification (flat rows, extensible types)", () => {
  it("maps a favourite row — kind favourite, NEVER reaction", () => {
    const n = adaptNotification(fixture<WireNotification>("mastodon", "notification.json"));
    expect(n.kind).toBe("favourite");
    expect(n.rawType).toBe("favourite");
    expect(n.reaction).toBeNull();
    expect(n.actors).toHaveLength(1);
    expect(n.actors[0].account?.acct).toBe("alice");
    expect(n.actors[0].reaction).toBeNull();
    expect(n.post?.id).toBe("113959271829458642");
    // No is_seen on vanilla Mastodon → read unknown, never faked.
    expect(n.read).toBeNull();
  });

  it("maps the known type set", () => {
    const raw = fixture<WireNotification>("mastodon", "notification.json");
    const kindOf = (type: string) => adaptNotification({ ...raw, type }).kind;
    expect(kindOf("mention")).toBe("mention");
    expect(kindOf("follow")).toBe("follow");
    expect(kindOf("follow_request")).toBe("receiveFollowRequest");
    expect(kindOf("reblog")).toBe("renote");
    expect(kindOf("quote")).toBe("quote");
    expect(kindOf("poll")).toBe("pollEnded");
  });

  it("unknown types map to kind unknown with rawType kept (generic row)", () => {
    const raw = fixture<WireNotification>("mastodon", "notification.json");
    const n = adaptNotification({ ...raw, type: "severed_relationships" });
    expect(n.kind).toBe("unknown");
    expect(n.rawType).toBe("severed_relationships");
  });

  it("Akkoma emoji reactions map to kind reaction with the emoji", () => {
    const n = adaptNotification(fixture<WireNotification>("akkoma", "notification.json"));
    expect(n.kind).toBe("reaction");
    expect(n.rawType).toBe("pleroma:emoji_reaction");
    expect(n.reaction).toBe("🎉");
    expect(n.actors[0].reaction).toBe("🎉");
    expect(n.read).toBe(true); // pleroma.is_seen packed
  });

  it("a row without a packed account carries NO actor (never id-only)", () => {
    const raw = fixture<WireNotification>("mastodon", "notification.json");
    const n = adaptNotification({ ...raw, account: null });
    expect(n.actors).toEqual([]);
    expect(n.post?.id).toBe("113959271829458642");
  });
});

describe("cursors and pages (Link continuations behind the opaque Cursor)", () => {
  const cont = {
    kind: "cursors",
    cursors: { max_id: "113959271829458642", limit: 20 },
  } as const;

  it("round-trips a continuation opaquely", () => {
    const cursor = encodeContinuation(cont);
    expect(cursor).not.toBeNull();
    expect(decodeContinuation(cursor)).toEqual(cont);
    expect(decodeContinuation(null)).toBeNull();
    expect(decodeContinuation("not json" as never)).toBeNull();
    expect(encodeContinuation(null)).toBeNull();
  });

  it("pageOf ends on a missing next link or an empty page — never length<limit", () => {
    const status = fixture<Status>("mastodon", "status.json");
    const done = pageOf([status], null, adaptStatus);
    expect(done.end).toBe(true); // no next link
    expect(done.cursor).toBeNull();
    const empty = pageOf([], cont, adaptStatus);
    expect(empty.end).toBe(true); // empty page
    // One item with a next link is NOT the end, whatever the limit.
    const more = pageOf([status], cont, adaptStatus);
    expect(more.end).toBe(false);
    expect(decodeContinuation(more.cursor)).toEqual(cont);
    expect(more.items[0].id).toBe(status.id);
  });
});

describe("html → plain text", () => {
  it("keeps emoji alt text, drops tags, decodes entities once", () => {
    expect(htmlToPlainText("<p>a &amp; b<br>c</p>")).toBe("a & b\nc");
    expect(htmlToPlainText('<p><img alt=":keystone:"></p>')).toBe(":keystone:");
  });

  it("htmlContentOf omits the source when the body is empty", () => {
    expect(htmlContentOf("").html).toBeUndefined();
    expect(htmlContentOf("<p>x</p>").html).toBe("<p>x</p>");
  });
});
