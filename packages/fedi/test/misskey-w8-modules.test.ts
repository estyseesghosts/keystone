// W8 MK12 — direct/indirect coverage for the ported Misskey modules that
// had no tests (auth, external, customEmoji, favorites, featured,
// likeEmoji, listMembership, mutes, followRequests, renoteMutes, noteEdit,
// remotepost, schedule, serverDrafts, softMute, clips, plus the backend's
// antennas/drive/reactions/pin/mute-thread/report paths), and the MK10
// manifest-provenance check. (WS-E removed the `misskey/drafts` +
// `reactionActions`/`myReactions` blocks with their modules — authority is
// the app store / post-shadow — and added the MK13 `like` capability facts
// + seeding tests in `detect.test.ts` / `misskey-like.test.ts`. P6.0 moved
// importExport to `misskey-import-export.test.ts` for the upstream shapes.)
//
// New file on purpose: existing per-file test counts stay untouched
// (register rule — ported tests match original per-file counts).
// Transports are stubbed — no network, no rig. Pure-TS: no react,
// no window/document (global fetch is stubbed per test and restored).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ApiError, FediError } from "../src/core/errors";
import { createMemoryStore, type KeyValueStore } from "../src/core/sessions";
import type { Account } from "../src/core/models";
import type { WireCall } from "../src/misskey/client";
import {
  KEYSTONE_APP_NAME,
  KEYSTONE_PERMISSIONS,
  fetchSessionMe,
  mintAppToken,
  signinFlow,
  signinNative,
  verifyAppToken,
} from "../src/misskey/auth";
import {
  buildMiauthUrl,
  enrichLegacyExternalUsers,
  externalOrigin,
  getActiveExternal,
  loadExternalSessions,
  newExternalSessionId,
  normalizeHost,
  removeExternalSession,
  saveExternalSession,
  setActiveExternalHost,
  updateExternalSessionUser,
  type ExternalSession,
} from "../src/misskey/external";
import { createCustomEmojiStore } from "../src/misskey/customEmoji";
import { listFavorites, removeFavorite } from "../src/misskey/favorites";
import { listFeaturedNotes, listUserFeaturedNotes, pinNote, unpinNote } from "../src/misskey/featured";
import { tryPersistLikeEmoji } from "../src/misskey/likeEmoji";
import { addToList, listsContaining, removeFromList } from "../src/misskey/listMembership";
import {
  blockUser,
  fetchRelation,
  fetchRelations,
  listBlocks,
  listMutes,
  muteUser,
} from "../src/misskey/mutes";
import {
  acceptFollowRequest,
  cancelFollowRequest,
  listFollowRequests,
  rejectFollowRequest,
} from "../src/misskey/followRequests";
import { listRenoteMutes } from "../src/misskey/renoteMutes";
import { editNote, redraftPayload } from "../src/misskey/noteEdit";
import { cachedRemotePostUrl, resolveRemotePostUrl } from "../src/misskey/remotepost";
import {
  createScheduledNote,
  deleteScheduledNote,
  isFutureInstant,
  listScheduledNotes,
  parseScheduledAt,
} from "../src/misskey/schedule";
import {
  countServerDrafts,
  createServerDraft,
  deleteServerDraft,
  listServerDrafts,
  updateServerDraft,
} from "../src/misskey/serverDrafts";
import {
  checkNoteWordMute,
  checkWordMute,
  formatWordFilters,
  isInstanceMuted,
  muteCheckOf,
  parseMutedInstances,
  parseWordFilters,
  WordFilterParseError,
  type MuteCheckNote,
} from "../src/misskey/softMute";
import {
  addNoteToClip,
  createClip,
  deleteClip,
  listClips,
  listClipsContaining,
  removeNoteFromClip,
  updateClip,
} from "../src/misskey/clips";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import type {
  MeDetailed,
  Note,
  UserDetailed,
  UserRelation,
} from "../src/misskey/wire";
import { postFromWire } from "./helpers";

// --- Fixtures + stub transports --------------------------------------------

function fixture<T>(rel: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", rel), "utf8")) as T;
}

const note = (): Note => JSON.parse(JSON.stringify(fixture<Note>("misskey/note.json")));
const user = (): UserDetailed =>
  JSON.parse(JSON.stringify(fixture<UserDetailed>("misskey/user.json")));
const meWire = (): MeDetailed =>
  JSON.parse(JSON.stringify(fixture<UserDetailed>("misskey/user.json"))) as unknown as MeDetailed;

interface RecordedCall {
  endpoint: string;
  params: Record<string, unknown>;
}

function stubCall(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { call: WireCall; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const call = ((endpoint: string, params: Record<string, unknown> = {}) => {
    calls.push({ endpoint, params });
    // Defer through a microtask so a throwing responder rejects (like the
    // real transport) instead of throwing synchronously out of the caller.
    return Promise.resolve().then(() => respond(endpoint, params));
  }) as WireCall;
  return { call, calls };
}

function stubTransport(
  respond: (endpoint: string, params: Record<string, unknown>) => unknown,
): { transport: MisskeyTransport; calls: RecordedCall[] } {
  const { call, calls } = stubCall(respond);
  return {
    calls,
    transport: {
      call,
      upload: (() => Promise.resolve(fixture("misskey/drive-file.json"))) as MisskeyTransport["upload"],
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// --- auth ------------------------------------------------------------------

describe("misskey/auth", () => {
  it("fetchSessionMe / verifyAppToken adapt the i response", async () => {
    const { call, calls } = stubCall(() => meWire());
    const account = await fetchSessionMe(call);
    expect(account.id).toBe(user().id);
    expect(calls).toEqual([{ endpoint: "i", params: {} }]);
    const { call: call2, calls: calls2 } = stubCall(() => meWire());
    await verifyAppToken(call2, "scoped-token");
    expect(calls2).toEqual([{ endpoint: "i", params: { i: "scoped-token" } }]);
  });

  it("signinNative returns the token plus the adapted account", async () => {
    const { call } = stubCall(() => ({ token: "native", user: meWire() }));
    const res = await signinNative(call, "pine", "secret");
    expect(res.token).toBe("native");
    expect(res.account.id).toBe(user().id);
  });

  it("signinFlow passes both shapes through (pending vs finished)", async () => {
    const pending = stubCall(() => ({ finished: false, next: "https://x/miauth/abc" }));
    expect(await signinFlow(pending.call, "u", "p")).toEqual({
      finished: false,
      next: "https://x/miauth/abc",
    });
    const finished = stubCall(() => ({ finished: true, id: "sess", i: "native-i" }));
    expect(await signinFlow(finished.call, "u", "p")).toEqual({
      finished: true,
      id: "sess",
      i: "native-i",
    });
  });

  it("mintAppToken exchanges the native credential for a scoped token", async () => {
    const { call, calls } = stubCall((endpoint) =>
      endpoint === "miauth/gen-token" ? { token: "gen" } : { ok: true, token: "scoped" },
    );
    await expect(mintAppToken(call, "native-i")).resolves.toBe("scoped");
    expect(calls[0].endpoint).toBe("miauth/gen-token");
    expect(calls[0].params).toMatchObject({ i: "native-i", name: KEYSTONE_APP_NAME });
  });

  it("mintAppToken throws a stable code when the server issues nothing", async () => {
    const { call } = stubCall(() => ({ ok: false }));
    const err = await mintAppToken(call, "native-i").catch((e) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.auth.noKeystoneToken");
  });

  it("the permission set covers the write paths the smoke probes", () => {
    for (const scope of ["write:favorites", "read:clips", "write:clips"]) {
      expect(KEYSTONE_PERMISSIONS).toContain(scope);
    }
  });
});

// --- external ---------------------------------------------------------------

describe("misskey/external (pure surface)", () => {
  it("normalizeHost accepts bare hosts, urls, ports; rejects schemes/spaces", () => {
    expect(normalizeHost("example.com")).toEqual({ host: "example.com", scheme: "https" });
    expect(normalizeHost("https://example.com")).toEqual({ host: "example.com", scheme: "https" });
    expect(normalizeHost("http://example.com:3000/path")).toEqual({
      host: "example.com:3000",
      scheme: "http",
    });
    for (const bad of ["", "   ", "ftp://example.com", "exam ple.com"]) {
      expect(() => normalizeHost(bad)).toThrow(FediError);
    }
  });

  it("buildMiauthUrl joins permissions with commas (the instance splits on commas)", () => {
    const url = buildMiauthUrl("https", "example.com", "sess", "https://app/cb");
    expect(url.startsWith("https://example.com/miauth/sess?")).toBe(true);
    expect(url).toContain(`permission=${encodeURIComponent(KEYSTONE_PERMISSIONS.join(","))}`);
    expect(url).toContain("callback=");
  });

  it("externalOrigin + session ids are per-host unique", () => {
    expect(externalOrigin("https", "example.com")).toBe("https://example.com");
    expect(newExternalSessionId()).not.toBe(newExternalSessionId());
  });
});

describe("misskey/external (session store)", () => {
  const account = (id: string): Account =>
    ({ ...(postFromWire().author as Account), id }) as Account;

  function saved(store: KeyValueStore, host: string, id = "u1"): ExternalSession[] {
    return saveExternalSession(
      store,
      { host, scheme: "https", token: "tok", user: account(id) },
      "http://localhost",
    );
  }

  it("one session per host: a second sign-in on the same host replaces the first", () => {
    const store = createMemoryStore();
    saved(store, "a.example", "u1");
    const after = saved(store, "a.example", "u2");
    expect(after).toHaveLength(1);
    expect(after[0].user.id).toBe("u2");
  });

  it("load/active/remove round-trip; stale active resolves to null", () => {
    const store = createMemoryStore();
    saved(store, "a.example", "u1");
    setActiveExternalHost(store, "a.example", "http://localhost");
    expect(getActiveExternal(store, "http://localhost")?.host).toBe("a.example");
    updateExternalSessionUser(store, "a.example", account("u9"), "http://localhost");
    expect(getActiveExternal(store, "http://localhost")?.user.id).toBe("u9");
    removeExternalSession(store, "a.example", "http://localhost");
    expect(loadExternalSessions(store, "http://localhost")).toEqual([]);
    expect(getActiveExternal(store, "http://localhost")).toBeNull();
  });

  it("enrichLegacyExternalUsers fills carried users from the legacy cache", () => {
    const store = createMemoryStore();
    saved(store, "a.example", "u1");
    // Drop the carried user, then present the legacy cache the core
    // migration could not adapt (core never imports an adapter).
    const legacy = [
      { host: "a.example", scheme: "https", token: "tok", user: { ...meWire(), id: "u1" } },
    ];
    store.setItem("keystone_external_sessions", JSON.stringify(legacy));
    const sessions = loadExternalSessions(store, "http://localhost");
    expect(sessions[0].user.id).toBe("u1");
    enrichLegacyExternalUsers(store);
    expect(loadExternalSessions(store, "http://localhost")).toHaveLength(1);
  });
});

// --- customEmoji ------------------------------------------------------------

describe("misskey/customEmoji store", () => {
  it("loads once, validates entries, resolves local reactions", async () => {
    const { call, calls } = stubCall(() => ({
      emojis: [
        { name: "blob", url: "https://x/emoji/blob.webp", category: "c" },
        { name: "", url: "https://x/empty.webp" },
        { name: "noun", url: "" },
      ],
    }));
    const store = createCustomEmojiStore(call);
    store.load();
    store.load(); // in-flight dedupe: one round-trip
    await flush();
    expect(store.state()).toBe("ready");
    expect(calls.filter((c) => c.endpoint === "emojis")).toHaveLength(1);
    expect(store.emojis().map((e) => e.name)).toEqual(["blob"]);
    expect(store.urlFor(":blob:")).toBe("https://x/emoji/blob.webp");
    expect(store.urlFor("blob")).toBeNull(); // bare names never resolve
    expect(store.urlFor(":blob@.:")).toBe("https://x/emoji/blob.webp");
    expect(store.urlFor("👍")).toBeNull();
    expect(store.urlFor(":blob@remote.example:")).toBeNull();
  });

  it("a 404 resolves unavailable (Pinetree has no listing), not error", async () => {
    const { call } = stubCall(() => {
      throw new ApiError("nope", 404);
    });
    const store = createCustomEmojiStore(call);
    store.load();
    await flush();
    expect(store.state()).toBe("unavailable");
    expect(store.emojis()).toEqual([]);
  });

  it("a non-404 failure resolves error with retry", async () => {
    let fail = true;
    const { call } = stubCall(() => {
      if (fail) throw new Error("down");
      return { emojis: [] };
    });
    const store = createCustomEmojiStore(call);
    store.load();
    await flush();
    expect(store.state()).toBe("error");
    fail = false;
    store.retry();
    await flush();
    expect(store.state()).toBe("ready");
  });

  it("non-misskey families never issue the listing call", async () => {
    const { call, calls } = stubCall(() => ({ emojis: [] }));
    const store = createCustomEmojiStore(call, "mastodon");
    store.load();
    await flush();
    expect(store.state()).toBe("unavailable");
    expect(calls).toEqual([]);
  });

  it("remoteUrlFor reads one host listing via fetch; failures are remembered", async () => {
    const realFetch = globalThis.fetch;
    try {
      (globalThis as { fetch: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({ emojis: [{ name: "wave", url: "https://remote/x.png" }] }),
      });
      const { call } = stubCall(() => ({ emojis: [] }));
      const store = createCustomEmojiStore(call);
      expect(store.remoteUrlFor("remote.example", "wave")).toBeNull();
      store.ensureHostEmojis("remote.example");
      await flush();
      expect(store.remoteUrlFor("remote.example", "wave")).toBe("https://remote/x.png");
      expect(store.remoteUrlFor("remote.example", "missing")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// --- favorites / featured ----------------------------------------------------

describe("misskey/favorites + featured", () => {
  it("listFavorites pages by untilId; removeFavorite hits delete", async () => {
    const { call, calls } = stubCall((endpoint, params) =>
      endpoint === "i/favorites" ? [{ id: "f1", note: note() }] : undefined,
    );
    const rows = await listFavorites(call, "cur");
    expect(rows).toHaveLength(1);
    expect(calls[0]).toEqual({ endpoint: "i/favorites", params: { limit: 20, untilId: "cur" } });
    await removeFavorite(call, "n1");
    expect(calls[calls.length - 1]).toEqual({
      endpoint: "notes/favorites/delete",
      params: { noteId: "n1" },
    });
  });

  it("pin/unpin hit i/pin|unpin; featured reads page with untilId", async () => {
    const { call, calls } = stubCall(() => [note()]);
    await pinNote(call, "n1");
    await unpinNote(call, "n1");
    expect(calls[0]).toEqual({ endpoint: "i/pin", params: { noteId: "n1" } });
    expect(calls[1]).toEqual({ endpoint: "i/unpin", params: { noteId: "n1" } });
    await listFeaturedNotes(call, 5, "u1");
    expect(calls[2]).toEqual({ endpoint: "notes/featured", params: { limit: 5, untilId: "u1" } });
    await listUserFeaturedNotes(call, "u9");
    expect(calls[3]).toEqual({
      endpoint: "users/featured-notes",
      params: { userId: "u9", limit: 20 },
    });
  });
});

// --- importExport ------------------------------------------------------------
// Moved to `misskey-import-export.test.ts` when the upstream shapes landed
// (import needs a Drive upload, export only enqueues a job).

// --- likeEmoji / listMembership / mutes / followRequests / renoteMutes -------

describe("misskey/likeEmoji + listMembership", () => {
  it("tryPersistLikeEmoji is true on store, false where the server has no field", async () => {
    const ok = stubCall(() => ({}));
    await expect(tryPersistLikeEmoji(ok.call, "🍞")).resolves.toBe(true);
    expect(ok.calls[0]).toEqual({
      endpoint: "i/update",
      params: { defaultReaction: "🍞" },
    });
    const down = stubCall(() => {
      throw new ApiError("no", 404);
    });
    await expect(tryPersistLikeEmoji(down.call, "🍞")).resolves.toBe(false);
  });

  it("listsContaining filters by membership; add/remove push/pull", async () => {
    const { call, calls } = stubCall(() => [
      { id: "l1", userIds: ["u1", "u2"] },
      { id: "l2", userIds: [] },
      { id: "l3" },
    ]);
    await expect(listsContaining(call, "u2")).resolves.toEqual(["l1"]);
    await addToList(call, "l1", "u3");
    expect(calls[calls.length - 1]).toEqual({
      endpoint: "users/lists/push",
      params: { listId: "l1", userId: "u3" },
    });
    await removeFromList(call, "l1", "u3");
    expect(calls[calls.length - 1]).toEqual({
      endpoint: "users/lists/pull",
      params: { listId: "l1", userId: "u3" },
    });
  });
});

describe("misskey/mutes + followRequests + renoteMutes", () => {
  const relation = (id: string): UserRelation => ({
    id,
    isFollowing: true,
    isFollowed: false,
    isBlocking: false,
    isBlocked: false,
    isMuted: false,
    isRenoteMuted: false,
  });

  it("fetchRelations short-circuits empty input; fetchRelation finds or nulls", async () => {
    const { call, calls } = stubCall(() => [relation("u1")]);
    await expect(fetchRelations(call, [])).resolves.toEqual([]);
    expect(calls).toEqual([]);
    await expect(fetchRelation(call, "u1")).resolves.toMatchObject({ id: "u1" });
    await expect(fetchRelation(call, "missing")).resolves.toBeNull();
  });

  it("block/mute write paths hit their endpoints", async () => {
    const { call, calls } = stubCall(() => undefined);
    await blockUser(call, "u1");
    await muteUser(call, "u1");
    expect(calls.map((c) => c.endpoint)).toEqual(["blocking/create", "mute/create"]);
    await listBlocks(call);
    await listMutes(call);
    expect(calls[2]).toEqual({ endpoint: "blocking/list", params: { limit: 20 } });
    expect(calls[3]).toEqual({ endpoint: "mute/list", params: { limit: 20 } });
  });

  it("followRequests adapt both sides; accept/reject/cancel pass the id", async () => {
    const row = {
      id: "r1",
      follower: user(),
      followee: user(),
    };
    const { call, calls } = stubCall(() => [row]);
    const list = await listFollowRequests(call);
    expect(list).toHaveLength(1);
    await acceptFollowRequest(call, "u1");
    await rejectFollowRequest(call, "u1");
    await cancelFollowRequest(call, "u1");
    expect(calls.slice(1).map((c) => c.endpoint)).toEqual([
      "following/requests/accept",
      "following/requests/reject",
      "following/requests/cancel",
    ]);
  });

  it("listRenoteMutes unwraps the mutee rows", async () => {
    const { call, calls } = stubCall(() => [{ id: "m1", mutee: user() }]);
    const page = await listRenoteMutes(call, 10, "cur");
    expect(page.items[0].id).toBe(user().id);
    expect(calls[0]).toEqual({
      endpoint: "renote-mute/list",
      params: { limit: 10, untilId: "cur" },
    });
  });
});

// --- noteEdit / remotepost ----------------------------------------------------

describe("misskey/noteEdit + remotepost", () => {
  it("editNote sends explicit nulls so the server clears text/cw", async () => {
    const { call, calls } = stubCall(() => note());
    const post = await editNote(call, "n1", { text: null, cw: null, visibility: "public" });
    expect(post.id).toBe(note().id);
    expect(calls[0]).toEqual({
      endpoint: "notes/edit",
      params: { noteId: "n1", text: null, cw: null, visibility: "public" },
    });
  });

  it("editNote carries noQuote and the create-shaped poll", async () => {
    const { call, calls } = stubCall(() => note());
    await editNote(call, "n1", {
      text: "hi",
      visibility: "public",
      noQuote: false,
      poll: { choices: ["a", "b"], multiple: true, expiredAfter: 3600 },
    });
    expect(calls[0]).toEqual({
      endpoint: "notes/edit",
      params: {
        noteId: "n1",
        text: "hi",
        visibility: "public",
        // An explicit false travels (it can lift an earlier refusal).
        noQuote: false,
        poll: { choices: ["a", "b"], multiple: true, expiredAfter: 3600 },
      },
    });
  });

  it("a rejected poll edit propagates the typed error, never dropping the field", async () => {
    const { call, calls } = stubCall(() => {
      throw new ApiError("cannot edit poll", 400, "INVALID_PARAM");
    });
    await expect(
      editNote(call, "n1", { noQuote: true, poll: { choices: ["a", "b"] } }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_PARAM" });
    // The field was sent before the rejection — it is not silently dropped.
    expect(calls[0].params.poll).toEqual({ choices: ["a", "b"] });
    expect(calls[0].params.noQuote).toBe(true);
  });

  it("redraftPayload preserves reply/renote context and media", () => {
    const seed = redraftPayload(postFromWire({ text: "hi", replyId: "r1", fileIds: ["f1"] }));
    expect(seed).toMatchObject({ text: "hi", replyId: "r1", fileIds: ["f1"] });
  });

  it("remotepost: unknown until resolved; trusts only the matching id", async () => {
    const uri = "https://remote.example/notes/w8-unique-1";
    expect(cachedRemotePostUrl(uri)).toBeNull();
    const realFetch = globalThis.fetch;
    try {
      (globalThis as { fetch: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({ id: uri, url: "https://remote.example/@u/1" }),
      });
      await expect(resolveRemotePostUrl(uri)).resolves.toBe("https://remote.example/@u/1");
      expect(cachedRemotePostUrl(uri)).toBe("https://remote.example/@u/1");
      const other = "https://remote.example/notes/w8-unique-2";
      (globalThis as { fetch: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({ id: "https://evil.example/x", url: "https://evil.example/x" }),
      });
      await expect(resolveRemotePostUrl(other)).resolves.toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// --- schedule / serverDrafts ---------------------------------------------------

describe("misskey/schedule + serverDrafts", () => {
  it("parseScheduledAt + isFutureInstant are pure and strict", () => {
    expect(parseScheduledAt("")).toBeNull();
    expect(parseScheduledAt("not-a-date")).toBeNull();
    expect(parseScheduledAt("2030-01-01T00:00:00.000Z")).toBe("2030-01-01T00:00:00.000Z");
    expect(isFutureInstant("2030-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isFutureInstant("2020-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(false);
    expect(isFutureInstant("nope")).toBe(false);
  });

  it("scheduled transport sends the body plus scheduledAt", async () => {
    const wireRow = { id: "s1", scheduledAt: "2030-01-01T00:00:00.000Z", note: note() };
    const { call, calls } = stubCall((endpoint) => (endpoint === "notes/schedule/list" ? [wireRow] : wireRow));
    await createScheduledNote(call, { visibility: "public", scheduledAt: "2030-01-01T00:00:00.000Z" });
    expect(calls[0].endpoint).toBe("notes/schedule/create");
    await listScheduledNotes(call);
    expect(calls[1]).toEqual({ endpoint: "notes/schedule/list", params: { limit: 20 } });
    await deleteScheduledNote(call, "s1");
    expect(calls[2]).toEqual({ endpoint: "notes/schedule/delete", params: { scheduleId: "s1" } });
  });

  it("schedule + draft lists carry sinceId as well as untilId", async () => {
    const scheduleRow = { id: "s1", scheduledAt: "2030-01-01T00:00:00.000Z", note: note() };
    const draftRow = { id: "d1", visibility: "public", text: "t", cw: null, scheduledAt: null };
    const { call, calls } = stubCall((endpoint) =>
      endpoint === "notes/schedule/list" ? [scheduleRow] : [draftRow],
    );
    await listScheduledNotes(call, 20, "until-1", "since-1");
    expect(calls[0]).toEqual({
      endpoint: "notes/schedule/list",
      params: { limit: 20, untilId: "until-1", sinceId: "since-1" },
    });
    await listServerDrafts(call, 7, undefined, "since-2");
    expect(calls[1]).toEqual({
      endpoint: "notes/drafts/list",
      params: { limit: 7, sinceId: "since-2" },
    });
    // untilId-only callers keep the old shape exactly.
    await listServerDrafts(call, 7, "until-2");
    expect(calls[2]).toEqual({
      endpoint: "notes/drafts/list",
      params: { limit: 7, untilId: "until-2" },
    });
  });

  it("serverDrafts CRUD + count (non-number counts as 0)", async () => {
    const wireRow = {
      id: "d1",
      visibility: "public",
      text: "t",
      cw: null,
      scheduledAt: null,
    };
    const { call, calls } = stubCall((endpoint) => {
      if (endpoint === "notes/drafts/count") return { count: "many" };
      if (endpoint === "notes/drafts/list") return [wireRow];
      return wireRow;
    });
    await createServerDraft(call, { visibility: "public" });
    expect(calls[0].endpoint).toBe("notes/drafts/create");
    await listServerDrafts(call, 5);
    expect(calls[1]).toEqual({ endpoint: "notes/drafts/list", params: { limit: 5 } });
    await updateServerDraft(call, "d1", { visibility: "public" });
    expect(calls[2].params).toMatchObject({ draftId: "d1" });
    await deleteServerDraft(call, "d1");
    expect(calls[3].endpoint).toBe("notes/drafts/delete");
    await expect(countServerDrafts(call)).resolves.toBe(0);
  });
});

// --- softMute ------------------------------------------------------------------

describe("misskey/softMute", () => {
  const n = (over: Partial<MuteCheckNote> = {}): MuteCheckNote => ({
    userId: "u2",
    text: "hello world",
    cw: null,
    user: { host: null },
    ...over,
  });

  it("keyword groups AND within a line, OR across lines; own notes exempt", () => {
    expect(checkWordMute(n(), "u2", [["hello"]])).toBe(false); // own note
    expect(checkWordMute(n(), "u9", [["hello", "world"]])).toEqual([["hello", "world"]]);
    expect(checkWordMute(n(), "u9", [["hello", "missing"]])).toBe(false);
    expect(checkWordMute(n(), "u9", [["missing"], ["world"]])).toEqual([["world"]]);
    expect(checkWordMute(n(), "u9", [[""]])).toBe(false); // emptied group never matches
    expect(checkWordMute(n({ text: "x", cw: "secret" }), "u9", [["secret"]])).toEqual([["secret"]]);
  });

  it("bare strings are regexes; invalid patterns never match", () => {
    expect(checkWordMute(n(), "u9", ["/wor.d/"])).toEqual(["/wor.d/"]);
    expect(checkWordMute(n(), "u9", ["/([/"])).toBe(false);
    expect(checkWordMute(n({ text: "", cw: "" }), "u9", [["x"]])).toBe(false);
    expect(checkWordMute(n(), "u9", null)).toBe(false);
  });

  it("checkNoteWordMute walks reply then renote; first match wins", () => {
    const withReply = n({ reply: n({ text: "reply secret", userId: "u3" }) });
    expect(checkNoteWordMute(withReply, "u9", [["secret"]])).toEqual([["secret"]]);
    const withRenote = n({ renote: n({ text: "renote secret", userId: "u3" }) });
    expect(checkNoteWordMute(withRenote, "u9", [["secret"]])).toEqual([["secret"]]);
    expect(checkNoteWordMute(n(), "u9", [["secret"]])).toBe(false);
    expect(checkNoteWordMute(n(), "u9", null)).toBe(false);
  });

  it("isInstanceMuted matches author/reply/renote hosts exactly", () => {
    expect(isInstanceMuted(n(), ["x"])).toBe(false);
    expect(isInstanceMuted(n({ user: { host: "evil.example" } }), ["evil.example"])).toBe(true);
    expect(isInstanceMuted(n({ user: { host: "Evil.example" } }), ["evil.example"])).toBe(false);
    const nested = n({ reply: n({ user: { host: "evil.example" }, userId: "u3" }) });
    expect(isInstanceMuted(nested, new Set(["evil.example"]))).toBe(true);
  });

  it("filter text round-trips; bad regex lines throw with the 1-based line", () => {
    expect(formatWordFilters([["a", "b"], "/x/i"])).toBe("a b\n/x/i");
    expect(parseWordFilters("a b\n/x/i\n")).toEqual([["a", "b"], "/x/i"]);
    expect(() => parseWordFilters("ok\n/(/")).toThrow(WordFilterParseError);
    try {
      parseWordFilters("ok\n/(/");
    } catch (e) {
      expect((e as WordFilterParseError).line).toBe(2);
    }
    expect(parseMutedInstances("a.example, b.example\na.example\n")).toEqual([
      "a.example",
      "b.example",
    ]);
  });

  it("muteCheckOf derives the matcher input from a Post", () => {
    const post = postFromWire({ text: "hi" });
    const check = muteCheckOf(post);
    expect(check.text).toBe("hi");
    expect(checkWordMute(check, "other", [["hi"]])).toEqual([["hi"]]);
  });
});

// --- clips --------------------------------------------------------------------

describe("misskey/clips", () => {
  const packed = { id: "c1", name: "clip", isPublic: true, description: null, notesCount: 3 };

  it("list adapts rows; junk rows degrade to empty ids/names, never throw", async () => {
    const { call, calls } = stubCall(() => [packed, { id: 1 }]);
    const clips = await listClips(call);
    expect(clips[0]).toMatchObject({ id: "c1", name: "clip", notesCount: 3 });
    expect(clips[1]).toMatchObject({ id: "", name: "" });
    expect(calls[0]).toEqual({ endpoint: "clips/list", params: { limit: 100 } });
  });

  it("create/update/delete/add/remove hit their endpoints", async () => {
    const { call, calls } = stubCall((endpoint) => (endpoint === "clips/list" ? [] : packed));
    const created = await createClip(call, "n", { isPublic: false });
    expect(created.id).toBe("c1"); // the adapter echoes the server row
    expect(calls[0].params).toMatchObject({ name: "n", isPublic: false });
    await updateClip(call, "c1", { name: "m" });
    expect(calls[1]).toEqual({ endpoint: "clips/update", params: { clipId: "c1", name: "m" } });
    await deleteClip(call, "c1");
    await addNoteToClip(call, "c1", "n1");
    await removeNoteFromClip(call, "c1", "n1");
    expect(calls.slice(2).map((c) => c.endpoint)).toEqual([
      "clips/delete",
      "clips/add-note",
      "clips/remove-note",
    ]);
    const { call: call2, calls: calls2 } = stubCall(() => [packed]);
    await expect(listClipsContaining(call2, "n1")).resolves.toHaveLength(1);
    expect(calls2[0]).toEqual({ endpoint: "notes/clips", params: { noteId: "n1" } });
  });
});

// --- backend sub-modules (antennas/drive/bookmarks/reactions/pin/report) -------

describe("MisskeyBackend sub-modules (MK12 indirect)", () => {
  const backendFor = (
    respond: (endpoint: string, params: Record<string, unknown>) => unknown,
    flavor = "misskey",
  ) => {
    const { transport, calls } = stubTransport(respond);
    return { backend: createMisskeyBackend(transport, flavor as "misskey"), calls };
  };

  it("antennas CRUD + notes keep the nested keyword shape", async () => {
    const wireAntenna = {
      id: "a1",
      name: "ant",
      src: "all",
      userListId: null,
      keywords: [["a", "b"], ["c"]],
      excludeKeywords: [],
      users: [],
      caseSensitive: false,
      localOnly: false,
      excludeBots: true,
      withReplies: false,
      withFile: false,
    };
    const { backend, calls } = backendFor((endpoint) => {
      if (endpoint === "antennas/list") return [wireAntenna];
      if (endpoint === "antennas/notes") return [note()];
      return wireAntenna;
    });
    const listed = await backend.antennas!.list();
    expect(listed[0].keywords).toEqual([["a", "b"], ["c"]]);
    const { id: _omit, ...antParams } = listed[0];
    await backend.antennas!.create(antParams);
    expect(calls[1].endpoint).toBe("antennas/create");
    await backend.antennas!.update("a1", antParams);
    expect(calls[2].params).toMatchObject({ antennaId: "a1" });
    await backend.antennas!.delete("a1");
    expect(calls[3].endpoint).toBe("antennas/delete");
    const page = await backend.antennas!.notes("a1");
    expect(page.items).toHaveLength(1);
  });

  it("drive files page with type; update/delete send fileId", async () => {
    const file = fixture("misskey/drive-file.json");
    const { backend, calls } = backendFor((endpoint) =>
      endpoint === "drive/files" ? [file] : file,
    );
    const page = await backend.drive!.files({ type: "image/png" });
    expect(calls[0].params).toMatchObject({ type: "image/png" });
    expect(page.items[0].id).toBe((file as { id: string }).id);
    await backend.drive!.updateFile("f1", { name: "n", isSensitive: true });
    expect(calls[1].params).toMatchObject({ fileId: "f1", name: "n", isSensitive: true });
    await backend.drive!.deleteFile("f1");
    expect(calls[2]).toEqual({ endpoint: "drive/files/delete", params: { fileId: "f1" } });
  });

  it("bookmarks list unwraps favorite rows; add/remove hit favorites endpoints", async () => {
    const { backend, calls } = backendFor((endpoint) =>
      endpoint === "i/favorites" ? [{ id: "f1", note: note() }] : undefined,
    );
    const page = await backend.bookmarks!.list();
    expect(page.items[0].post.id).toBe(note().id);
    await backend.bookmarks!.add("n1");
    await backend.bookmarks!.remove("n1");
    expect(calls.slice(1).map((c) => c.endpoint)).toEqual([
      "notes/favorites/create",
      "notes/favorites/delete",
    ]);
  });

  it("noteReactions sends the type filter; accountReactions keeps null posts", async () => {
    const { backend, calls } = backendFor((endpoint) => {
      if (endpoint === "notes/reactions")
        return [{ id: "r1", createdAt: "2026-01-01T00:00:00.000Z", user: user(), type: "❤" }];
      return [{ id: "ar1", createdAt: "2026-01-01T00:00:00.000Z", reaction: "❤", note: null }];
    });
    const reactions = await backend.noteReactions("n1", { reaction: "❤" });
    expect(calls[0].params).toMatchObject({ noteId: "n1", type: "❤" });
    expect(reactions.items[0]).toMatchObject({ reaction: "❤", account: { id: user().id } });
    const accountReactions = await backend.accountReactions("u1");
    expect(accountReactions.items[0].post).toBeNull();
  });

  it("pin/unpin, muteThread and reportAccount hit their endpoints", async () => {
    const { backend, calls } = backendFor(() => undefined);
    await backend.pinPost("n1");
    await backend.unpinPost("n1");
    await backend.muteThread("n1");
    await backend.reportAccount("u1", "spam");
    expect(calls.map((c) => [c.endpoint, c.params])).toEqual([
      ["i/pin", { noteId: "n1" }],
      ["i/unpin", { noteId: "n1" }],
      ["notes/thread-muting/create", { noteId: "n1" }],
      ["users/report-abuse", { userId: "u1", comment: "spam" }],
    ]);
  });

  it("scheduled + serverDrafts via the backend map wire rows to domain rows", async () => {
    const draftRow = { id: "d1", visibility: "public", text: "t", cw: null, scheduledAt: null };
    const { backend, calls } = backendFor((endpoint) => {
      if (endpoint === "notes/schedule/list")
        return [{ id: "s1", scheduledAt: "2030-01-01T00:00:00.000Z", note: note() }];
      if (endpoint === "notes/schedule/create")
        return { id: "s2", scheduledAt: "2030-01-01T00:00:00.000Z", note: note() };
      if (endpoint === "notes/drafts/count") return { count: 2 };
      if (endpoint === "notes/drafts/list") return [draftRow];
      return draftRow;
    });
    const scheduled = await backend.scheduled!.list();
    expect(scheduled[0]).toMatchObject({ id: "s1", post: { id: note().id } });
    const created = await backend.scheduled!.create({
      text: "t",
      scheduledAt: "2030-01-01T00:00:00.000Z",
    });
    expect(calls[1].params).toMatchObject({ scheduledAt: "2030-01-01T00:00:00.000Z" });
    expect(created.id).toBe("s2");
    await backend.serverDrafts!.list();
    await expect(backend.serverDrafts!.count()).resolves.toBe(2);
  });

  it("scheduled + drafts push a sinceId cursor through (newer rows are not an empty end)", async () => {
    const draftRow = { id: "d1", visibility: "public", text: "t", cw: null, scheduledAt: null };
    const { backend, calls } = backendFor((endpoint) => {
      if (endpoint === "notes/schedule/list")
        return [{ id: "s5", scheduledAt: "2030-01-01T00:00:00.000Z", note: note() }];
      if (endpoint === "notes/drafts/list") return [draftRow];
      return null;
    });
    const scheduled = await backend.scheduled!.list({
      cursor: JSON.stringify({ sinceId: "s4" }) as never,
    });
    expect(calls[0]).toEqual({
      endpoint: "notes/schedule/list",
      params: { limit: 20, sinceId: "s4" },
    });
    expect(scheduled.map((s) => s.id)).toEqual(["s5"]);

    const drafts = await backend.serverDrafts!.list({
      limit: 10,
      cursor: JSON.stringify({ untilId: "d9", sinceId: "d0" }) as never,
    });
    expect(calls[1]).toEqual({
      endpoint: "notes/drafts/list",
      params: { limit: 10, untilId: "d9", sinceId: "d0" },
    });
    expect(drafts.map((d) => d.id)).toEqual(["d1"]);
  });

  it("clips + list membership via the backend", async () => {
    const { backend, calls } = backendFor((endpoint) => {
      if (endpoint === "clips/notes") return [note()];
      if (endpoint === "users/lists/list") return [{ id: "l1", userIds: ["u1"] }];
      if (endpoint === "notes/clips") return [{ id: "c1", name: "clip" }];
      return { id: "c1", name: "clip" };
    });
    await expect(backend.clips!.containing("n1")).resolves.toMatchObject([{ id: "c1" }]);
    const notes = await backend.clips!.notes("c1");
    expect(notes.items).toHaveLength(1);
    await expect(backend.lists!.membership!.containing("u1")).resolves.toEqual(["l1"]);
    expect(calls.map((c) => c.endpoint)).toContain("users/lists/list");
  });
});

// --- MK10 manifest provenance ---------------------------------------------------

describe("fixtures/manifest.json provenance (MK10)", () => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "manifest.json"), "utf8"),
  ) as {
    fixtures: Record<string, { source: string; endpoint: string }>;
  };

  it("every carried fixture file has a manifest entry with an endpoint", () => {
    for (const flavor of ["misskey", "sharkey", "pinetree"]) {
      const files = readdirSync(join(__dirname, "fixtures", flavor)).filter((f) =>
        f.endsWith(".json"),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const entry = manifest.fixtures[`${flavor}/${file}`];
        expect(entry).toBeDefined();
        expect(entry.endpoint.length).toBeGreaterThan(0);
      }
    }
  });

  it("pinetree provenance: synthesised bodies present, grouped honestly absent", () => {
    for (const file of ["note.json", "user.json", "drive-file.json", "notification.json"]) {
      expect(manifest.fixtures[`pinetree/${file}`].source).toBe("synthesised");
    }
    const grouped = manifest.fixtures["pinetree/notification-grouped.json"];
    expect(grouped.source).toBe("not-applicable");
    // …and no file is faked for it:
    expect(() =>
      readFileSync(join(__dirname, "fixtures", "pinetree", "notification-grouped.json")),
    ).toThrow();
  });
});
