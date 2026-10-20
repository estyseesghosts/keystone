// Phase 1 item C — `src/core/sessions.ts`: the unified session store and,
// above all, the LEGACY KEY MIGRATION. Covered: each old key migrating,
// multiple old keys coexisting, a second load not re-migrating
// (idempotent), and corrupt/unknown values being dropped rather than
// crashing.
//
// Jest port: `beforeEach/describe/it/expect` are globals (no vitest
// import); `vi.fn` → `jest.fn`. Storage goes through the injected
// `KeyValueStore` (a fresh `createMemoryStore()` per test, replacing the
// old `localStorage.clear()`), and the internal-token migration origin is
// the explicit `ORIGIN` constant (replacing the old `location.origin`).
import {
  LEGACY_KEYS,
  OAUTH_APPS_KEY,
  SESSIONS_KEY,
  UNKNOWN_ACCOUNT_ID,
  createMemoryStore,
  findSession,
  getActiveSession,
  getActiveSessionId,
  loadSessions,
  migrateLegacySessions,
  removeLegacyKeys,
  removeSession,
  rekeySession,
  revokeSessionToken,
  saveSession,
  sessionId,
  setActiveSessionId,
  type KeyValueStore,
  type Session,
} from "../src/core/sessions";

const ORIGIN = "https://app.example";

let store: KeyValueStore;

beforeEach(() => {
  store = createMemoryStore();
});

function setJson(key: string, value: unknown): void {
  store.setItem(key, JSON.stringify(value));
}

const internal = (over: Partial<Session> = {}): Session => ({
  id: sessionId(ORIGIN, "acc1"),
  origin: ORIGIN,
  family: "misskey",
  flavor: "misskey",
  accountId: "acc1",
  token: "tok-internal",
  grant: "password",
  hosting: "first-party",
  ...over,
});

describe("migration: each legacy key", () => {
  it("keystone_token_misskey migrates as a first-party Misskey session", () => {
    store.setItem("keystone_token_misskey", "mk-token");
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions).toEqual([
      {
        id: `${ORIGIN} ${UNKNOWN_ACCOUNT_ID}`,
        origin: ORIGIN,
        family: "misskey",
        flavor: "misskey",
        accountId: UNKNOWN_ACCOUNT_ID,
        token: "mk-token",
        grant: "password",
        hosting: "first-party",
      },
    ]);
  });

  it("keystone_token_sharkey / keystone_token_pinetree carry their flavor", () => {
    store.setItem("keystone_token_sharkey", "sk-token");
    store.setItem("keystone_token_pinetree", "pt-token");
    const sessions = migrateLegacySessions(store, ORIGIN);
    // Same placeholder (origin, accountId): first key wins, the legacy keys
    // remain in the store so no credential is lost (copy-only migration).
    expect(sessions.length).toBe(1);
    expect(sessions[0].flavor).toBe("sharkey");
    expect(sessions[0].token).toBe("sk-token");
    expect(store.getItem("keystone_token_pinetree")).toBe("pt-token");
  });

  it("legacy pinetree_token migrates", () => {
    store.setItem("pinetree_token", "old-pt");
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions[0]).toMatchObject({
      flavor: "pinetree",
      token: "old-pt",
      family: "misskey",
    });
  });

  it("keystone_external_sessions migrates per account at its own origin", () => {
    setJson("keystone_external_sessions", [
      {
        host: "dvd.chat",
        scheme: "https",
        token: "ext-token",
        user: { id: "u42", username: "jm" },
      },
    ]);
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions).toEqual([
      {
        id: "https://dvd.chat u42",
        origin: "https://dvd.chat",
        family: "misskey",
        flavor: "unknown",
        accountId: "u42",
        token: "ext-token",
        grant: "miauth",
        hosting: "third-party",
      },
    ]);
  });

  it("keystodon_masto_sessions migrates as Mastodon sessions", () => {
    setJson("keystodon_masto_sessions", [
      {
        id: "https://mastodon.example 7",
        origin: "https://mastodon.example",
        kind: "external",
        token: "masto-token",
        account: { id: "7", username: "alice" },
        createdAt: 1,
      },
      {
        id: `${ORIGIN} 9`,
        origin: ORIGIN,
        kind: "internal",
        token: "masto-internal",
        account: { id: "9", username: "bob" },
        createdAt: 2,
      },
    ]);
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions.map((s) => [s.id, s.family, s.hosting, s.grant])).toEqual([
      ["https://mastodon.example 7", "mastodon", "third-party", "oauth-pkce"],
      [`${ORIGIN} 9`, "mastodon", "first-party", "oauth-pkce"],
    ]);
  });

  it("keystodon_masto_apps migrates to keystone_apps", () => {
    setJson("keystodon_masto_apps", {
      "https://mastodon.example": {
        origin: "https://mastodon.example",
        client_id: "cid",
        client_secret: "csec",
      },
    });
    migrateLegacySessions(store, ORIGIN);
    expect(JSON.parse(store.getItem(OAUTH_APPS_KEY) ?? "{}")).toEqual({
      "https://mastodon.example": {
        origin: "https://mastodon.example",
        client_id: "cid",
        client_secret: "csec",
      },
    });
  });
});

describe("migration: coexistence and active pointers", () => {
  it("multiple legacy keys coexist; ids stay per (origin, account)", () => {
    store.setItem("keystone_token_misskey", "mk-token");
    setJson("keystone_external_sessions", [
      { host: "dvd.chat", scheme: "https", token: "ext", user: { id: "u42" } },
    ]);
    setJson("keystodon_masto_sessions", [
      {
        origin: "https://mastodon.example",
        kind: "external",
        token: "masto",
        account: { id: "7" },
      },
    ]);
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions.map((s) => s.id).sort()).toEqual(
      [
        `${ORIGIN} ${UNKNOWN_ACCOUNT_ID}`,
        "https://dvd.chat u42",
        "https://mastodon.example 7",
      ].sort(),
    );
    // Every session is independently retrievable by its key.
    expect(findSession(store, "https://dvd.chat u42")?.token).toBe("ext");
    expect(findSession(store, "https://mastodon.example 7")?.token).toBe("masto");
    expect(findSession(store, `${ORIGIN} ${UNKNOWN_ACCOUNT_ID}`)?.token).toBe("mk-token");
  });

  it("keystone_active_external points at the migrated host's session", () => {
    setJson("keystone_external_sessions", [
      { host: "dvd.chat", scheme: "https", token: "ext", user: { id: "u42" } },
    ]);
    store.setItem("keystone_active_external", "dvd.chat");
    migrateLegacySessions(store, ORIGIN);
    expect(getActiveSessionId(store)).toBe("https://dvd.chat u42");
    expect(getActiveSession(store)?.token).toBe("ext");
  });

  it("keystodon_active_masto is honoured when no external pointer exists", () => {
    setJson("keystodon_masto_sessions", [
      {
        origin: "https://mastodon.example",
        kind: "external",
        token: "masto",
        account: { id: "7" },
      },
    ]);
    store.setItem("keystodon_active_masto", "https://mastodon.example 7");
    migrateLegacySessions(store, ORIGIN);
    expect(getActiveSessionId(store)).toBe("https://mastodon.example 7");
  });

  it("the Keystone external pointer wins over the frozen island's pointer", () => {
    setJson("keystone_external_sessions", [
      { host: "dvd.chat", scheme: "https", token: "ext", user: { id: "u42" } },
    ]);
    setJson("keystodon_masto_sessions", [
      {
        origin: "https://mastodon.example",
        kind: "external",
        token: "masto",
        account: { id: "7" },
      },
    ]);
    store.setItem("keystone_active_external", "dvd.chat");
    store.setItem("keystodon_active_masto", "https://mastodon.example 7");
    migrateLegacySessions(store, ORIGIN);
    expect(getActiveSessionId(store)).toBe("https://dvd.chat u42");
  });

  it("a stale active pointer resolves to null, never a half session", () => {
    store.setItem("keystone_active_external", "gone.example");
    setJson("keystone_external_sessions", []);
    migrateLegacySessions(store, ORIGIN);
    expect(getActiveSession(store)).toBeNull();
  });
});

describe("migration: idempotence and corruption", () => {
  it("a second load does not re-migrate", () => {
    store.setItem("keystone_token_misskey", "mk-token");
    const first = migrateLegacySessions(store, ORIGIN);
    // Mutate a legacy key AFTER the first run: a second run must not pick
    // it up (migration already happened — the envelope is the truth now).
    store.setItem("keystone_token_misskey", "changed-later");
    const second = migrateLegacySessions(store, ORIGIN);
    expect(second).toEqual(first);
    expect(second[0].token).toBe("mk-token");
    expect(loadSessions(store)).toEqual(first);
  });

  it("a removed session is not resurrected by later loads", () => {
    store.setItem("keystone_token_misskey", "mk-token");
    const [s] = migrateLegacySessions(store, ORIGIN);
    removeSession(store, s.id);
    expect(loadSessions(store)).toEqual([]);
  });

  it("corrupt legacy JSON is dropped, never a crash", () => {
    store.setItem("keystone_token_misskey", "mk-token");
    store.setItem("keystone_external_sessions", "{not json");
    store.setItem("keystodon_masto_sessions", "[1,2,3]");
    store.setItem("keystodon_masto_apps", "null");
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token).toBe("mk-token");
  });

  it("malformed legacy entries are dropped; valid ones survive", () => {
    setJson("keystone_external_sessions", [
      { host: "dvd.chat", scheme: "https", token: "ext", user: { id: "u42" } },
      { host: "", scheme: "https", token: "bad", user: { id: "x" } },
      { host: "ftp.example", scheme: "ftp", token: "bad", user: { id: "x" } },
      { host: "no-token.example", scheme: "https", token: "", user: { id: "x" } },
      "junk",
      null,
    ]);
    setJson("keystodon_masto_sessions", [
      { origin: "https://mastodon.example", kind: "external", token: "m", account: { id: "7" } },
      { origin: "https://mastodon.example", kind: "external", token: "", account: { id: "8" } },
      { origin: 42, token: "m", account: { id: "9" } },
    ]);
    const sessions = migrateLegacySessions(store, ORIGIN);
    expect(sessions.map((s) => s.id).sort()).toEqual(
      ["https://dvd.chat u42", "https://mastodon.example 7"].sort(),
    );
  });

  it("a corrupt keystone_sessions envelope is rebuilt by migration", () => {
    store.setItem(SESSIONS_KEY, "{corrupt");
    store.setItem("keystone_token_misskey", "mk-token");
    expect(loadSessions(store, ORIGIN)).toHaveLength(1);
  });

  it("entries with unknown enum values are normalized to safe defaults", () => {
    setJson("keystodon_masto_sessions", [
      {
        origin: "https://mastodon.example",
        kind: "weird",
        token: "m",
        account: { id: "7" },
      },
    ]);
    const [s] = migrateLegacySessions(store, ORIGIN);
    expect(s.grant).toBe("oauth-pkce");
    expect(s.hosting).toBe("third-party");
    expect(s.flavor).toBe("unknown");
  });
});

describe("store API", () => {
  it("save/find/remove round-trip and active pointer clearing", () => {
    const s = internal();
    saveSession(store, s);
    saveSession(store, internal({ token: "updated" }));
    expect(loadSessions(store)).toHaveLength(1); // upsert by (origin, accountId)
    expect(findSession(store, s.id)?.token).toBe("updated");
    setActiveSessionId(store, s.id);
    expect(getActiveSession(store)?.id).toBe(s.id);
    removeSession(store, s.id);
    expect(getActiveSessionId(store)).toBeNull();
    expect(loadSessions(store)).toHaveLength(0);
  });

  it("rekeySession moves the id and follows the active pointer", () => {
    const s = internal();
    saveSession(store, s);
    setActiveSessionId(store, s.id);
    rekeySession(store, s.id, "real-account");
    expect(findSession(store, sessionId(ORIGIN, "real-account"))?.accountId).toBe("real-account");
    expect(findSession(store, s.id)).toBeNull();
    expect(getActiveSessionId(store)).toBe(sessionId(ORIGIN, "real-account"));
  });

  it("removeLegacyKeys clears every legacy key (Phase 2 hook, not used yet)", () => {
    for (const key of LEGACY_KEYS) store.setItem(key, "x");
    removeLegacyKeys(store);
    for (const key of LEGACY_KEYS) expect(store.getItem(key)).toBeNull();
  });
});

describe("revoke on logout (best-effort)", () => {
  it("misskey family revokes via POST /api/i/revoke-token with the token as `i`", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    await revokeSessionToken(internal(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/i/revoke-token`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ i: "tok-internal" });
  });

  it("mastodon family revokes via POST /oauth/revoke with the cached app", async () => {
    setJson(OAUTH_APPS_KEY, {
      "https://mastodon.example": { client_id: "cid", client_secret: "csec" },
    });
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    await revokeSessionToken(
      {
        id: "https://mastodon.example 7",
        origin: "https://mastodon.example",
        family: "mastodon",
        flavor: "unknown",
        accountId: "7",
        token: "masto-token",
        grant: "oauth-pkce",
        hosting: "third-party",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, store },
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mastodon.example/oauth/revoke");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("token")).toBe("masto-token");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csec");
  });

  it("no cached app means no request (matching mastodon/oauth.ts)", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    await revokeSessionToken(
      {
        id: "https://mastodon.example 7",
        origin: "https://mastodon.example",
        family: "mastodon",
        flavor: "unknown",
        accountId: "7",
        token: "masto-token",
        grant: "oauth-pkce",
        hosting: "third-party",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, store },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("network failures never throw", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("offline")));
    await expect(
      revokeSessionToken(internal(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });
});
