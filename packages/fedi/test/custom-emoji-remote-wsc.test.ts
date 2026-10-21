// WS-C — `remoteEmojis()` enumeration on the custom-emoji store.
// Transports stubbed (global fetch per test, restored after); no rig.

import { ApiError } from "../src/core/errors";
import type { WireCall } from "../src/misskey/client";
import { createCustomEmojiStore } from "../src/misskey/customEmoji";

function stubCall(run: () => unknown): { call: WireCall } {
  const call = (<T>(): Promise<T> => Promise.resolve(run() as T)) as WireCall;
  return { call };
}

function okListing(emojis: Array<{ name: string; url: string }>) {
  return async () => ({ ok: true, json: async () => ({ emojis }) });
}

describe("customEmoji store remoteEmojis()", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("starts empty and enumerates fetched host tables", async () => {
    (globalThis as { fetch: unknown }).fetch = okListing([
      { name: "wave", url: "https://remote.example/wave.png" },
    ]);
    const { call } = stubCall(() => ({ emojis: [] }));
    const store = createCustomEmojiStore(call);
    expect(store.remoteEmojis()).toEqual([]);
    store.ensureHostEmojis("remote.example");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.remoteEmojis()).toEqual([
      { host: "remote.example", name: "wave", url: "https://remote.example/wave.png" },
    ]);
  });

  it("failed or unknown hosts stay absent (unknown codes render literally)", async () => {
    (globalThis as { fetch: unknown }).fetch = async () => {
      throw new Error("down");
    };
    const { call } = stubCall(() => ({ emojis: [] }));
    const store = createCustomEmojiStore(call);
    store.ensureHostEmojis("dead.example");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.remoteUrlFor("dead.example", "wave")).toBeNull();
    expect(store.remoteEmojis()).toEqual([]);
  });

  it("host keys normalize (case-insensitive) and dedupe round-trips", async () => {
    (globalThis as { fetch: unknown }).fetch = okListing([
      { name: "wave", url: "https://remote.example/wave.png" },
    ]);
    const { call } = stubCall(() => ({ emojis: [] }));
    const store = createCustomEmojiStore(call);
    store.ensureHostEmojis("Remote.Example");
    store.ensureHostEmojis("remote.example");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.remoteEmojis()).toHaveLength(1);
    expect(store.remoteUrlFor("REMOTE.EXAMPLE", "wave")).toBe("https://remote.example/wave.png");
  });

  it("a 404 local listing still allows remote host tables", async () => {
    (globalThis as { fetch: unknown }).fetch = okListing([
      { name: "wave", url: "https://remote.example/wave.png" },
    ]);
    const call = (<T>(): Promise<T> => Promise.reject(new ApiError("nope", 404))) as WireCall;
    const store = createCustomEmojiStore(call);
    store.load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state()).toBe("unavailable");
    store.ensureHostEmojis("remote.example");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.remoteUrlFor("remote.example", "wave")).toBe("https://remote.example/wave.png");
  });
});
