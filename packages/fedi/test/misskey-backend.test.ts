// MisskeyBackend tests: every method must make exactly the requests the
// UI makes today (endpoints + params) and adapt the response to core
// models. The transport is stubbed — no network, no backends.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { ApiError } from "../src/core/errors";
import type { Note, NotificationItem, GroupedNotificationItem, DriveFile, MeDetailed, UserDetailed } from "../src/misskey/wire";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "misskey", name), "utf8"),
  ) as T;
}

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      call<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint, params });
        return Promise.resolve(respond(endpoint, params) as T);
      },
      upload<T>(_file: File, opts: Record<string, unknown> = {}): Promise<T> {
        calls.push({ endpoint: "drive/files/create", params: { ...opts } });
        return Promise.resolve(fixture<DriveFile>("drive-file.json") as T);
      },
    },
  };
}

const note = fixture<Note>("note.json");

describe("MisskeyBackend feeds", () => {
  it("maps timeline kinds to the three feed endpoints with cross-backend params", async () => {
    const { transport, calls } = stubTransport(() => [note]);
    const backend = createMisskeyBackend(transport);
    for (const [kind, endpoint] of [
      ["home", "notes/timeline"],
      ["local", "notes/local-timeline"],
      ["global", "notes/global-timeline"],
    ] as const) {
      await backend.timeline(kind);
      expect(calls[calls.length - 1]).toEqual({
        endpoint,
        params: { limit: 20 },
      });
    }
    // A cursor decodes to untilId; never any include*Renotes.
    await backend.timeline("home", { cursor: JSON.stringify({ untilId: "abc" }) as never });
    expect(calls[calls.length - 1].params).toEqual({ limit: 20, untilId: "abc" });
  });

  it("adapts the page: end on a short page, cursor from the last id", async () => {
    const { transport } = stubTransport(() => [note]);
    const backend = createMisskeyBackend(transport);
    const page = await backend.timeline("home", { limit: 5 });
    expect(page.items[0].id).toBe(note.id);
    expect(page.items[0].content.mfm).toBe(note.text);
    expect(page.end).toBe(true); // 1 < 5
    expect(page.cursor).not.toBeNull();
    const full = await createMisskeyBackend(
      stubTransport(() => [note, note]).transport,
    ).timeline("home", { limit: 1 });
    expect(full.end).toBe(false);
  });

  it("posts and threads adapt", async () => {
    const { transport, calls } = stubTransport((endpoint) => {
      if (endpoint === "notes/show") return note;
      return [];
    });
    const backend = createMisskeyBackend(transport);
    expect((await backend.post("9fz3examplenote0001")).id).toBe(note.id);
    expect(calls[0]).toEqual({
      endpoint: "notes/show",
      params: { noteId: "9fz3examplenote0001" },
    });

    // A root post: the walk runs and orders to empty.
    const root = { ...(await backend.post("x")), replyToId: null, reply: null };
    const res = await backend.thread(root);
    expect(res.ancestors).toEqual([]);
    expect(res.incomplete).toBe(false);
  });

  it("thread falls back to the packed parent when conversation 404s", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("no such endpoint", 404);
    });
    const backend = createMisskeyBackend(transport);
    const parent = fixture<NotificationItem>("notification.json").note as Note;
    const post = {
      ...(await createMisskeyBackend(stubTransport(() => note).transport).post("x")),
      replyToId: "parent",
      reply: null,
    };
    // No packed parent -> empty ancestors, incomplete (parent exists).
    const res = await backend.thread(post);
    expect(res.ancestors).toEqual([]);
    expect(res.incomplete).toBe(true);
    // Packed parent -> one ancestor, complete.
    const withParent = {
      ...post,
      reply: {
        ...(await createMisskeyBackend(stubTransport(() => note).transport).post("x")),
        id: (parent as { id: string }).id,
        replyToId: null,
      },
    };
    const res2 = await backend.thread(withParent);
    expect(res2.ancestors).toHaveLength(1);
    expect(res2.incomplete).toBe(false);
  });

  it("threadReplies pages notes/replies with the cursor rule", async () => {
    const { transport, calls } = stubTransport(() => [note]);
    await createMisskeyBackend(transport).threadReplies("root", {
      cursor: JSON.stringify({ untilId: "n1" }) as never,
    });
    expect(calls[0]).toEqual({
      endpoint: "notes/replies",
      params: { noteId: "root", limit: 20, untilId: "n1" },
    });
  });
});

describe("MisskeyBackend compose", () => {
  it("builds the notes/create body exactly as the Composer did", async () => {
    const { transport, calls } = stubTransport(() => ({ createdNote: note }));
    const backend = createMisskeyBackend(transport);
    await backend.createPost({
      text: "  hello  ",
      cw: "  warn  ",
      visibility: { kind: "followers", localOnly: true, raw: "home" },
      visibleUserIds: ["u1"],
      replyId: "r1",
      renoteId: "n1",
      mediaIds: ["f1"],
      reactionAcceptance: "likeOnly",
      noQuote: true,
      poll: { choices: ["a", "b"], multiple: true, expiredAfter: 60 },
    });
    expect(calls[0]).toEqual({
      endpoint: "notes/create",
      params: {
        // `raw` round-trips: a home post is written back as home.
        visibility: "home",
        text: "hello",
        cw: "warn",
        localOnly: true,
        replyId: "r1",
        renoteId: "n1",
        fileIds: ["f1"],
        reactionAcceptance: "likeOnly",
        noQuote: true,
        poll: { choices: ["a", "b"], multiple: true, expiredAfter: 60 },
      },
    });
  });

  it("maps kinds to wire values on fresh compose and omits empty fields", async () => {
    const { transport, calls } = stubTransport(() => ({ createdNote: note }));
    await createMisskeyBackend(transport).createPost({
      visibility: { kind: "quiet", localOnly: false },
    });
    expect(calls[0].params.visibility).toBe("home");
    await createMisskeyBackend(transport).createPost({
      text: "  ",
      visibility: { kind: "direct", localOnly: false },
      visibleUserIds: ["u1"],
    });
    expect(calls[1].params).toEqual({ visibility: "specified", visibleUserIds: ["u1"] });
  });

  it("editPost sends noQuote + the create-shaped poll", async () => {
    const { transport, calls } = stubTransport(() => note);
    const backend = createMisskeyBackend(transport);
    await backend.editPost("n1", {
      text: "hi",
      visibility: { kind: "public", localOnly: false, raw: "public" },
      noQuote: false,
      poll: { choices: ["a", "b"], multiple: false, expiresAt: 1900000000000 },
    });
    expect(calls[0]).toEqual({
      endpoint: "notes/edit",
      params: {
        noteId: "n1",
        text: "hi",
        cw: null,
        visibility: "public",
        noQuote: false,
        poll: { choices: ["a", "b"], multiple: false, expiresAt: 1900000000000 },
      },
    });
  });

  it("editPost surfaces a poll-edit rejection instead of dropping the field", async () => {
    const { transport, calls } = stubTransport(() => {
      throw new ApiError("cannot edit poll", 400, "INVALID_PARAM");
    });
    await expect(
      createMisskeyBackend(transport).editPost("n1", {
        text: "hi",
        visibility: { kind: "public", localOnly: false },
        poll: { choices: ["a", "b"] },
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_PARAM" });
    expect(calls[0].params.poll).toEqual({ choices: ["a", "b"] });
  });

  it("boost is notes/create {renoteId}; unboost is notes/unrenote", async () => {
    const { transport, calls } = stubTransport(() => ({ createdNote: note }));
    const backend = createMisskeyBackend(transport);
    await backend.boost("x");
    await backend.unboost("x");
    expect(calls.map((c) => c.endpoint)).toEqual(["notes/create", "notes/unrenote"]);
    expect(calls[0].params).toEqual({ renoteId: "x" });
    expect(calls[1].params).toEqual({ noteId: "x" });
  });

  it("react(null) clears, react(key) creates, delete/edit mirror the wire", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    await backend.react("x", "❤");
    await backend.react("x", null);
    await backend.unreact("x");
    await backend.deletePost("x");
    expect(calls.map((c) => [c.endpoint, c.params])).toEqual([
      ["notes/reactions/create", { noteId: "x", reaction: "❤" }],
      ["notes/reactions/delete", { noteId: "x" }],
      ["notes/reactions/delete", { noteId: "x" }],
      ["notes/delete", { noteId: "x" }],
    ]);
  });

  it("votePoll sends one vote per choice", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    await createMisskeyBackend(transport).votePoll("x", [0, 2]);
    expect(calls.map((c) => c.params)).toEqual([
      { noteId: "x", choice: 0 },
      { noteId: "x", choice: 2 },
    ]);
  });
});

describe("MisskeyBackend accounts and social", () => {
  it("account resolves by id or username+host", async () => {
    const { transport, calls } = stubTransport(() => fixture<MeDetailed>("user.json"));
    const backend = createMisskeyBackend(transport);
    await backend.account({ id: "u1" });
    await backend.account({ username: "ann", host: "ex.ample" });
    expect(calls[0].params).toEqual({ userId: "u1" });
    expect(calls[1].params).toEqual({ username: "ann", host: "ex.ample" });
  });

  it("accountPosts sends only the enabled tab filters", async () => {
    const { transport, calls } = stubTransport(() => [note]);
    await createMisskeyBackend(transport).accountPosts("u1", {
      withFiles: true,
      cursor: JSON.stringify({ untilId: "n9" }) as never,
    });
    expect(calls[0]).toEqual({
      endpoint: "users/notes",
      params: { userId: "u1", limit: 20, withFiles: true, untilId: "n9" },
    });
  });

  it("follow/unfollow return nothing (the wire returns a UserLite)", async () => {
    const { transport, calls } = stubTransport(() => ({ id: "u" }));
    const backend = createMisskeyBackend(transport);
    expect(await backend.follow("u1")).toBeUndefined();
    expect(await backend.unfollow("u1")).toBeUndefined();
    expect(calls.map((c) => c.endpoint)).toEqual(["following/create", "following/delete"]);
  });

  it("updateProfile maps bio -> description and passes ext verbatim", async () => {
    const { transport, calls } = stubTransport(() => fixture<MeDetailed>("user.json"));
    const account = await createMisskeyBackend(transport).updateProfile({
      name: "Ann",
      bio: "hello",
      locked: true,
      ext: { noCrawle: true, mutedWords: [["secret"]] },
    });
    expect(calls[0]).toEqual({
      endpoint: "i/update",
      params: {
        name: "Ann",
        description: "hello",
        isLocked: true,
        noCrawle: true,
        mutedWords: [["secret"]],
      },
    });
    expect(account.username).toBe("ann");
    expect(account.ext.me?.username).toBe("ann");
  });

  it("mute/block families hit their endpoints", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    await backend.mute("u");
    await backend.unmute("u");
    await backend.muteRenotes("u");
    await backend.unmuteRenotes("u");
    await backend.block("u");
    await backend.unblock("u");
    await backend.muteThread("n");
    await backend.reportAccount("u", "spam");
    await backend.pinPost("n");
    await backend.unpinPost("n");
    expect(calls.map((c) => c.endpoint)).toEqual([
      "mute/create",
      "mute/delete",
      "renote-mute/create",
      "renote-mute/delete",
      "blocking/create",
      "blocking/delete",
      "notes/thread-muting/create",
      "users/report-abuse",
      "i/pin",
      "i/unpin",
    ]);
  });

  it("search: posts vs tags vs accounts", async () => {
    const { transport, calls } = stubTransport((endpoint) =>
      endpoint === "users/search" ? [] : [note],
    );
    const backend = createMisskeyBackend(transport);
    await backend.search.posts("hello");
    await backend.search.tags("hello");
    await backend.search.accounts("ann", { limit: 20 });
    expect(calls.map((c) => c.endpoint)).toEqual([
      "notes/search",
      "notes/search-by-tag",
      "users/search",
    ]);
    expect(calls[0].params).toEqual({ query: "hello", limit: 20 });
    expect(calls[1].params).toEqual({ tag: "hello", limit: 20 });
    expect(calls[2].params).toEqual({ query: "ann", limit: 20 });
  });

  it("followRequests adapt both sides; accept/reject/cancel pass the id", async () => {
    const { transport, calls } = stubTransport(() => [
      {
        id: "fr1",
        follower: fixture<NotificationItem>("notification.json").user,
        followee: fixture<Note>("note.json").user,
      },
    ]);
    const backend = createMisskeyBackend(transport);
    const reqs = await backend.followRequests();
    expect(reqs[0].follower.username).toBe("bob");
    await backend.acceptFollowRequest("fr1");
    await backend.rejectFollowRequest("fr1");
    await backend.cancelFollowRequest("fr1");
    expect(calls.slice(1).map((c) => c.params)).toEqual([
      { userId: "fr1" },
      { userId: "fr1" },
      { userId: "fr1" },
    ]);
  });
});

describe("MisskeyBackend notifications, drive, emojis, translate", () => {
  it("flat and grouped notifications adapt and page", async () => {
    const { transport, calls } = stubTransport((endpoint) =>
      endpoint === "i/notifications-grouped"
        ? [fixture<GroupedNotificationItem>("notification-grouped.json")]
        : [fixture<NotificationItem>("notification.json")],
    );
    const backend = createMisskeyBackend(transport);
    const flat = await backend.notifications({ includeTypes: ["reaction"] });
    expect(flat.items[0].kind).toBe("reaction");
    expect(calls[0].params).toEqual({ limit: 20, includeTypes: ["reaction"] });
    const grouped = await backend.notifications({ grouped: true });
    expect(grouped.items[0].actors).toHaveLength(3);
    await backend.markNotificationsRead();
    expect(calls[2].endpoint).toBe("notifications/mark-all-as-read");
  });

  it("drive files page with the server-side type filter", async () => {
    const { transport, calls } = stubTransport(() => [fixture<DriveFile>("drive-file.json")]);
    const backend = createMisskeyBackend(transport);
    const page = await backend.drive!.files({ type: "image/*", limit: 10 });
    expect(calls[0]).toEqual({
      endpoint: "drive/files",
      params: { limit: 10, type: "image/*" },
    });
    expect(page.items[0].kind).toBe("image");
    await backend.drive!.deleteFile("f1");
    expect(calls[1]).toEqual({ endpoint: "drive/files/delete", params: { fileId: "f1" } });
  });

  it("drive folders list/create/update/delete hit drive/folders/*", async () => {
    const folder = { id: "d1", createdAt: "2026-10-15T11:59:00.000Z", name: "Uploads", parentId: null };
    const { transport, calls } = stubTransport((endpoint, params) => {
      if (endpoint === "drive/folders") return [folder];
      if (endpoint === "drive/folders/create")
        return { ...folder, id: "d2", name: params.name, parentId: params.parentId ?? null };
      if (endpoint === "drive/folders/update") return { ...folder, name: params.name };
      return folder;
    });
    const backend = createMisskeyBackend(transport);
    // The real backend exposes folders: the Drive folder section renders.
    expect(backend.drive!.folders).toBeDefined();
    const listed = await backend.drive!.folders!.list();
    expect(calls[0]).toEqual({ endpoint: "drive/folders", params: {} });
    expect(listed).toEqual([{ id: "d1", name: "Uploads", parentId: null }]);
    const created = await backend.drive!.folders!.create("Memes");
    expect(calls[1]).toEqual({ endpoint: "drive/folders/create", params: { name: "Memes" } });
    expect(created).toEqual({ id: "d2", name: "Memes", parentId: null });
    await backend.drive!.folders!.create("Nested", { parentId: "d1" });
    expect(calls[2]).toEqual({
      endpoint: "drive/folders/create",
      params: { name: "Nested", parentId: "d1" },
    });
    const updated = await backend.drive!.folders!.update("d1", { name: "Renamed" });
    expect(calls[3]).toEqual({
      endpoint: "drive/folders/update",
      params: { folderId: "d1", name: "Renamed" },
    });
    expect(updated.name).toBe("Renamed");
    await backend.drive!.folders!.delete("d1");
    expect(calls[4]).toEqual({ endpoint: "drive/folders/delete", params: { folderId: "d1" } });
  });

  it("customEmojis validates entries exactly as the loader did", async () => {
    const { transport } = stubTransport(() => ({
      emojis: [
        { name: "blob", url: "https://x/blob.png", category: "faces" },
        { name: "", url: "https://x/bad.png" },
        { name: "nourl" },
        { name: "remote", url: "https://y/r.png" },
      ],
    }));
    const list = await createMisskeyBackend(transport).customEmojis();
    expect(list.map((e) => e.name)).toEqual(["blob", "remote"]);
  });

  it("translate sends noteId + targetLang and normalizes the result", async () => {
    const { transport, calls } = stubTransport(() => ({ sourceLang: "de", text: "hi" }));
    const res = await createMisskeyBackend(transport).translate("n1", "en");
    expect(calls[0]).toEqual({
      endpoint: "notes/translate",
      params: { noteId: "n1", targetLang: "en" },
    });
    expect(res).toEqual({ sourceLang: "de", text: "hi" });
    const empty = await createMisskeyBackend(
      stubTransport(() => ({})).transport,
    ).translate("n1", "en");
    expect(empty).toEqual({ sourceLang: null, text: "" });
  });

  it("uploadMedia adapts the DriveFile response and carries the folder target", async () => {
    const { transport, calls } = stubTransport(() => null);
    const backend = createMisskeyBackend(transport);
    const media = await backend.uploadMedia(new File(["x"], "x.png"));
    expect(media.name).toBe("diagram.png");
    expect(media.kind).toBe("image");
    // Root default: neither Drive field is invented.
    expect(calls[0].params).toEqual({});

    await backend.uploadMedia(new File(["x"], "x.png"), { folderId: "folder-1", force: true });
    expect(calls[1].params).toEqual({ folderId: "folder-1", force: true });

    // A null folder is root: omitted, never an empty wire field.
    await backend.uploadMedia(new File(["x"], "x.png"), { folderId: null });
    expect(calls[2].params).toEqual({});
  });
});

describe("MisskeyBackend explore", () => {
  const user = fixture<UserDetailed>("user.json");

  it("users() combines pinned-users with popular-local users, deduped", async () => {
    const { transport, calls } = stubTransport((endpoint) => {
      if (endpoint === "pinned-users") return [user];
      if (endpoint === "users") return [user];
      throw new Error(`unexpected ${endpoint}`);
    });
    const res = await createMisskeyBackend(transport).explore!.users();
    expect(calls.map((c) => c.endpoint).sort()).toEqual(["pinned-users", "users"]);
    expect(calls.find((c) => c.endpoint === "users")).toEqual({
      endpoint: "users",
      params: { state: "alive", origin: "local", sort: "+follower", limit: 10 },
    });
    expect(res.pinned.map((u) => u.id)).toEqual([user.id]);
    // Same user pinned and popular: suggested exactly once.
    expect(res.suggested.map((u) => u.id)).toEqual([user.id]);
  });

  it("tags() reads hashtags/trend user counts", async () => {
    const { transport, calls } = stubTransport(() => [
      { tag: "cats", chart: [3, 5], usersCount: 8 },
      { tag: "", chart: [], usersCount: 0 },
    ]);
    const res = await createMisskeyBackend(transport).explore!.tags();
    expect(calls[0].endpoint).toBe("hashtags/trend");
    expect(res).toEqual([{ name: "cats", users: 8, uses: null }]);
  });

  it("posts() reads notes/featured with untilId paging", async () => {
    const { transport, calls } = stubTransport(() => [note]);
    const backend = createMisskeyBackend(transport);
    const page = await backend.explore!.posts({ limit: 5 });
    expect(calls[0]).toEqual({ endpoint: "notes/featured", params: { limit: 5 } });
    expect(page.items[0].id).toBe(note.id);
  });

  it("suggestTags() reads hashtags/search names", async () => {
    const { transport, calls } = stubTransport(() => ["cats", "caturday", 42]);
    const res = await createMisskeyBackend(transport).search.suggestTags!("cat");
    expect(calls[0]).toEqual({ endpoint: "hashtags/search", params: { query: "cat", limit: 8 } });
    expect(res).toEqual(["cats", "caturday"]);
  });

  it("suggestAccounts() reads users/search like accounts", async () => {
    const { transport, calls } = stubTransport(() => [user]);
    const res = await createMisskeyBackend(transport).search.suggestAccounts!("ann");
    expect(calls[0]).toEqual({ endpoint: "users/search", params: { query: "ann", limit: 8 } });
    expect(res.items[0].id).toBe(user.id);
  });
});
