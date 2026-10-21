// Sharkey `POST notes/like` (like shortcut with toggle semantics) +
// its absence detection (stock Misskey). The transport is stubbed.

import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import {
  likeSupportFor,
  likeViaNotesLike,
  LikeUnsupportedError,
  resetLikeSupportCache,
  seedLikeSupport,
} from "../src/misskey/like";
import { ApiError } from "../src/core/errors";

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
        throw new Error("no uploads in this suite");
      },
    },
  };
}

const ORIGIN = "https://like.example";

beforeEach(() => {
  resetLikeSupportCache();
});

describe("likeViaNotesLike", () => {
  it("posts noteId + null override (server defaultLike)", async () => {
    const { transport, calls } = stubTransport(() => ({}));
    await likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", null);
    expect(calls).toEqual([{ endpoint: "notes/like", params: { noteId: "n1", override: null } }]);
    expect(likeSupportFor(ORIGIN)).toBe(true);
  });

  it("passes a custom override through verbatim", async () => {
    const { transport, calls } = stubTransport(() => ({}));
    await likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", ":blobcat@.:");
    expect(calls[0].params).toEqual({ noteId: "n1", override: ":blobcat@.:" });
  });

  it("UNKNOWN_API_ENDPOINT becomes LikeUnsupportedError and caches the absence", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("unknown api endpoint", 404, "UNKNOWN_API_ENDPOINT");
    });
    await expect(
      likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", null),
    ).rejects.toBeInstanceOf(LikeUnsupportedError);
    expect(likeSupportFor(ORIGIN)).toBe(false);
  });

  it("a bare 404 (no code) also reads as absent", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("not found", 404);
    });
    await expect(
      likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", null),
    ).rejects.toBeInstanceOf(LikeUnsupportedError);
  });

  it("other failures rethrow without caching", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("slow down", 429, "RATE_LIMIT_EXCEEDED");
    });
    await expect(
      likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", null),
    ).rejects.toMatchObject({ status: 429 });
    expect(likeSupportFor(ORIGIN)).toBeNull();
  });

  it("unprobed origins read null", () => {
    expect(likeSupportFor("https://fresh.example")).toBeNull();
  });

  it("a seeded-absent origin refuses without touching the wire", async () => {
    seedLikeSupport(ORIGIN, false);
    expect(likeSupportFor(ORIGIN)).toBe(false);
    const { transport, calls } = stubTransport(() => ({}));
    await expect(
      likeViaNotesLike(transport.call.bind(transport), ORIGIN, "n1", null),
    ).rejects.toBeInstanceOf(LikeUnsupportedError);
    expect(calls).toEqual([]);
  });

  it("seeding an empty origin is a no-op", () => {
    seedLikeSupport("", false);
    expect(likeSupportFor("")).toBeNull();
  });
});

describe("misskey backend like member", () => {
  it("exposes like() + isSupported() bound to the session origin", async () => {
    const { transport, calls } = stubTransport(() => ({}));
    const backend = createMisskeyBackend(transport, "sharkey", { origin: ORIGIN });
    expect(backend.like?.isSupported()).toBeNull();
    await backend.like?.like("n9", null);
    expect(calls[0]).toEqual({
      endpoint: "notes/like",
      params: { noteId: "n9", override: null },
    });
    expect(backend.like?.isSupported()).toBe(true);
  });

  it("without an origin there is no cache (still throws unsupported)", async () => {
    const { transport } = stubTransport(() => {
      throw new ApiError("not found", 404);
    });
    const backend = createMisskeyBackend(transport, "misskey");
    expect(backend.like?.isSupported()).toBeNull();
    await expect(backend.like?.like("n9")).rejects.toBeInstanceOf(LikeUnsupportedError);
    expect(likeSupportFor("")).toBeNull();
  });

  it("stock-misskey flavor seeds the origin absent: never probes, falls back by contract", async () => {
    const { transport, calls } = stubTransport(() => ({}));
    const seededOrigin = "https://stock-misskey.example";
    const backend = createMisskeyBackend(transport, "misskey", { origin: seededOrigin });
    expect(backend.like?.isSupported()).toBe(false);
    await expect(backend.like?.like("n9")).rejects.toBeInstanceOf(LikeUnsupportedError);
    // No wire traffic at all: the doomed 404 never fires (the app-layer
    // toggle queue reads isSupported() and reacts ❤ directly instead).
    expect(calls).toEqual([]);
  });

  it("sharkey flavor leaves the origin unseeded: support probes by fire once", async () => {
    const { transport } = stubTransport(() => ({}));
    const backend = createMisskeyBackend(transport, "sharkey", { origin: ORIGIN });
    expect(backend.like?.isSupported()).toBeNull();
  });
});
