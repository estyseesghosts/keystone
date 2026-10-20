// Session-bound routing contract (converted from old Keystone
// `test/client-routing.test.ts`, 23 tests — counts match, table in the
// slice log).
//
// The old file pinned the facade against ambient globals (`location`,
// `localStorage`, the Vite backend id, legacy external readers). This port
// pins the SAME contract against the pure-TS facade (`src/api/client.ts`):
// every function takes the `KeyValueStore` + `HomeSpec` explicitly, and
// sessions are built with `saveSession` + `setActiveSessionId` — the exact
// shape a post-flip profile carries. Two legacy-reader tests are adapted
// (see notes): the new store has no legacy readers by design.
//
// Jest port: globals (`describe/it/expect/beforeEach/afterEach`, no vitest
// import); `vi.stubGlobal("fetch", …)` becomes a direct `globalThis.fetch`
// swap with restore (the `http.test.ts` pattern); `vi.fn` → `jest.fn`.
import {
  activeBackend,
  activeFamily,
  adoptInternalAccount,
  apiCall,
  apiCallInternal,
  apiCallPublic,
  clearStoredToken,
  getToken,
  setStoredToken,
  type HomeSpec,
} from "../src/api/client";
import {
  createMemoryStore,
  loadSessions,
  migrateLegacySessions,
  rekeySession,
  removeLegacyKeys,
  saveSession,
  sessionId,
  setActiveSessionId,
  UNKNOWN_ACCOUNT_ID,
  type KeyValueStore,
  type Session,
} from "../src/core/sessions";

const HOME_ORIGIN = "https://app.example";
const HOME: HomeSpec = { origin: HOME_ORIGIN, family: "misskey", flavor: "pinetree" };

let store: KeyValueStore;

interface Call {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function storeInternal(token: string): void {
  saveSession(
    store,
    {
      id: sessionId(HOME_ORIGIN, UNKNOWN_ACCOUNT_ID),
      origin: HOME_ORIGIN,
      family: "misskey",
      flavor: "pinetree",
      accountId: UNKNOWN_ACCOUNT_ID,
      token,
      grant: "password",
      hosting: "first-party",
    },
    HOME_ORIGIN,
  );
}

function accountRow(userId: string, host: string): Session["user"] {
  return {
    id: userId,
    username: "jm",
    name: null,
    host,
    acct: `jm@${host}`,
    displayName: "jm",
    bio: { plain: "" },
    url: null,
    uri: null,
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    followersCount: 0,
    followingCount: 0,
    statusesCount: 0,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [],
    movedTo: null,
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
  };
}

function storeExternal(host: string, token: string, userId = "u42"): void {
  const origin = `https://${host}`;
  saveSession(
    store,
    {
      id: sessionId(origin, userId),
      origin,
      family: "misskey",
      flavor: "unknown",
      accountId: userId,
      token,
      grant: "miauth",
      hosting: "third-party",
      user: accountRow(userId, host),
    },
    HOME_ORIGIN,
  );
  setActiveSessionId(store, sessionId(origin, userId), HOME_ORIGIN);
}

beforeEach(() => {
  store = createMemoryStore();
  storeInternal("internal-token");
});

describe("internal routing", () => {
  it("apiCall without an active account goes through the same-origin home path", async () => {
    const calls = stubFetch(() => Promise.resolve(json({ id: "n1" })));
    await apiCall(store, HOME, "notes/create", { text: "hi" });
    expect(calls[0].url).toBe(`${HOME_ORIGIN}/api/notes/create`);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("internal-token");
  });

  it("apiCallPublic sends no credential", async () => {
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCallPublic(store, HOME, "signin-flow", { username: "u" });
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBeUndefined();
  });
});

describe("external routing", () => {
  it("apiCall goes direct to the external origin with the external token", async () => {
    storeExternal("dvd.chat", "ext-token");
    const calls = stubFetch(() => Promise.resolve(json({ id: "n2" })));
    await apiCall(store, HOME, "notes/create", { text: "hi" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://dvd.chat/api/notes/create");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("ext-token");
  });

  it("an external token never reaches the internal backend", async () => {
    storeExternal("dvd.chat", "ext-token");
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(store, HOME, "i", {});
    expect(calls.every((c) => !c.url.startsWith(HOME_ORIGIN))).toBe(true);
  });

  it("apiCallInternal still targets the home backend while external is active", async () => {
    storeExternal("dvd.chat", "ext-token");
    const calls = stubFetch(() => Promise.resolve(json({ id: "me" })));
    await apiCallInternal(store, HOME, "i", {});
    expect(calls[0].url).toBe(`${HOME_ORIGIN}/api/i`);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("internal-token"); // internal token, never the external one
  });

  it("the internal token never reaches the external origin", async () => {
    storeExternal("dvd.chat", "ext-token");
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(store, HOME, "i", {});
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("ext-token");
    expect(String(calls[0].init.body)).not.toContain("internal-token");
  });

  it("a stale active pointer falls back to the internal path", async () => {
    setActiveSessionId(store, "https://gone.example u99", HOME_ORIGIN);
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(store, HOME, "i", {});
    expect(calls[0].url).toBe(`${HOME_ORIGIN}/api/i`);
  });
});

describe("token store (per-origin session isolation)", () => {
  it("set/get/clear round-trips through keystone_sessions", () => {
    clearStoredToken(store, HOME_ORIGIN);
    expect(getToken(store, HOME_ORIGIN)).toBeNull();
    setStoredToken(store, HOME_ORIGIN, "fresh");
    expect(getToken(store, HOME_ORIGIN)).toBe("fresh");
    clearStoredToken(store, HOME_ORIGIN);
    expect(getToken(store, HOME_ORIGIN)).toBeNull();
  });

  it("tokens are keyed per origin: a second origin never leaks into the first", () => {
    // Adapted from the old `pinetree_token` fallback test: the new store
    // has no legacy fallback keys — isolation between origins IS the
    // guarantee, and it holds at the store level.
    storeExternal("dvd.chat", "ext-token");
    expect(getToken(store, HOME_ORIGIN)).toBe("internal-token");
    clearStoredToken(store, HOME_ORIGIN);
    expect(getToken(store, HOME_ORIGIN)).toBeNull();
    // The external session survives the internal clear untouched.
    expect(loadSessions(store, HOME_ORIGIN).map((s) => s.id)).toContain(
      sessionId("https://dvd.chat", "u42"),
    );
  });
});

describe("auth on the unified session store", () => {
  it("token storage round-trips through keystone_sessions", () => {
    const fresh = createMemoryStore();
    saveSession(
      fresh,
      {
        id: sessionId(HOME_ORIGIN, UNKNOWN_ACCOUNT_ID),
        origin: HOME_ORIGIN,
        family: "misskey",
        flavor: "pinetree",
        accountId: UNKNOWN_ACCOUNT_ID,
        token: "store-token",
        grant: "password",
        hosting: "first-party",
      },
      HOME_ORIGIN,
    );
    expect(getToken(fresh, HOME_ORIGIN)).toBe("store-token");
    expect(fresh.getItem("keystone_sessions")).toContain("store-token");
    clearStoredToken(fresh, HOME_ORIGIN);
    expect(getToken(fresh, HOME_ORIGIN)).toBeNull();
  });

  it("setStoredToken writes the store, not a legacy key", () => {
    const fresh = createMemoryStore();
    setStoredToken(fresh, HOME_ORIGIN, "fresh");
    expect(getToken(fresh, HOME_ORIGIN)).toBe("fresh");
    expect(fresh.getItem("keystone_token_pinetree")).toBeNull();
    expect(fresh.getItem("pinetree_token")).toBeNull();
  });

  it("internal routing works from store sessions alone (no legacy keys)", async () => {
    const fresh = createMemoryStore();
    setStoredToken(fresh, HOME_ORIGIN, "store-internal");
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(fresh, HOME, "i", {});
    expect(calls[0].url).toBe(`${HOME_ORIGIN}/api/i`);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("store-internal");
  });

  it("a store external session routes direct; tokens stay per-origin", async () => {
    const fresh = createMemoryStore();
    const inner = {
      id: sessionId(HOME_ORIGIN, UNKNOWN_ACCOUNT_ID),
      origin: HOME_ORIGIN,
      family: "misskey" as const,
      flavor: "pinetree" as const,
      accountId: UNKNOWN_ACCOUNT_ID,
      token: "store-internal",
      grant: "password" as const,
      hosting: "first-party" as const,
    };
    saveSession(fresh, inner, HOME_ORIGIN);
    saveSession(
      fresh,
      {
        id: sessionId("https://dvd.chat", "u42"),
        origin: "https://dvd.chat",
        family: "misskey",
        flavor: "unknown",
        accountId: "u42",
        token: "store-ext",
        grant: "miauth",
        hosting: "third-party",
      },
      HOME_ORIGIN,
    );
    setActiveSessionId(fresh, sessionId("https://dvd.chat", "u42"), HOME_ORIGIN);
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(fresh, HOME, "i", {});
    expect(calls[0].url).toBe("https://dvd.chat/api/i");
    const extBody = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(extBody.i).toBe("store-ext");
    expect(String(calls[0].init.body)).not.toContain("store-internal");

    const internalCalls = stubFetch(() => Promise.resolve(json({})));
    await apiCallInternal(fresh, HOME, "i", {});
    const intBody = JSON.parse(String(internalCalls[0].init.body)) as Record<string, unknown>;
    expect(intBody.i).toBe("store-internal");
    expect(String(internalCalls[0].init.body)).not.toContain("store-ext");
  });

  it("the flip removes the legacy keys and keeps routing intact", async () => {
    const fresh = createMemoryStore();
    fresh.setItem("keystone_token_pinetree", "internal-token");
    fresh.setItem("pinetree_token", "older-legacy");
    // Boot sequence: migrate -> removeLegacyKeys.
    migrateLegacySessions(fresh, HOME_ORIGIN);
    removeLegacyKeys(fresh);
    for (const key of [
      "keystone_token_pinetree",
      "pinetree_token",
      "keystone_external_sessions",
      "keystone_active_external",
    ]) {
      expect(fresh.getItem(key)).toBeNull();
    }
    const calls = stubFetch(() => Promise.resolve(json({})));
    await apiCall(fresh, HOME, "i", {});
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.i).toBe("internal-token");
  });

  it("legacy external sessions migrate with their account id and route direct", () => {
    // Adapted: the old test read the cached user back through the legacy
    // `loadExternalSessions` reader. The new store has no legacy readers
    // by design — migration carries the account id + origin + token, and
    // the profile refetches (`i` / `verify_credentials`) on demand.
    const fresh = createMemoryStore();
    fresh.setItem(
      "keystone_external_sessions",
      JSON.stringify([
        {
          host: "dvd.chat",
          scheme: "https",
          token: "ext-token",
          user: { id: "u42", username: "jm", name: "JM Example", host: "dvd.chat" },
        },
      ]),
    );
    fresh.setItem("keystone_active_external", "dvd.chat");
    migrateLegacySessions(fresh, HOME_ORIGIN);
    removeLegacyKeys(fresh);
    const sessions = loadSessions(fresh, HOME_ORIGIN);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId("https://dvd.chat", "u42"));
    expect(sessions[0].token).toBe("ext-token");
  });

  it("the internal session re-keys to the real account id after `i`", () => {
    const fresh = createMemoryStore();
    setStoredToken(fresh, HOME_ORIGIN, "store-token");
    expect(getToken(fresh, HOME_ORIGIN)).toBe("store-token");
    adoptInternalAccount(fresh, HOME_ORIGIN, "u1");
    expect(loadSessions(fresh, HOME_ORIGIN).map((s) => s.id)).toContain(
      sessionId(HOME_ORIGIN, "u1"),
    );
    expect(getToken(fresh, HOME_ORIGIN)).toBe("store-token"); // the token survives the re-key
  });
});

// --- Family routing ------------------------------------------------------------
//
// The ACTIVE session's family picks the Backend: Mastodon-family sessions
// get the Mastodon backend, everything else the Misskey backend. This is
// the contract behind "a Misskey and a Mastodon account switched between
// in one tab".

function storeMastodonSession(
  target: KeyValueStore,
  host: string,
  token: string,
  flavor: "mastodon" | "akkoma" = "mastodon",
): void {
  const origin = `https://${host}`;
  saveSession(
    target,
    {
      id: sessionId(origin, "u7"),
      origin,
      family: "mastodon",
      flavor,
      accountId: "u7",
      token,
      grant: "oauth-pkce",
      hosting: "third-party",
      user: accountRow("u7", host),
    },
    HOME_ORIGIN,
  );
  setActiveSessionId(target, sessionId(origin, "u7"), HOME_ORIGIN);
}

describe("family routing", () => {
  it("signed out on the home backend, activeBackend is the Misskey one", () => {
    const fresh = createMemoryStore();
    expect(activeFamily(fresh, HOME)).toBe("misskey");
    expect(activeBackend(fresh, HOME).family).toBe("misskey");
  });

  it("a Mastodon-family session routes to the MastodonBackend with its flavor", () => {
    const fresh = createMemoryStore();
    storeMastodonSession(fresh, "mastodon.example", "mt", "akkoma");
    expect(activeFamily(fresh, HOME)).toBe("mastodon");
    const backend = activeBackend(fresh, HOME);
    expect(backend.family).toBe("mastodon");
    // Flavor evidence reaches the capability table (Akkoma reactions).
    expect(backend.capabilities.reactions).toBe("supported");
  });

  it("vanilla Mastodon capabilities stay conservative", () => {
    const fresh = createMemoryStore();
    storeMastodonSession(fresh, "mastodon.example", "mt", "mastodon");
    const backend = activeBackend(fresh, HOME);
    expect(backend.family).toBe("mastodon");
    expect(backend.capabilities.reactions).toBe("unsupported");
    expect(backend.capabilities.favourites_distinct_from_reactions).toBe("supported");
  });

  it("switching accounts switches the backend — one tab, both families", () => {
    const fresh = createMemoryStore();
    // A Misskey-family external session and a Mastodon-family one coexist.
    saveSession(
      fresh,
      {
        id: sessionId("https://dvd.chat", "u42"),
        origin: "https://dvd.chat",
        family: "misskey",
        flavor: "unknown",
        accountId: "u42",
        token: "mk",
        grant: "miauth",
        hosting: "third-party",
      },
      HOME_ORIGIN,
    );
    storeMastodonSession(fresh, "mastodon.example", "mt");
    expect(activeBackend(fresh, HOME).family).toBe("mastodon");
    setActiveSessionId(fresh, sessionId("https://dvd.chat", "u42"), HOME_ORIGIN);
    expect(activeFamily(fresh, HOME)).toBe("misskey");
    expect(activeBackend(fresh, HOME).family).toBe("misskey");
  });

  it("Mastodon calls go to the session's own origin with its Bearer token", async () => {
    const fresh = createMemoryStore();
    storeMastodonSession(fresh, "mastodon.example", "mt-secret");
    const calls = stubFetch(async (url) => {
      if (String(url).includes("verify_credentials")) {
        return json({ id: "u7", username: "toot", acct: "toot", display_name: "" });
      }
      return json({ error: "nope" }, 500);
    });
    await activeBackend(fresh, HOME).me();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mastodon.example/api/v1/accounts/verify_credentials");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mt-secret");
    // Never the home path — and the token never leaves its origin.
    expect(calls.some((c) => c.url.startsWith(HOME_ORIGIN))).toBe(false);
  });

  it("the Mastodon transport resolves its session per call and fails closed", async () => {
    const fresh = createMemoryStore();
    storeMastodonSession(fresh, "mastodon.example", "mt");
    const backend = activeBackend(fresh, HOME); // bound to the ACTIVE session, resolved per call
    expect(backend.family).toBe("mastodon");
    // Switch away: the captured backend must now fail closed — no request
    // fires with a missing/wrong session.
    setActiveSessionId(fresh, null, HOME_ORIGIN);
    const calls = stubFetch(async () => json({}));
    await expect(backend.me()).rejects.toThrow(/Mastodon-family/i);
    expect(calls).toHaveLength(0);
  });

  it("a Mastodon session keeps the Misskey apiCall path off its origin", async () => {
    const fresh = createMemoryStore();
    storeMastodonSession(fresh, "mastodon.example", "mt-secret");
    const calls = stubFetch(async () => json({}));
    // The family router sends Misskey-family traffic nowhere while a
    // Mastodon account is active: apiCall throws before any I/O.
    await expect(apiCall(fresh, HOME, "i", {})).rejects.toThrow(/Misskey-family/);
    expect(activeBackend(fresh, HOME).family).toBe("mastodon");
    expect(calls).toHaveLength(0);
  });
});
