// P6.6 slice 1: Clips wire — paged list (B3), show null on 404,
// full-body update (DC-6/B1), new adapted fields, error mapping.
// Transport stubbed; no network.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import { adaptClipSummary, mapClipError } from "../src/misskey/clips";
import { ApiError, FediError } from "../src/core/errors";

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

const packed = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  createdAt: "2026-10-20T10:00:00.000Z",
  lastClippedAt: "2026-10-29T10:00:00.000Z",
  userId: "u1",
  user: {
    id: "u1",
    username: "ann",
    host: null,
    name: "Ann",
    isBot: false,
    isCat: false,
    avatarUrl: null,
    avatarBlurhash: null,
    emojis: {},
    onlineStatus: "online",
  },
  name: "Reading list",
  description: "Papers",
  isPublic: false,
  favoritedCount: 0,
  notesCount: 42,
  ...over,
});

describe("ClipsApi.list (B3: paged, not capped at 100)", () => {
  it("sends limit + cursor and pages", async () => {
    const { transport, calls } = stubTransport(() => [packed()]);
    const backend = createMisskeyBackend(transport);
    const first = await backend.clips!.list({ limit: 5 });
    expect(calls[0]).toEqual({ endpoint: "clips/list", params: { limit: 5 } });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.isOwn).toBe(true);
    expect(first.items[0]!.notesCount).toBe(42);
    expect(first.items[0]!.lastClippedAt).toBe("2026-10-29T10:00:00.000Z");
    expect(first.items[0]!.owner?.username).toBe("ann");
  });
});

describe("ClipsApi.show", () => {
  it("returns the clip; null on 404 (never throws for missing)", async () => {
    const { transport } = stubTransport(() => packed());
    const backend = createMisskeyBackend(transport);
    expect((await backend.clips!.show("c1"))?.name).toBe("Reading list");

    const gone = stubTransport(() => {
      throw new ApiError("nope", 404);
    });
    const backend2 = createMisskeyBackend(gone.transport);
    expect(await backend2.clips!.show("gone")).toBeNull();
  });
});

describe("ClipsApi.update (DC-6/B1: full body always)", () => {
  it("sends name + isPublic + description even when unchanged", async () => {
    const { transport, calls } = stubTransport(endpoint => (endpoint === "clips/show" ? packed() : packed()));
    const backend = createMisskeyBackend(transport);
    await backend.clips!.update("c1", { name: "Reading list", isPublic: false, description: "Papers" });
    expect(calls[0]).toEqual({
      endpoint: "clips/update",
      params: { clipId: "c1", name: "Reading list", isPublic: false, description: "Papers" },
    });
  });

  it("null description is sent (the server applies `description || null`)", async () => {
    const { transport, calls } = stubTransport(() => packed());
    const backend = createMisskeyBackend(transport);
    await backend.clips!.update("c1", { name: "X", isPublic: true, description: null });
    expect(calls[0]!.params).toMatchObject({ description: null });
  });
});

describe("adaptClipSummary fields", () => {
  it("tolerates missing owner/notesCount (others' clips)", () => {
    const clip = adaptClipSummary({ id: "c9", name: "X" });
    expect(clip.owner).toBeUndefined();
    expect(clip.isOwn).toBeUndefined();
    expect(clip.notesCount).toBeUndefined();
    expect(clip.lastClippedAt).toBeUndefined();
  });

  it("maps owner + counts when packed", () => {
    const clip = adaptClipSummary(packed());
    expect(clip.owner?.username).toBe("ann");
    expect(clip.notesCount).toBe(42);
    expect(clip.createdAt).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("clip error mapping", () => {
  it("maps ALREADY_CLIPPED / TOO_MANY_CLIP_NOTES / NO_SUCH_CLIP", () => {
    for (const [wire, code] of [
      ["ALREADY_CLIPPED", "errors.clips.alreadyClipped"],
      ["TOO_MANY_CLIP_NOTES", "errors.clips.tooManyNotes"],
      ["NO_SUCH_CLIP", "errors.clips.noSuchClip"],
    ] as const) {
      try {
        mapClipError(new ApiError(wire, 400, wire));
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FediError);
        expect((err as FediError).code).toBe(code);
      }
    }
  });

  it("rethrows unknown errors untouched", () => {
    const err = new ApiError("weird", 400, "SOMETHING_ELSE");
    expect(() => mapClipError(err)).toThrow(err);
  });

  it("addNote surfaces typed errors through the backend", async () => {
    const { transport } = stubTransport(endpoint => {
      if (endpoint === "clips/add-note") throw new ApiError("dup", 400, "ALREADY_CLIPPED");
      return undefined;
    });
    const backend = createMisskeyBackend(transport);
    const failure = backend.clips!.addNote("c1", "n1").catch(e => e);
    await expect(failure).resolves.toMatchObject({ code: "errors.clips.alreadyClipped" });
  });
});
