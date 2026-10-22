// Misskey notification-type completion (clickstone §1.11, extended by
// P6.2 §2.2 for the chat invitation). The wire vocabulary is
// `misskey-js/src/consts.ts` `notificationTypes` (22 entries); 1.11 mapped
// the schedulable/system rows, and 2.2 maps `chatRoomInvitationReceived`
// to its own kind with the room id in `ext` now that chat ships.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MISSKEY_NOTIFICATION_KINDS,
  adaptGroupedNotification,
  adaptNotification,
  misskeyNotificationTypes,
} from "../src/misskey/adapt";
import type { GroupedNotificationItem, NotificationItem } from "../src/misskey/wire";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", name), "utf8"),
  ) as T;
}

const base = fixture<NotificationItem>("notification.json");

/** A system row: Misskey packs no `user`/`note` for these types. */
function systemRow(over: Partial<NotificationItem>): NotificationItem {
  return { ...base, user: null, note: null, reaction: null, ...over };
}

describe("Misskey notification kinds (clickstone §1.11)", () => {
  it("maps every required system type instead of falling into unknown", () => {
    const cases: Array<[string, string]> = [
      ["scheduledNotePosted", "scheduledNotePosted"],
      ["scheduledNotePostFailed", "scheduledNotePostFailed"],
      // Some forks drop the "Post" (the slice brief's spelling).
      ["scheduledNoteFailed", "scheduledNotePostFailed"],
      ["exportCompleted", "exportCompleted"],
      ["roleAssigned", "roleAssigned"],
      ["login", "login"],
      ["createToken", "createToken"],
      ["test", "test"],
      // Upstream spells the achievement wire type with the suffix; the old
      // table matched a bare "achievement" that Misskey never sends.
      ["achievementEarned", "achievement"],
    ];
    for (const [wire, kind] of cases) {
      const n = adaptNotification(systemRow({ type: wire }));
      expect([wire, n.kind, n.rawType]).toEqual([wire, kind, wire]);
    }
  });

  it("maps the followed-account note type (Misskey `note`)", () => {
    const n = adaptNotification({ ...base, type: "note" });
    expect(n.kind).toBe("note");
    expect(n.rawType).toBe("note");
    // The row carries the note and its author; no kind is guessed.
    expect(n.post?.id).toBe(base.note?.id);
    expect(n.actors[0].id).toBe(base.user?.id);
  });

  it("maps the chat-room invitation to its kind with the room id (2.2)", () => {
    const n = adaptNotification(
      systemRow({
        type: "chatRoomInvitationReceived",
        userId: undefined,
        invitation: { room: { id: "room1", name: "Lounge" } },
      }),
    );
    expect(n.kind).toBe("chatRoomInvitation");
    expect(n.rawType).toBe("chatRoomInvitationReceived");
    expect(n.ext.invitedRoomId).toBe("room1");
    expect(n.ext.invitedRoomName).toBe("Lounge");
    // No actor is invented for a row the wire left actor-less.
    expect(n.actors).toEqual([]);
  });

  it("labels the invitation honestly when the wire packed no room", () => {
    const n = adaptNotification(systemRow({ type: "chatRoomInvitationReceived" }));
    expect(n.kind).toBe("chatRoomInvitation");
    expect(n.ext.invitedRoomId).toBeUndefined();
  });

  it("keeps a genuinely new wire type unknown (extensible string)", () => {
    expect(adaptNotification(systemRow({ type: "someFutureThing" })).kind).toBe("unknown");
  });

  it("maps the grouped aggregate labels to their flat kinds", () => {
    const grouped = fixture<GroupedNotificationItem>("notification-grouped.json");
    expect(adaptGroupedNotification({ ...grouped, type: "reaction:grouped" }).kind).toBe(
      "reaction",
    );
    expect(adaptGroupedNotification({ ...grouped, type: "renote:grouped" }).kind).toBe(
      "renote",
    );
  });

  it("keeps the wire table consistent (no duplicate wire spelling)", () => {
    const wires = MISSKEY_NOTIFICATION_KINDS.map(([wire]) => wire);
    expect(new Set(wires).size).toBe(wires.length);
    // Every mapped kind is a real core kind, never "unknown".
    for (const [, kind] of MISSKEY_NOTIFICATION_KINDS) {
      expect(kind).not.toBe("unknown");
    }
  });
});

describe("Misskey system-row ext detail (never invented)", () => {
  it("keeps the role name the server packed", () => {
    const n = adaptNotification(
      systemRow({ type: "roleAssigned", role: { id: "r1", name: "Moderator", iconUrl: null } }),
    );
    expect(n.ext.roleName).toBe("Moderator");
  });

  it("leaves roleName absent when the wire packed none", () => {
    const n = adaptNotification(systemRow({ type: "roleAssigned", role: { id: "r1" } }));
    expect(n.ext.roleName).toBeUndefined();
  });

  it("keeps the export entity and drive file id", () => {
    const n = adaptNotification(
      systemRow({ type: "exportCompleted", exportedEntity: "note", fileId: "file1" }),
    );
    expect(n.ext.exportedEntity).toBe("note");
    expect(n.ext.exportedFileId).toBe("file1");
  });

  it("keeps the achievement token verbatim", () => {
    const n = adaptNotification(systemRow({ type: "achievementEarned", achievement: "notes1" }));
    expect(n.ext.achievement).toBe("notes1");
  });

  it("keeps the draft id of a failed scheduled note (no post exists)", () => {
    const n = adaptNotification(
      systemRow({ type: "scheduledNotePostFailed", noteDraft: { id: "draft1" } }),
    );
    expect(n.ext.failedDraftId).toBe("draft1");
    expect(n.post).toBeNull();
  });

  it("carries no ext detail for types the wire packs none for", () => {
    const n = adaptNotification(systemRow({ type: "login" }));
    expect(n.ext).toEqual({});
  });
});

describe("core preset kinds -> Misskey wire types", () => {
  it("translates the one kind whose wire spelling differs", () => {
    expect(misskeyNotificationTypes(["achievement", "reaction"])).toEqual([
      "achievementEarned",
      "reaction",
    ]);
  });

  it("passes unknown tokens through verbatim (fork/future types stay filterable)", () => {
    expect(misskeyNotificationTypes(["groupInvited"])).toEqual(["groupInvited"]);
  });

  it("omits the param entirely when nothing was asked for", () => {
    expect(misskeyNotificationTypes(undefined)).toEqual([]);
    expect(misskeyNotificationTypes([])).toEqual([]);
  });
});
