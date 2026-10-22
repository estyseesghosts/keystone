// Misskey channels: every method must make exactly the requests the
// official client makes (`channels/search`, `channels/show`,
// `channels/timeline`, `channels/followed`, `channels/follow|unfollow`),
// adapt the packed shape to `core/backend.Channel`, and gate the module on
// the `channels` capability. Transport is stubbed — no network.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { buildCapabilities } from "../src/core/detect";
import type { Note } from "../src/misskey/wire";
import type { PackedChannel } from "../src/misskey/channels";

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
      upload<T>(): Promise<T> {
        throw new Error("no upload in this test");
      },
    },
  };
}

const note = fixture<Note>("note.json");

// Shape of `ChannelEntityService.pack` (backend src/core/entities/
// ChannelEntityService.ts), trimmed to the fields the domain model keeps.
const packed: PackedChannel = {
  id: "8f2chan0000000001",
  name: "General",
  description: "Talk about anything",
  bannerUrl: "https://mk.example/files/banner.png",
  isFollowing: true,
  isArchived: false,
  usersCount: 12,
  notesCount: 34,
};

describe("MisskeyBackend channels", () => {
  it("lists the directory through channels/search (empty query, paged both ways)", async () => {
    const { transport, calls } = stubTransport(() => [packed]);
    const backend = createMisskeyBackend(transport);
    const page = await backend.channels!.list({ limit: 5 });

    expect(calls[0]).toEqual({
      endpoint: "channels/search",
      params: { query: "", limit: 5 },
    });
    expect(page.items[0]).toMatchObject({
      id: "8f2chan0000000001",
      name: "General",
      description: "Talk about anything",
      bannerUrl: "https://mk.example/files/banner.png",
      isFollowing: true,
      usersCount: 12,
      notesCount: 34,
    });
    expect(page.end).toBe(true); // 1 < 5

    await backend.channels!.list({
      cursor: JSON.stringify({ untilId: "u1" }) as never,
      limit: 2,
    });
    expect(calls[1].params).toEqual({ query: "", limit: 2, untilId: "u1" });

    // A since cursor still travels (pull-to-refresh sees newer rows).
    await backend.channels!.list({
      cursor: JSON.stringify({ sinceId: "s1" }) as never,
      limit: 2,
    });
    expect(calls[2].params).toEqual({ query: "", limit: 2, sinceId: "s1" });
  });

  it("forwards a search query verbatim", async () => {
    const { transport, calls } = stubTransport(() => []);
    await createMisskeyBackend(transport).channels!.list({ query: "cats" });
    expect(calls[0].params).toEqual({ query: "cats", limit: 20 });
  });

  it("pages from the last channel id and keeps the page full flag honest", async () => {
    const { transport } = stubTransport(() => [packed, { ...packed, id: "b" }]);
    const page = await createMisskeyBackend(transport).channels!.list({ limit: 2 });
    expect(page.end).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ untilId: "b" });
  });

  it("shows one channel by id and keeps unknown follow state null", async () => {
    const { transport, calls } = stubTransport(() => ({
      ...packed,
      isFollowing: null,
    }));
    const channel = await createMisskeyBackend(transport).channels!.show("8f2chan0000000001");
    expect(calls[0]).toEqual({
      endpoint: "channels/show",
      params: { channelId: "8f2chan0000000001" },
    });
    // The server reported "unknown" — never collapsed to false.
    expect(channel.isFollowing).toBeNull();

    // Signed-out packs omit the field entirely: still not fabricated.
    const anon = stubTransport(() => ({ ...packed, isFollowing: undefined }));
    const anonChannel = await createMisskeyBackend(anon.transport).channels!.show("x");
    expect(anonChannel.isFollowing).toBeUndefined();
  });

  it("pages a channel timeline through channels/timeline", async () => {
    const { transport, calls } = stubTransport(() => [note]);
    const backend = createMisskeyBackend(transport);
    const page = await backend.channels!.notes("8f2chan0000000001", { limit: 10 });
    expect(calls[0]).toEqual({
      endpoint: "channels/timeline",
      params: { channelId: "8f2chan0000000001", limit: 10 },
    });
    expect(page.items[0].id).toBe(note.id);

    await backend.channels!.notes("8f2chan0000000001", {
      cursor: JSON.stringify({ untilId: "n1" }) as never,
    });
    expect(calls[1].params).toEqual({
      channelId: "8f2chan0000000001",
      limit: 20,
      untilId: "n1",
    });
  });

  it("lists followed channels with the same cursor shape", async () => {
    const { transport, calls } = stubTransport(() => [packed]);
    const page = await createMisskeyBackend(transport).channels!.followed({ limit: 5 });
    expect(calls[0]).toEqual({
      endpoint: "channels/followed",
      params: { limit: 5 },
    });
    expect(page.items[0].id).toBe(packed.id);

    await createMisskeyBackend(transport).channels!.followed({
      cursor: JSON.stringify({ untilId: "f1" }) as never,
    });
    expect(calls[1].params).toEqual({ limit: 20, untilId: "f1" });
  });

  it("follows and unfollows by channel id", async () => {
    const { transport, calls } = stubTransport(() => undefined);
    const backend = createMisskeyBackend(transport);
    await backend.channels!.follow("8f2chan0000000001");
    await backend.channels!.unfollow("8f2chan0000000001");
    expect(calls).toEqual([
      { endpoint: "channels/follow", params: { channelId: "8f2chan0000000001" } },
      { endpoint: "channels/unfollow", params: { channelId: "8f2chan0000000001" } },
    ]);
  });
});

describe("channels capability", () => {
  it("is supported on misskey and sharkey, unsupported on the Mastodon family", () => {
    expect(buildCapabilities("misskey").channels).toBe("supported");
    expect(buildCapabilities("sharkey").channels).toBe("supported");
    // Mastodon is a verified absence; Akkoma leaves the flag unknown, which
    // the UI treats exactly like absent (unknown never unlocks a surface).
    expect(buildCapabilities("mastodon").channels).toBe("unsupported");
    expect(buildCapabilities("akkoma").channels).not.toBe("supported");
    // Unverified forks must not unlock the surface either.
    expect(buildCapabilities("pinetree").channels).toBe("unknown");
    expect(buildCapabilities("catodon").channels).toBe("unknown");
  });

  it("the Misskey backend always exposes the module for the UI to gate", () => {
    const { transport } = stubTransport(() => []);
    const backend = createMisskeyBackend(transport);
    expect(backend.channels).toBeDefined();
    expect(backend.capabilities.channels).toBe("supported");
  });
});
