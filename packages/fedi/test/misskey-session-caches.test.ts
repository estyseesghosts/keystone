// R1.2 — per-session translate and quote caches (cross-account isolation).
//
// Audit `results/01` B3: module-global maps in `misskey/translate`,
// `misskey/quote` (and the permanent negative cache in
// `misskey/remotepost`) leaked translations, failure suppressions, and
// credentialed `Post`s across sessions. These tests pin the fix: translator
// state and quote resolver state are instance-owned, failed quote lookups
// retry after a TTL, and negative remote-post resolutions retry too.
//
// Transports are stubbed — no network, no rig.

import { ApiError } from "../src/core/errors";
import type { WireCall } from "../src/misskey/client";
import type { Note } from "../src/misskey/wire";
import { createMisskeyBackend, type MisskeyTransport } from "../src/misskey/backend";
import {
  QUOTE_LOOKUP_FAILURE_TTL_MS,
  createQuoteResolver,
} from "../src/misskey/quote";
import {
  REMOTE_POST_NEGATIVE_TTL_MS,
  cachedRemotePostUrl,
  resolveRemotePostUrl,
} from "../src/misskey/remotepost";
import {
  TRANSLATION_FAILURE_TTL_MS,
  createTranslator,
} from "../src/misskey/translate";
import { fixture, postFromWire } from "./helpers";

const wireNote = (): Note =>
  JSON.parse(JSON.stringify(fixture<Note>("misskey/note.json")));

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

function misskeyTranslator(respond: (endpoint: string, params: Record<string, unknown>) => unknown) {
  const { call, calls } = stubCall(respond);
  const translator = createTranslator({ family: "misskey", call });
  return { translator, calls };
}

const translateCalls = (calls: RecordedCall[]) =>
  calls.filter((c) => c.endpoint === "notes/translate");

// --- translator isolation ---------------------------------------------------

describe("R1.2 translator instances share nothing", () => {
  it("B does not observe A's cached hit (same note id, different results)", async () => {
    const a = misskeyTranslator((endpoint) =>
      endpoint === "meta"
        ? { translatorAvailable: true }
        : { sourceLang: "Chinese", text: "A translation" },
    );
    const b = misskeyTranslator((endpoint) =>
      endpoint === "meta"
        ? { translatorAvailable: true }
        : { sourceLang: "German", text: "B translation" },
    );
    await expect(a.translator.translatorAvailable()).resolves.toBe(true);
    await expect(b.translator.translatorAvailable()).resolves.toBe(true);

    await expect(a.translator.requestTranslation("n1", "en")).resolves.toEqual({
      sourceLang: "Chinese",
      text: "A translation",
    });
    expect(translateCalls(a.calls)).toHaveLength(1);

    // Same note id under B must hit B's own wire, not A's cache.
    await expect(b.translator.requestTranslation("n1", "en")).resolves.toEqual({
      sourceLang: "German",
      text: "B translation",
    });
    expect(translateCalls(b.calls)).toHaveLength(1);
    expect(translateCalls(a.calls)).toHaveLength(1);
  });

  it("A's failure suppression does not silence B; retry refetches on the same instance", async () => {
    const failing = () => {
      throw new ApiError("boom", 500, "INTERNAL_ERROR");
    };
    const a = misskeyTranslator((endpoint) =>
      endpoint === "meta" ? { translatorAvailable: true } : failing(),
    );
    const b = misskeyTranslator((endpoint) =>
      endpoint === "meta"
        ? { translatorAvailable: true }
        : { sourceLang: "Chinese", text: "B translation" },
    );
    await a.translator.translatorAvailable();
    await b.translator.translatorAvailable();

    await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(a.calls)).toHaveLength(1);
    // Still inside the TTL: no second wire call.
    await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(a.calls)).toHaveLength(1);

    // B is unaffected by A's suppression.
    await expect(b.translator.requestTranslation("n1", "en")).resolves.toEqual({
      sourceLang: "Chinese",
      text: "B translation",
    });
    expect(translateCalls(b.calls)).toHaveLength(1);

    // A retry clears A's suppression and refetches.
    expect(a.translator.translationRetryCount("n1")).toBe(0);
    a.translator.retryTranslation("n1");
    expect(a.translator.translationRetryCount("n1")).toBe(1);
    await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(a.calls)).toHaveLength(2);
  });

  it("outcome bus is per-instance", async () => {
    const ok = misskeyTranslator(() => ({ translatorAvailable: true }));
    const other = misskeyTranslator(() => ({ translatorAvailable: true }));
    const seenByOther: string[] = [];
    const unsub = other.translator.onTranslationMetaChange((id) => seenByOther.push(id));
    try {
      ok.translator.reportTranslationOutcome("n1", "loaded");
      expect(ok.translator.translationOutcome("n1")).toBe("loaded");
      expect(other.translator.translationOutcome("n1")).toBeUndefined();
      expect(seenByOther).toEqual([]);

      other.translator.reportTranslationOutcome("n1", "unchanged");
      expect(seenByOther).toEqual(["n1"]);
      expect(ok.translator.translationOutcome("n1")).toBe("loaded");
    } finally {
      unsub();
    }
  });

  it("suppression expires after TRANSLATION_FAILURE_TTL_MS (fake timers)", async () => {
    jest.useFakeTimers();
    try {
      const a = misskeyTranslator((endpoint) => {
        if (endpoint === "meta") return { translatorAvailable: true };
        throw new ApiError("boom", 500, "INTERNAL_ERROR");
      });
      await a.translator.translatorAvailable();
      await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
      expect(translateCalls(a.calls)).toHaveLength(1);

      jest.advanceTimersByTime(TRANSLATION_FAILURE_TTL_MS - 1);
      await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
      expect(translateCalls(a.calls)).toHaveLength(1);

      jest.advanceTimersByTime(2);
      await expect(a.translator.requestTranslation("n1", "en")).resolves.toBeNull();
      expect(translateCalls(a.calls)).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("one instance keys entries by (noteId, targetLang): lang B refetches after lang A cached", async () => {
    const { translator, calls } = misskeyTranslator((endpoint, params) => {
      if (endpoint === "meta") return { translatorAvailable: true };
      if (endpoint !== "notes/translate") throw new Error(`unexpected ${endpoint}`);
      return params.targetLang === "fr"
        ? { sourceLang: "Chinois", text: "texte français" }
        : { sourceLang: "Chinese", text: "English text" };
    });
    await translator.translatorAvailable();

    // Lang A caches under its own entry.
    await expect(translator.requestTranslation("n1", "en")).resolves.toEqual({
      sourceLang: "Chinese",
      text: "English text",
    });
    expect(translateCalls(calls)).toHaveLength(1);

    // Same note, second viewer language: must NOT serve lang A's entry.
    await expect(translator.requestTranslation("n1", "fr")).resolves.toEqual({
      sourceLang: "Chinois",
      text: "texte français",
    });
    expect(translateCalls(calls)).toHaveLength(2);
    expect(translateCalls(calls).map((c) => c.params.targetLang)).toEqual(["en", "fr"]);

    // Both entries settle: repeats are served from the cache, no refetch.
    await expect(translator.requestTranslation("n1", "en")).resolves.toEqual({
      sourceLang: "Chinese",
      text: "English text",
    });
    await expect(translator.requestTranslation("n1", "fr")).resolves.toEqual({
      sourceLang: "Chinois",
      text: "texte français",
    });
    expect(translateCalls(calls)).toHaveLength(2);
  });

  it("failure suppression is per (noteId, targetLang): lang A failing leaves lang B live", async () => {
    const { translator, calls } = misskeyTranslator((endpoint, params) => {
      if (endpoint === "meta") return { translatorAvailable: true };
      if (endpoint !== "notes/translate") throw new Error(`unexpected ${endpoint}`);
      if (params.targetLang === "en") throw new ApiError("boom", 500, "INTERNAL_ERROR");
      return { sourceLang: "Chinois", text: "texte français" };
    });
    await translator.translatorAvailable();

    await expect(translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(calls)).toHaveLength(1);
    // Suppressed for "en"...
    await expect(translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(calls)).toHaveLength(1);
    // ...but "fr" fetches and succeeds on the same instance.
    await expect(translator.requestTranslation("n1", "fr")).resolves.toEqual({
      sourceLang: "Chinois",
      text: "texte français",
    });
    expect(translateCalls(calls)).toHaveLength(2);

    // A no-language retry addresses the default ("en") entry only: "en"
    // refetches while the settled "fr" entry is undisturbed.
    translator.retryTranslation("n1");
    await expect(translator.requestTranslation("n1", "en")).resolves.toBeNull();
    expect(translateCalls(calls)).toHaveLength(3);
    await expect(translator.requestTranslation("n1", "fr")).resolves.toEqual({
      sourceLang: "Chinois",
      text: "texte français",
    });
    expect(translateCalls(calls)).toHaveLength(3);
  });

  it("outcome/retry bus is per (noteId, targetLang) with a backward-compatible default", () => {
    const { translator } = misskeyTranslator(() => ({ translatorAvailable: true }));
    const seen: Array<[string, string | undefined]> = [];
    const unsub = translator.onTranslationMetaChange((id, lang) => seen.push([id, lang]));
    try {
      // No-language writes land on the "en" entry, as before.
      translator.reportTranslationOutcome("n1", "loaded");
      expect(translator.translationOutcome("n1")).toBe("loaded");
      expect(translator.translationOutcome("n1", "en")).toBe("loaded");
      // Another viewer language starts undefined.
      expect(translator.translationOutcome("n1", "fr")).toBeUndefined();
      translator.reportTranslationOutcome("n1", "unchanged", "fr");
      expect(translator.translationOutcome("n1", "fr")).toBe("unchanged");
      expect(translator.translationOutcome("n1")).toBe("loaded");
      expect(seen).toEqual([
        ["n1", "en"],
        ["n1", "fr"],
      ]);

      expect(translator.translationRetryCount("n1")).toBe(0);
      translator.retryTranslation("n1", "fr");
      expect(translator.translationRetryCount("n1", "fr")).toBe(1);
      expect(translator.translationRetryCount("n1")).toBe(0);
    } finally {
      unsub();
    }
  });
});

// --- quote resolver isolation -------------------------------------------------

describe("R1.2 quote resolvers share nothing", () => {
  const URI = "https://misskey.example.com/notes/9fz3examplenote0001";

  function apShowOk() {
    const note = wireNote();
    return stubCall((endpoint) => {
      if (endpoint !== "ap/show") throw new Error(`unexpected ${endpoint}`);
      return { type: "Note", object: note };
    });
  }

  function apShowDenied() {
    return stubCall(() => {
      throw new ApiError("forbidden", 403, "FORBIDDEN");
    });
  }

  it("B never receives A's resolved Post for the same URI", async () => {
    const { call: callA, calls: callsA } = apShowOk();
    const { call: callB, calls: callsB } = apShowDenied();
    const resolverA = createQuoteResolver(callA);
    const resolverB = createQuoteResolver(callB);

    const foundA = await resolverA.resolveQuoteUri(URI);
    expect(foundA?.id).toBe(wireNote().id);

    // Same URI under B's credentials: B's own transport denies — no leak.
    await expect(resolverB.resolveQuoteUri(URI)).resolves.toBeNull();
    expect(callsB.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);
    // A still serves its own cached Post without refetching.
    await expect(resolverA.resolveQuoteUri(URI)).resolves.toBe(foundA);
    expect(callsA.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);
  });

  it("seen notes are per-resolver", async () => {
    const { call: callA } = apShowDenied();
    const { call: callB, calls: callsB } = apShowOk();
    const resolverA = createQuoteResolver(callA);
    const resolverB = createQuoteResolver(callB);

    resolverA.registerSeenNote(postFromWire(wireNote()));
    // A serves the seen note with zero wire calls (denying transport never fires).
    await expect(resolverA.resolveQuoteUri(URI)).resolves.toMatchObject({
      id: wireNote().id,
    });
    // B knows nothing of A's seen set: it fetches through its own transport.
    const foundB = await resolverB.resolveQuoteUri(URI);
    expect(foundB?.id).toBe(wireNote().id);
    expect(callsB.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);
  });

  it("failed lookups stay retryable after the TTL (fake timers)", async () => {
    jest.useFakeTimers();
    try {
      const { call, calls } = apShowDenied();
      const resolver = createQuoteResolver(call);
      await expect(resolver.resolveQuoteUri(URI)).resolves.toBeNull();
      expect(calls.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);

      // Suppressed: no refetch.
      await expect(resolver.resolveQuoteUri(URI)).resolves.toBeNull();
      expect(calls.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);

      jest.advanceTimersByTime(QUOTE_LOOKUP_FAILURE_TTL_MS + 1);
      await expect(resolver.resolveQuoteUri(URI)).resolves.toBeNull();
      expect(calls.filter((c) => c.endpoint === "ap/show")).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("per-backend caches isolate sessions at the factory level", async () => {
    const note = wireNote();
    const mkTransport = (
      respond: (endpoint: string, params: Record<string, unknown>) => unknown,
    ): { transport: MisskeyTransport; calls: RecordedCall[] } => {
      const { call, calls } = stubCall(respond);
      return {
        calls,
        transport: {
          call,
          upload: (() => Promise.resolve({})) as MisskeyTransport["upload"],
        },
      };
    };
    const tA = mkTransport((endpoint) => {
      if (endpoint !== "ap/show") throw new Error(`unexpected ${endpoint}`);
      return { type: "Note", object: note };
    });
    const tB = mkTransport(() => {
      throw new ApiError("forbidden", 403, "FORBIDDEN");
    });
    const backendA = createMisskeyBackend(tA.transport);
    const backendB = createMisskeyBackend(tB.transport);

    await expect(backendA.resolveQuoteUri(URI)).resolves.toMatchObject({ id: note.id });
    await expect(backendB.resolveQuoteUri(URI)).resolves.toBeNull();
    // Same-backend repeat is served from that backend's cache.
    await expect(backendA.resolveQuoteUri(URI)).resolves.toMatchObject({ id: note.id });
    expect(tA.calls.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);
    expect(tB.calls.filter((c) => c.endpoint === "ap/show")).toHaveLength(1);
  });
});

// --- remotepost negatives retry -------------------------------------------------

describe("R1.2 remotepost negatives expire", () => {
  const URI = "https://remote.example/notes/r1-negative-ttl-unique";

  it("a failed resolution refetches after REMOTE_POST_NEGATIVE_TTL_MS (fake timers)", async () => {
    jest.useFakeTimers();
    const realFetch = globalThis.fetch;
    let mode: "fail" | "ok" = "fail";
    try {
      (globalThis as { fetch: unknown }).fetch = async () => {
        if (mode === "fail") throw new Error("network down");
        return {
          ok: true,
          json: async () => ({ id: URI, url: "https://remote.example/@u/1" }),
        };
      };
      expect(cachedRemotePostUrl(URI)).toBeNull();
      await expect(resolveRemotePostUrl(URI)).resolves.toBeNull();
      expect(cachedRemotePostUrl(URI)).toBeNull();

      // Still fresh: no second fetch.
      let fetches = 0;
      const counting = globalThis.fetch;
      (globalThis as { fetch: unknown }).fetch = async (...args: unknown[]) => {
        fetches += 1;
        return (counting as (...a: unknown[]) => Promise<unknown>)(...args);
      };
      await expect(resolveRemotePostUrl(URI)).resolves.toBeNull();
      expect(fetches).toBe(0);

      // After the TTL the negative expires and the recovery is picked up.
      jest.advanceTimersByTime(REMOTE_POST_NEGATIVE_TTL_MS + 1);
      mode = "ok";
      await expect(resolveRemotePostUrl(URI)).resolves.toBe(
        "https://remote.example/@u/1",
      );
      expect(cachedRemotePostUrl(URI)).toBe("https://remote.example/@u/1");
    } finally {
      globalThis.fetch = realFetch;
      jest.useRealTimers();
    }
  });
});
