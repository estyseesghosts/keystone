// X2.4 remotepost policy: no fetch for non-public AP ids, manual
// redirects (no follow), bounded caches kept. Every gate test fails on
// the old resolver (unconditional fetch).
import {
  cachedRemotePostUrl,
  resolveRemotePostUrl,
} from "../src/misskey/remotepost";
import type { FetchImpl } from "../src/core/http";

function throwingFetch(calls: string[]): FetchImpl {
  return async (input: string | URL) => {
    calls.push(String(input));
    throw new Error("must not fetch");
  };
}

describe("resolveRemotePostUrl outbound policy (X2.4)", () => {
  it("never fetches private/loopback/non-https AP ids (zero network)", async () => {
    const calls: string[] = [];
    for (const uri of [
      "http://192.168.1.1/x",
      "http://192.168.1.1/notes/1",
      "https://192.168.1.1/notes/1",
      "https://10.0.0.5/notes/1",
      "https://127.1/notes/1",
      "http://[::1]/notes/1",
      "http://2130706433/notes/1",
      "https://2130706433/notes/1",
      "http://localhost/notes/1",
      "http://remote.example/notes/x24-http",
    ]) {
      await expect(
        resolveRemotePostUrl(uri, { fetchImpl: throwingFetch(calls) }),
      ).resolves.toBeNull();
      // The negative miss is cached: a second lookup costs no fetch either.
      await expect(
        resolveRemotePostUrl(uri, { fetchImpl: throwingFetch(calls) }),
      ).resolves.toBeNull();
      expect(cachedRemotePostUrl(uri)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("still resolves a public AP id that answers with a matching object", async () => {
    const uri = "https://remote.example/notes/x24-ok-1";
    expect(cachedRemotePostUrl(uri)).toBeNull();
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ id: uri, url: "https://remote.example/@u/1" }), {
        status: 200,
      });
    await expect(resolveRemotePostUrl(uri, { fetchImpl })).resolves.toBe(
      "https://remote.example/@u/1",
    );
    expect(cachedRemotePostUrl(uri)).toBe("https://remote.example/@u/1");
  });

  it("does not follow redirects: a 3xx is a miss, not a hop", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (input: string | URL) => {
      calls.push(String(input));
      return new Response(null, {
        status: 301,
        headers: { Location: "https://remote.example/notes/x24-moved" },
      });
    };
    const uri = "https://remote.example/notes/x24-redirect-1";
    await expect(resolveRemotePostUrl(uri, { fetchImpl })).resolves.toBeNull();
    expect(calls).toEqual([uri]);
  });
});
