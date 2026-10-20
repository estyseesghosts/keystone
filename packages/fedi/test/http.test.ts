// Phase 1 item D — `src/core/http.ts`: the shared transport core (the
// Mastodon client's origin guard + error kinds, `MastoHttpError` renamed to
// `HttpError`). Note there is NO token parameter on the request layer at
// all: auth is bound at the Session level.
//
// Jest port: `afterEach/describe/it/expect` are globals (no vitest import);
// `vi.stubGlobal("fetch", …)` becomes a direct `globalThis.fetch` swap with
// restore in `afterEach`.
import {
  HttpError,
  normalizeOrigin,
  originHost,
  requestJson,
  resolveSameOriginUrl,
} from "../src/core/http";

const ORIGIN = "https://server.example";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push(url);
    return impl(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

describe("origin helpers (ported from api/mastodon/client.ts)", () => {
  it("normalizeOrigin canonicalizes and drops paths", () => {
    expect(normalizeOrigin("example.com")).toBe("https://example.com");
    expect(normalizeOrigin("http://localhost:4000")).toBe("http://localhost:4000");
    expect(normalizeOrigin("https://Example.COM/some/path?q=1")).toBe("https://example.com");
  });
  it("normalizeOrigin rejects nonsense", () => {
    expect(() => normalizeOrigin("")).toThrow();
    expect(() => normalizeOrigin("ftp://example.com")).toThrow();
    expect(() => normalizeOrigin("bad host")).toThrow();
  });
  it("originHost strips the scheme", () => {
    expect(originHost("https://example.com:8443")).toBe("example.com:8443");
  });
  it("resolveSameOriginUrl accepts same-origin and relative hrefs", () => {
    expect(resolveSameOriginUrl(ORIGIN, "/next?page=2")).toBe(`${ORIGIN}/next?page=2`);
    expect(resolveSameOriginUrl(ORIGIN, `${ORIGIN}/next`)).toBe(`${ORIGIN}/next`);
  });
  it("resolveSameOriginUrl refuses cross-origin and non-web URLs", () => {
    expect(resolveSameOriginUrl(ORIGIN, "https://evil.example/steal")).toBeNull();
    expect(resolveSameOriginUrl(ORIGIN, "http://server.example/x")).toBeNull(); // scheme differs
    expect(resolveSameOriginUrl(ORIGIN, "javascript:alert(1)")).toBeNull();
    expect(resolveSameOriginUrl(ORIGIN, "not a url at all")).not.toBeNull(); // resolves as path
  });
});

describe("requestJson origin guard", () => {
  it("refuses a cross-origin absolute URL BEFORE any fetch", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
    const err = await requestJson(ORIGIN, "https://evil.example/steal").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("cross-origin");
    expect(calls).toEqual([]);
  });

  it("refuses relative paths that do not start with /", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
    const err = await requestJson(ORIGIN, "api/meta").catch((e) => e);
    expect((err as HttpError).kind).toBe("cross-origin");
    expect(calls).toEqual([]);
  });

  it("only ever fetches the session origin", async () => {
    const calls = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
    await requestJson(ORIGIN, "/api/meta", { method: "POST", json: {} });
    expect(calls).toEqual([`${ORIGIN}/api/meta`]);
  });
});

describe("requestJson error kinds and tolerant parsing", () => {
  it("204 and empty bodies resolve as data undefined", async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    const res = await requestJson(ORIGIN, "/api/notes/create", { method: "POST", json: {} });
    expect(res.status).toBe(204);
    expect(res.data).toBeUndefined();

    stubFetch(() => Promise.resolve(new Response("", { status: 200 })));
    const res2 = await requestJson(ORIGIN, "/api/meta", { method: "POST", json: {} });
    expect(res2.data).toBeUndefined();
  });

  it("2xx non-JSON body is kind invalid-json (never blind .json())", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>oops</html>", { status: 200 })));
    const err = await requestJson(ORIGIN, "/api/meta").catch((e) => e);
    expect((err as HttpError).kind).toBe("invalid-json");
    expect((err as HttpError).status).toBe(200);
  });

  it("non-2xx JSON envelope keeps the body and status", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Nope", code: "NOPE", kind: "Kind" } }), {
          status: 403,
        }),
      ),
    );
    const err = (await requestJson(ORIGIN, "/api/i").catch((e) => e)) as HttpError;
    expect(err.kind).toBe("http");
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: { message: "Nope", code: "NOPE", kind: "Kind" } });
  });

  it("non-2xx non-JSON body keeps the raw text and the status", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>404</html>", { status: 404 })));
    const err = (await requestJson(ORIGIN, "/api/unknown").catch((e) => e)) as HttpError;
    expect(err.kind).toBe("http");
    expect(err.status).toBe(404);
    expect(err.body).toBe("<html>404</html>");
  });

  it("network failures are kind network, status 0", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = (await requestJson(ORIGIN, "/api/meta").catch((e) => e)) as HttpError;
    expect(err.kind).toBe("network");
    expect(err.status).toBe(0);
  });

  it("a hung request is kind timeout, never 'endpoint unsupported'", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const err = (await requestJson(ORIGIN, "/api/meta", { timeoutMs: 10 }).catch(
      (e) => e,
    )) as HttpError;
    expect(err.kind).toBe("timeout");
    expect(err.status).toBe(0);
    // The message names the path, never a token.
    expect(err.path).toBe("/api/meta");
  });
});
