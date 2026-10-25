// Repair X3.1 — cancellation end to end. Each test fails before the fix
// (raw `AbortError` propagation, or a hang when the signal is ignored) and
// passes after (typed `kind: 'aborted'`). No network: every transport takes
// an injected stub fetch.
import { ApiError } from "../src/core/errors";
import { HttpError, requestJson } from "../src/core/http";
import { MastoHttpError, request, toApiError } from "../src/mastodon/client";
import { createClient } from "../src/mastodon/client";
import { createMastodonBackend } from "../src/mastodon/backend";
import { createMisskeyClient } from "../src/misskey/client";
import { createMisskeyBackend } from "../src/misskey/backend";
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

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

/** A fetch that hangs until its signal aborts (then rejects like a real fetch). */
function hangingFetch(seen?: { signal?: AbortSignal | null }): (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response> {
  return (_url, init) => {
    if (seen) seen.signal = (init?.signal as AbortSignal | null) ?? null;
    const signal = init?.signal as AbortSignal | undefined;
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("X3.1 — caller abort surfaces as kind aborted", () => {
  it("core requestJson: aborting mid-flight rejects with kind aborted", async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const ctrl = new AbortController();
    const pending = requestJson(ORIGIN, "/api/i", {
      method: "POST",
      json: {},
      signal: ctrl.signal,
      fetchImpl: hangingFetch(seen),
    }).catch((e) => e);
    await tick();
    expect(seen.signal).not.toBeNull();
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("aborted");
    expect((err as HttpError).code).toBe("errors.network.aborted");
    expect((err as HttpError).status).toBe(0);
  });

  it("core requestJson: an already-aborted signal never succeeds", async () => {
    const err = await requestJson(ORIGIN, "/api/i", {
      method: "POST",
      json: {},
      signal: AbortSignal.abort(),
      fetchImpl: hangingFetch(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("aborted");
  });

  it("core requestJson: the timer still wins on a genuine stall (kind timeout)", async () => {
    const err = await requestJson(ORIGIN, "/api/i", {
      method: "POST",
      json: {},
      timeoutMs: 20,
      fetchImpl: hangingFetch(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).kind).toBe("timeout");
  });

  it("mastodon request: abort maps to MastoHttpError kind aborted and survives toApiError", async () => {
    const ctrl = new AbortController();
    const pending = request(ORIGIN, "/api/v1/timelines/home", {
      token: "t",
      signal: ctrl.signal,
      fetchImpl: hangingFetch(),
    }).catch((e) => e);
    await tick();
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(MastoHttpError);
    expect((err as MastoHttpError).kind).toBe("aborted");
    const api = toApiError(err);
    expect(api).toBeInstanceOf(ApiError);
    expect((api as ApiError).kind).toBe("aborted");
    expect((api as ApiError).code).toBe("errors.network.aborted");
  });

  it("mastodon backend: timeline threads the signal; abort rejects kind aborted", async () => {
    const realFetch = globalThis.fetch;
    const seen: { signal?: AbortSignal | null } = {};
    globalThis.fetch = hangingFetch(seen) as unknown as typeof fetch;
    try {
      const backend = createMastodonBackend(createClient(ORIGIN, "t"));
      const ctrl = new AbortController();
      const pending = backend.timeline("home", { signal: ctrl.signal }).catch((e) => e);
      await tick();
      // The transport linked our signal to its fetch (an internal
      // controller — identity is not preserved, abortion is).
      expect(seen.signal).not.toBeNull();
      ctrl.abort();
      const err = await pending;
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).kind).toBe("aborted");
      expect((err as ApiError).code).toBe("errors.network.aborted");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("misskey client.call: abort maps to ApiError kind aborted", async () => {
    const ctrl = new AbortController();
    const pending = createMisskeyClient(session(), { fetchImpl: hangingFetch() })
      .call("notes/timeline", { limit: 20 }, { signal: ctrl.signal })
      .catch((e) => e);
    await tick();
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("aborted");
    expect((err as ApiError).code).toBe("errors.network.aborted");
  });

  it("misskey backend: timeline threads the signal; abort rejects kind aborted", async () => {
    const transport = createMisskeyClient(session(), { fetchImpl: hangingFetch() });
    const backend = createMisskeyBackend(transport);
    const ctrl = new AbortController();
    const pending = backend.timeline("home", { signal: ctrl.signal }).catch((e) => e);
    await tick();
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("aborted");
    expect((err as ApiError).code).toBe("errors.network.aborted");
  });

  it("misskey upload: abort rejects kind aborted", async () => {
    const ctrl = new AbortController();
    const pending = createMisskeyClient(session(), { fetchImpl: hangingFetch() })
      .upload(new File(["x"], "pic.png", { type: "image/png" }), { signal: ctrl.signal })
      .catch((e) => e);
    await tick();
    ctrl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("aborted");
  });
});
