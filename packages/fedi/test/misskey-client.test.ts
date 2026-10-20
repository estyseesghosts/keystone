// Phase 1 item D — the session-bound Misskey transport.
// The whole point (the auth-survey security fix): there is no free token
// parameter; every request carries exactly the token of the Session the
// client was built from, to exactly that session's origin.
//
// Jest port: `afterEach/describe/it/expect` are globals (no vitest
// import); `vi.stubGlobal("fetch", …)` becomes a direct `globalThis.fetch`
// swap with restore in `afterEach`.
import { createMisskeyClient, authStyleFor } from "../src/misskey/client";
import { ApiError } from "../src/core/errors";
import { isPermissionError, isUnsupportedError } from "../src/misskey/client";
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

function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("auth style per flavor (Bearer where supported, `i` otherwise)", () => {
  it("mastodon-family flavors use Bearer", () => {
    expect(authStyleFor("mastodon")).toBe("bearer");
    expect(authStyleFor("akkoma")).toBe("bearer");
    expect(authStyleFor("pleroma")).toBe("bearer");
  });
  it("misskey-family flavors use the `i` body field (today's behaviour)", () => {
    expect(authStyleFor("misskey")).toBe("body-i");
    expect(authStyleFor("sharkey")).toBe("body-i");
    expect(authStyleFor("pinetree")).toBe("body-i");
    expect(authStyleFor("unknown")).toBe("body-i");
  });
});

describe("credential binding", () => {
  it("migrated sessions (flavor unknown) auth via the `i` body field", async () => {
    // The unified session store migrates legacy tokens with flavor
    // "unknown" (the legacy keys recorded no fork); the Misskey family
    // must keep authenticating exactly as before the flip.
    expect(authStyleFor("unknown")).toBe("body-i");
  });

  it("body-i sessions send the token as `i`, never as a header", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ id: "n1" })));
    await createMisskeyClient(session()).call("notes/create", { text: "hi" });
    const { url, init } = calls[0];
    expect(url).toBe(`${ORIGIN}/api/notes/create`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ text: "hi", i: "sess-token" });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("bearer sessions send Authorization: Bearer and no `i`", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ id: "s1" })));
    await createMisskeyClient(
      session({ family: "mastodon", flavor: "mastodon" }),
    ).call("statuses", { status: "hi" });
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({ status: "hi" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sess-token",
    );
  });

  it("a caller-supplied `i` wins over the session token (gen-token case)", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ token: "app" })));
    await createMisskeyClient(session()).call("miauth/gen-token", { i: "native-cred" });
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("native-cred");
  });

  it("callPublic never injects a credential", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ ok: true })));
    await createMisskeyClient(session()).callPublic("signin-flow", { username: "u" });
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({ username: "u" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("a signed-out session (empty token) sends no credential", async () => {
    const calls = stubFetch(() => Promise.resolve(json({})));
    await createMisskeyClient(session({ token: "" })).call("meta");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBeUndefined();
  });

  it("the token can only ever reach its own origin", async () => {
    const calls = stubFetch(() => Promise.resolve(json({})));
    const client = createMisskeyClient(session({ origin: "https://a.example" }));
    await client.call("i");
    await client.callPublic("meta");
    expect(calls.map((c) => c.url)).toEqual([
      "https://a.example/api/i",
      "https://a.example/api/meta",
    ]);
    expect(calls.every((c) => c.url.startsWith("https://a.example/"))).toBe(true);
  });
});

describe("response handling (the two behaviours that must not regress)", () => {
  it("204 responses resolve as undefined, never response.json()", async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(
      createMisskeyClient(session()).call("notes/delete", { noteId: "n1" }),
    ).resolves.toBeUndefined();
  });

  it("unknown POST paths answering 404 non-JSON keep the status (probe support)", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>404</html>", { status: 404 })));
    const err = await createMisskeyClient(session())
      .call("url-preview/probe", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("API returned invalid JSON (HTTP 404)");
    expect(isUnsupportedError(err)).toBe(true);
  });

  it("the error envelope maps to ApiError message/code/kind", async () => {
    stubFetch(() =>
      Promise.resolve(
        json({ error: { message: "Access denied", code: "PERMISSION_DENIED", kind: "Permission" } }, 403),
      ),
    );
    const err = await createMisskeyClient(session())
      .call("i/update", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Access denied");
    expect((err as ApiError).code).toBe("PERMISSION_DENIED");
    expect((err as ApiError).kind).toBe("Permission");
    expect(isPermissionError(err)).toBe(true);
  });

  it("empty-body errors keep the HTTP status with the standard message", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 500 })));
    const err = await createMisskeyClient(session()).call("meta").catch((e) => e);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("API error: HTTP 500");
  });
});

describe("error wording is preserved per hosting style", () => {
  it("first-party timeout names the endpoint and the dev terminal", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const err = await createMisskeyClient(session(), { timeoutMs: 10 })
      .call("notes/timeline", {})
      .catch((e) => e);
    expect((err as Error).message).toBe(
      "Request timed out (notes/timeline): the server did not answer within 0s. Retry, or check the dev-server terminal.",
    );
  });

  it("third-party timeout names the instance URL", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const err = await createMisskeyClient(session({ hosting: "third-party" }), {
      timeoutMs: 10,
    })
      .call("i", {})
      .catch((e) => e);
    expect((err as Error).message).toBe(
      `Request timed out (${ORIGIN}/api/i): the instance did not answer within 0s. Retry.`,
    );
  });

  it("network failures keep the pre-Phase-1 wording", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const internal = await createMisskeyClient(session())
      .call("meta")
      .catch((e) => e);
    expect((internal as Error).message).toBe(
      "Could not reach the server (Failed to fetch). Is it running?",
    );
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const external = await createMisskeyClient(session({ hosting: "third-party" }))
      .call("meta")
      .catch((e) => e);
    expect((external as Error).message).toBe(
      "Could not reach the instance (Failed to fetch). Is the host correct?",
    );
  });
});

describe("upload (multipart Drive, FormData — never JSON)", () => {
  it("posts file + `i` as FormData fields to drive/files/create", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ id: "f1" })));
    const file = new File(["x"], "pic.png", { type: "image/png" });
    await createMisskeyClient(session()).upload(file, { isSensitive: true, comment: "c" });
    const { url, init } = calls[0];
    expect(url).toBe(`${ORIGIN}/api/drive/files/create`);
    const form = init.body as FormData;
    expect(form.get("i")).toBe("sess-token");
    expect(form.get("isSensitive")).toBe("true");
    expect(form.get("comment")).toBe("c");
    expect((form.get("file") as File).name).toBe("pic.png");
    // The browser sets the multipart boundary — no manual Content-Type.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});
