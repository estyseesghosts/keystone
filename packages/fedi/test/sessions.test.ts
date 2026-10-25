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
  SESSIONS_BAK_KEY,
  SESSIONS_KEY,
  UNKNOWN_ACCOUNT_ID,
  createMemoryStore,
  findSession,
  getActiveSession,
  getActiveSessionId,
  isNewerVersionEnvelope,
  loadSessions,
  migrateLegacySessions,
  removeLegacyKeys,
  removeSession,
  rekeySession,
  revokeSessionToken,
  saveSession,
  sessionId,
  sessionWithoutToken,
  setActiveSessionId,
  utf8Hex,
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
  it("misskey family revokes via POST /api/i/revoke-token with {i, token}", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    await revokeSessionToken(internal(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/i/revoke-token`);
    expect(init.method).toBe("POST");
    // Sharkey requires `tokenId` or `token` and ignores a bare `i` (M7).
    expect(JSON.parse(String(init.body))).toEqual({ i: "tok-internal", token: "tok-internal" });
  });

  it("misskey revoke includes tokenId when known", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    await expect(
      revokeSessionToken(internal(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        tokenId: "app-token-id",
      }),
    ).resolves.toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      i: "tok-internal",
      token: "tok-internal",
      tokenId: "app-token-id",
    });
  });

  it("misskey revoke returns false on non-2xx (M7)", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 401 })));
    await expect(
      revokeSessionToken(internal(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe(false);
  });

  it("mastodon revoke returns false on non-2xx", async () => {
    setJson(OAUTH_APPS_KEY, {
      "https://mastodon.example": { client_id: "cid", client_secret: "csec" },
    });
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 400 })));
    await expect(
      revokeSessionToken(
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
      ),
    ).resolves.toBe(false);
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
    await expect(
      revokeSessionToken(
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
      ),
    ).resolves.toBe(false); // the skip is observable, never silent
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("network failures never throw", async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error("offline")));
    await expect(
      revokeSessionToken(internal(), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe(true); // attempted (and failed) — best-effort, never throws
  });
});

describe("ADR 0011: secret-free envelope rows", () => {
  it("tokenless envelope rows load as not-hydrated sessions (never dropped)", () => {
    const s = internal();
    saveSession(store, sessionWithoutToken(s));
    const loaded = loadSessions(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(s.id);
    expect(loaded[0].token).toBe("");
    // And an explicitly empty token round-trips the same way.
    setJson(SESSIONS_KEY, { version: 1, active: null, sessions: [{ ...s, token: "" }] });
    expect(loadSessions(store)).toHaveLength(1);
  });

  it("non-string tokens still drop the row", () => {
    const s = internal();
    setJson(SESSIONS_KEY, { version: 1, active: null, sessions: [{ ...s, token: 42 }] });
    expect(loadSessions(store)).toHaveLength(0);
  });

  it("sessionWithoutToken redacts without mutating the input", () => {
    const s = internal();
    const redacted = sessionWithoutToken(s);
    expect(redacted.token).toBe("");
    expect(redacted.id).toBe(s.id);
    expect(s.token).toBe("tok-internal");
  });

  it("revokeSessionToken prefers the vault appSecret over the MMKV row", async () => {
    setJson(OAUTH_APPS_KEY, {
      "https://mastodon.example": { client_id: "cid", client_secret: "row-secret" },
    });
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const session = {
      id: "https://mastodon.example 7",
      origin: "https://mastodon.example",
      family: "mastodon" as const,
      flavor: "unknown" as const,
      accountId: "7",
      token: "masto-token",
      grant: "oauth-pkce" as const,
      hosting: "third-party" as const,
    };
    await revokeSessionToken(session, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      store,
      appSecret: "vault-secret",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URLSearchParams(String(init.body)).get("client_secret")).toBe("vault-secret");
  });

  it("revokeSessionToken uses the vault secret after the MMKV row is scrubbed", async () => {
    setJson(OAUTH_APPS_KEY, { "https://mastodon.example": { client_id: "cid" } });
    const fetchImpl = jest.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const session = {
      id: "https://mastodon.example 7",
      origin: "https://mastodon.example",
      family: "mastodon" as const,
      flavor: "unknown" as const,
      accountId: "7",
      token: "masto-token",
      grant: "oauth-pkce" as const,
      hosting: "third-party" as const,
    };
    await expect(
      revokeSessionToken(session, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        store,
        appSecret: "vault-secret",
      }),
    ).resolves.toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("vault-secret");
  });
});

describe("utf8Hex (ADR 0011 vault-key primitive)", () => {
  it("encodes ASCII to lowercase hex deterministically", () => {
    expect(utf8Hex("abc")).toBe("616263");
    expect(utf8Hex("https://a.example u1")).toBe(utf8Hex("https://a.example u1"));
    expect(utf8Hex("")).toBe("");
  });

  it("encodes multi-byte code points as UTF-8", () => {
    expect(utf8Hex("é")).toBe("c3a9"); // U+00E9
    expect(utf8Hex("😀")).toBe("f09f9880"); // U+1F600
    expect(utf8Hex("例")).toBe("e4be8b"); // U+4F8B
  });

  it("lone surrogates encode as U+FFFD, never crash", () => {
    expect(utf8Hex("\ud800")).toBe("efbfbd");
    expect(utf8Hex("a\ud800b")).toBe("61efbfbd62");
  });

  it("output is always SecureStore-safe", () => {
    for (const input of ["https://a.example u1", "https://例え.jp:3000/x y", "😀 ok"]) {
      expect(utf8Hex(input)).toMatch(/^[0-9a-f]*$/);
    }
  });
});

describe("storage resilience (repair X1.3 S4)", () => {
  it("a corrupt envelope is backed up before it is treated as absent", () => {
    store.setItem(SESSIONS_KEY, "{corrupt");
    expect(loadSessions(store)).toEqual([]);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe("{corrupt");
  });

  it("the backup is write-once: a later corruption never overwrites it", () => {
    store.setItem(SESSIONS_KEY, "{first");
    expect(loadSessions(store)).toEqual([]);
    store.setItem(SESSIONS_KEY, "{second");
    expect(loadSessions(store)).toEqual([]);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe("{first");
  });

  it("a newer-version envelope is used leniently and never written", () => {
    const s = internal();
    setJson(SESSIONS_KEY, { version: 99, active: s.id, sessions: [s] });
    expect(isNewerVersionEnvelope(store)).toBe(true);
    expect(loadSessions(store).map((x) => x.id)).toEqual([s.id]);
    // A sign-in proceeds in memory but must not downgrade the stored bytes.
    saveSession(store, internal({ accountId: "acc2", token: "tok2" }));
    const raw = JSON.parse(store.getItem(SESSIONS_KEY) as string) as { version: number };
    expect(raw.version).toBe(99);
    expect(isNewerVersionEnvelope(store)).toBe(true);
  });

  it("STORE_VERSION - 1 envelopes migrate forward instead of being dropped", () => {
    const s = internal();
    setJson(SESSIONS_KEY, { version: 0, active: s.id, sessions: [s] });
    expect(loadSessions(store).map((x) => x.id)).toEqual([s.id]);
    expect(isNewerVersionEnvelope(store)).toBe(false);
    const added = internal({ id: sessionId(ORIGIN, "acc2"), accountId: "acc2", token: "tok2" });
    saveSession(store, added);
    const raw = JSON.parse(store.getItem(SESSIONS_KEY) as string) as {
      version: number;
      sessions: Array<{ id: string }>;
    };
    expect(raw.version).toBe(1);
    expect(raw.sessions.map((x) => x.id).sort()).toEqual([s.id, added.id].sort());
  });

  it("partial envelopes keep the good rows and back up the dropped bytes", () => {
    const s = internal();
    const raw = JSON.stringify({
      version: 1,
      active: null,
      sessions: [s, { ...s, token: 42 }],
    });
    store.setItem(SESSIONS_KEY, raw);
    expect(loadSessions(store).map((x) => x.id)).toEqual([s.id]);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe(raw);
  });

  it("an empty write over corruption is refused; a sign-in proceeds on top of the backup", () => {
    store.setItem(SESSIONS_KEY, "{corrupt");
    removeSession(store, "nope");
    expect(store.getItem(SESSIONS_KEY)).toBe("{corrupt");
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe("{corrupt");
    const added = saveSession(store, internal());
    expect(added.map((x) => x.id)).toContain(internal().id);
    const raw = JSON.parse(store.getItem(SESSIONS_KEY) as string) as {
      version: number;
      sessions: unknown[];
    };
    expect(raw.version).toBe(1);
    expect(raw.sessions).toHaveLength(1);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe("{corrupt");
  });

  it("signing out the last session clears a stale backup (no secret bytes left)", () => {
    const s = internal();
    saveSession(store, s);
    store.setItem(SESSIONS_BAK_KEY, "stale-forensics");
    removeSession(store, s.id);
    expect(loadSessions(store)).toEqual([]);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBeNull();
  });

  it("a healthy non-empty rewrite keeps the first backup", () => {
    const a = internal();
    const b = internal({ id: sessionId(ORIGIN, "acc2"), accountId: "acc2", token: "tok2" });
    saveSession(store, a);
    saveSession(store, b);
    store.setItem(SESSIONS_BAK_KEY, "stale-forensics");
    removeSession(store, a.id);
    expect(loadSessions(store).map((x) => x.id)).toEqual([b.id]);
    expect(store.getItem(SESSIONS_BAK_KEY)).toBe("stale-forensics");
  });

  it("a throwing store never breaks saveSession (the write is process-local)", () => {
    const throwing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("locked");
      },
      removeItem: () => {},
    };
    const s = internal();
    expect(saveSession(throwing, s).map((x) => x.id)).toEqual([s.id]);
  });
});
