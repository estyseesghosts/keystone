// Repair X2.2 — transport hardening. Each test fails before the fix and
// passes after (see the step tags). No network: every transport takes an
// injected fetch stub.
import { ApiError, FediError } from "../src/core/errors";
import { HttpError, normalizeOrigin, requestJson } from "../src/core/http";
import { MastoHttpError, request, toApiError } from "../src/mastodon/client";
import { createMisskeyClient } from "../src/misskey/client";
import { checkExternalSession, normalizeHost } from "../src/misskey/external";
import type { Session } from "../src/core/sessions";

const ORIGIN = "https://server.example";

const session = (over: Partial<Session> = {}): Session => ({
  id: `${ORIGIN} u1`,
  origin: ORIGIN,
  family: "misskey",
  flavor: "misskey",
  accountId: "u1",
  token: "sess-token",
  grant: "password",
  hosting: "first-party",
  ...over,
});

interface Call {
  url: string;
  init: RequestInit;
}

function callsOf(fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>): {
  fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const wrapped = (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return fetchImpl(url, init);
  };
  return { fetchImpl: wrapped, calls };
}

const redirectResponse = (status: number, location: string): Response =>
  new Response(null, { status, headers: { location } });

describe("X2.2 step 1 — 3xx is refused before any second request", () => {
  it("core requestJson: 307 with redirect:manual, one call, typed redirect error", async () => {
    const { fetchImpl, calls } = callsOf(() =>
      Promise.resolve(redirectResponse(307, "https://evil.example/x")),
    );
    const err = await requestJson(ORIGIN, "/api/i", {
      method: "POST",
      json: { i: "sess-token" },
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("redirect");
    expect((err as HttpError).code).toBe("errors.network.redirect");
    expect((err as HttpError).params).toMatchObject({ status: 307 });
    expect(calls).toHaveLength(1);
    expect((calls[0].init as { redirect?: string }).redirect).toBe("manual");
  });

  it("mastodon request: 308 with a Bearer token never re-sends the token", async () => {
    const { fetchImpl, calls } = callsOf(() =>
      Promise.resolve(redirectResponse(308, "https://evil.example/oauth")),
    );
    const err = await request(ORIGIN, "/oauth/token", {
      method: "POST",
      form: { grant_type: "password", username: "u", password: "pw" },
      token: "secret-token",
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MastoHttpError);
    expect((err as MastoHttpError).kind).toBe("redirect");
    expect((err as MastoHttpError).code).toBe("errors.network.redirect");
    // The token left the process exactly once, on the session origin.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ORIGIN}/oauth/token`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect((calls[0].init as { redirect?: string }).redirect).toBe("manual");
  });

  it("misskey call: 307 keeps the `i` body on the session origin", async () => {
    const { fetchImpl, calls } = callsOf(() =>
      Promise.resolve(redirectResponse(307, "https://evil.example/api/i")),
    );
    const err = await createMisskeyClient(session(), { fetchImpl })
      .call("i", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.network.redirect");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body)) as Record<string, unknown>).toEqual({
      i: "sess-token",
    });
    expect((calls[0].init as { redirect?: string }).redirect).toBe("manual");
  });

  it("misskey postDirect (external check): 307 is a typed redirect, one call", async () => {
    const { fetchImpl, calls } = callsOf(() =>
      Promise.resolve(redirectResponse(307, "https://evil.example/api/x")),
    );
    const err = await checkExternalSession("https", "server.example", "sess", fetchImpl).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.network.redirect");
    expect(calls).toHaveLength(1);
    expect((calls[0].init as { redirect?: string }).redirect).toBe("manual");
  });
});

describe("X2.2 step 3 — a stalled body still hits the deadline", () => {
  const abortError = (): Error =>
    Object.assign(new Error("aborted"), { name: "AbortError" });

  /** A 200 whose `text()` hangs until the transport's signal aborts. */
  function stalledBodyFetch(): (url: string | URL, init?: RequestInit) => Promise<Response> {
    return (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      const hanging = {
        status: 200,
        ok: true,
        url: "",
        headers: new Headers({ "content-type": "application/json" }),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(abortError());
              return;
            }
            signal?.addEventListener("abort", () => reject(abortError()), { once: true });
          }),
      } as unknown as Response;
      return Promise.resolve(hanging);
    };
  }

  it("core requestJson rejects with timeout near the deadline", async () => {
    const startedAt = Date.now();
    const err = await requestJson(ORIGIN, "/api/meta", {
      method: "POST",
      json: {},
      timeoutMs: 50,
      fetchImpl: stalledBodyFetch(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("timeout");
    expect((err as HttpError).code).toBe("errors.network.timeoutInstance");
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it("mastodon request rejects with timeout near the deadline", async () => {
    const startedAt = Date.now();
    const err = await request(ORIGIN, "/api/v1/accounts/verify_credentials", {
      token: "t",
      timeoutMs: 50,
      fetchImpl: stalledBodyFetch(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MastoHttpError);
    expect((err as MastoHttpError).kind).toBe("timeout");
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

describe("X2.2 step 6 — cleartext only for local targets", () => {
  it("normalizeOrigin rejects http for a public host", () => {
    const err = (() => {
      try {
        normalizeOrigin("http://example.com");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.origin.insecure");
  });

  it.each([
    "http://localhost:3000",
    "http://localhost:4000/path",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.0.2.2:3000",
    "http://192.168.1.20:3000",
    "http://10.1.2.3",
    "http://172.20.0.5:3000",
    "http://169.254.10.20",
    "http://myserver.local:3000",
  ])("normalizeOrigin accepts local http %s", (input) => {
    expect(() => normalizeOrigin(input)).not.toThrow();
  });

  it("normalizeHost rejects http for a public host, accepts localhost", () => {
    const rejected = (() => {
      try {
        normalizeHost("http://example.com");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(rejected).toBeInstanceOf(FediError);
    expect((rejected as FediError).code).toBe("errors.origin.insecure");
    expect(normalizeHost("http://localhost:3000")).toEqual({
      host: "localhost:3000",
      scheme: "http",
    });
  });

  it("https for a public host is unaffected", () => {
    expect(normalizeOrigin("https://example.com")).toBe("https://example.com");
  });
});

describe("X2.2 step 4 — toApiError keeps kind/code/params, detail holds the text", () => {
  it("a 404 envelope keeps the transport code; the free-form text is detail", () => {
    const transport = new MastoHttpError({
      message: "API error: HTTP 404",
      kind: "http",
      code: "errors.network.apiError",
      params: { status: 404 },
      status: 404,
      body: { error: "Record not found" },
      origin: ORIGIN,
      method: "GET",
      path: "/api/v1/statuses/9",
    });
    const adapted = toApiError(transport);
    expect(adapted).toBeInstanceOf(ApiError);
    const api = adapted as ApiError;
    expect(api.status).toBe(404);
    expect(api.kind).toBe("http");
    // Never the free-form text as the stable code …
    expect(api.code).toBe("errors.network.apiError");
    // … but the text survives for logs/UI detail.
    expect(api.params).toMatchObject({ status: 404, detail: "Record not found" });
  });

  it("a timeout keeps the localizable timeout code (never apiError)", () => {
    const transport = new MastoHttpError({
      message: "timed out",
      kind: "timeout",
      code: "errors.network.timeoutInstance",
      params: { target: "GET /x", n: 0 },
      status: 0,
      origin: ORIGIN,
      method: "GET",
      path: "/x",
    });
    const adapted = toApiError(transport) as ApiError;
    expect(adapted).toBeInstanceOf(ApiError);
    expect(adapted.kind).toBe("timeout");
    expect(adapted.code).toBe("errors.network.timeoutInstance");
  });

  it("misskey timeout keeps the same timeout code family", async () => {
    const hanging = (
      _url: string | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    const err = await createMisskeyClient(session(), { timeoutMs: 20, fetchImpl: hanging })
      .call("meta")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FediError);
    expect((err as FediError).code).toBe("errors.network.timeoutServer");
  });
});

describe("X2.2 step 5 — no DOMException global needed (mastodon L3)", () => {
  it("a caller abort propagates when DOMException is deleted", async () => {
    const g = globalThis as { DOMException?: unknown };
    const saved = g.DOMException;
    try {
      g.DOMException = undefined;
      const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
      const failing = (): Promise<Response> => Promise.reject(abortErr);
      const err = await request(ORIGIN, "/api/v1/timelines/home", {
        token: "t",
        signal: AbortSignal.abort(),
        fetchImpl: failing,
      }).catch((e) => e);
      expect(err).toBe(abortErr);
      expect(err).not.toBeInstanceOf(TypeError);
    } finally {
      g.DOMException = saved;
    }
  });
});
