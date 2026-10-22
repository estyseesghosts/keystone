// ADR 0003 — OAuth scopes: request `SCOPES_NOW`, never `SCOPES_LATER`.
//
// Every authorization request (app registration, `/oauth/authorize`, the
// Akkoma password grant) must carry exactly `SCOPES_NOW.join(" ")`. Scopes
// for unshipped features (push, admin, featured tags, favourites
// timeline) live in `SCOPES_LATER` and are requested by nobody; each later
// slice moves its scope into NOW together with the feature. `write:reports`
// moved into NOW with the report chooser (clickstone §1.5).
// No network: the transport is stubbed.

import { createMemoryStore } from "../src/core/sessions";
import {
  buildAuthorizeUrl,
  cacheApp,
  FALLBACK_SCOPES,
  getCachedApp,
  passwordGrant,
  randomToken,
  registerApp,
  s256Challenge,
  SCOPES_LATER,
  SCOPES_MASTODON,
  SCOPES_NOW,
  scopesForFlavor,
} from "../src/mastodon/oauth";

const ORIGIN = "https://server.example";
const REDIRECT = `${ORIGIN}/keystone/callback`;
const NOW = SCOPES_NOW.join(" ");

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init?: RequestInit;
}

/** Stub the transport; `handler` returns the JSON body for each URL. */
function stubFetch(handler: (url: string, init?: RequestInit) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(handler(url, init)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

describe("SCOPES_NOW / SCOPES_LATER split (ADR 0003)", () => {
  it("NOW and LATER are disjoint and duplicate-free", () => {
    expect(new Set(SCOPES_NOW).size).toBe(SCOPES_NOW.length);
    expect(new Set(SCOPES_LATER).size).toBe(SCOPES_LATER.length);
    for (const later of SCOPES_LATER) expect(SCOPES_NOW).not.toContain(later);
  });

  it("the requested scope string is exactly SCOPES_NOW and carries no LATER scope", () => {
    const requested = SCOPES_NOW.join(" ");
    expect(requested).toBe(NOW);
    const tokens = requested.split(" ");
    for (const later of SCOPES_LATER) {
      // Exact-token check: `read` is a prefix of `read:conversations`, but
      // it is a distinct scope — only the LATER token itself must be absent.
      expect(tokens).not.toContain(later);
    }
    // Named in the slice acceptance: reports ship, these do not.
    expect(tokens).toContain("write:reports");
    expect(tokens).not.toContain("push");
    expect(tokens).not.toContain("admin:read");

    // The legacy umbrella fallback is a subset of NOW (never a way to smuggle
    // an unshipped scope in through the fallback path).
    for (const umbrella of FALLBACK_SCOPES.split(" ")) {
      expect(tokens).toContain(umbrella);
    }
  });

  it("the shipped-surface scopes are still requested (no silent feature loss)", () => {
    for (const scope of [
      "read",
      "write",
      "follow",
      "read:accounts",
      "write:accounts",
      "read:statuses",
      "write:statuses",
      "write:favourites",
      "read:notifications",
      "write:notifications",
      "read:search",
      "read:follows",
      "write:follows",
      "read:blocks",
      "write:blocks",
      "read:mutes",
      "write:mutes",
      "read:bookmarks",
      "write:bookmarks",
      "read:filters",
      "write:filters",
      "read:lists",
      "write:lists",
      "write:media",
      "write:reports",
    ]) {
      expect(SCOPES_NOW).toContain(scope);
    }
  });
});

describe("authorization requests carry SCOPES_NOW", () => {
  it("registerApp posts exactly SCOPES_NOW and caches that string", async () => {
    const store = createMemoryStore();
    const calls = stubFetch(() => ({ client_id: "cid", client_secret: "csec" }));

    const app = await registerApp({ store, origin: ORIGIN, redirectUri: REDIRECT });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ORIGIN}/api/v1/apps`);
    const body = JSON.parse(String(calls[0].init?.body)) as { scopes: string };
    expect(body.scopes).toBe(NOW);
    expect(app.scopes).toBe(NOW);
    expect(calls[0].init?.body).toContain("write:reports");
    expect(calls[0].init?.body).not.toContain("admin:read");
    expect(calls[0].init?.body).not.toContain('"push"');
  });

  it("the authorize URL asks for exactly SCOPES_NOW", () => {
    const url = buildAuthorizeUrl({
      origin: ORIGIN,
      clientId: "cid",
      redirectUri: REDIRECT,
      scopes: NOW,
      state: "st",
      codeChallenge: "ch",
    });
    const scope = new URL(url).searchParams.get("scope");
    expect(scope).toBe(NOW);
    for (const later of SCOPES_LATER) {
      expect((scope ?? "").split(" ")).not.toContain(later);
    }
  });

  it("the Akkoma password grant asks for exactly SCOPES_NOW", async () => {
    const store = createMemoryStore();
    const calls = stubFetch((url) =>
      url.endsWith("/api/v1/apps")
        ? { client_id: "cid", client_secret: "csec" }
        : { access_token: "tok", token_type: "Bearer" },
    );
    const app = await registerApp({ store, origin: ORIGIN, redirectUri: REDIRECT });
    await passwordGrant({
      origin: ORIGIN,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      username: "alice",
      password: "pw",
      scopes: app.scopes,
    });

    const tokenCall = calls.find((c) => c.url === `${ORIGIN}/oauth/token`);
    expect(tokenCall).toBeDefined();
    const form = new URLSearchParams(String(tokenCall?.init?.body));
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("scope")).toBe(NOW);
  });

  it("a cached app registered with a LATER scope is not reused", async () => {
    const store = createMemoryStore();
    cacheApp(store, {
      origin: ORIGIN,
      redirect_uri: REDIRECT,
      client_id: "cid",
      client_secret: "csec",
      scopes: [...SCOPES_NOW, "push"].join(" "),
      createdAt: Date.now(),
    });
    expect(getCachedApp(store, ORIGIN, REDIRECT)).toBeNull();
  });

  it("an app cached with the NOW string (the pre-split set) is reused", async () => {
    const store = createMemoryStore();
    cacheApp(store, {
      origin: ORIGIN,
      redirect_uri: REDIRECT,
      client_id: "cid",
      client_secret: "csec",
      scopes: NOW,
      createdAt: Date.now(),
    });
    // Existing sessions keep working untouched: their cached app already
    // matches NOW, so no re-registration and no new authorize round-trip.
    expect(getCachedApp(store, ORIGIN, REDIRECT)?.client_id).toBe("cid");
  });
});

describe("P6.2 DMs: conversations scopes are NOW (the inbox ships)", () => {
  it("requests write:conversations and never stops asking for it", () => {
    expect(SCOPES_NOW).toContain("write:conversations");
    expect(SCOPES_LATER).not.toContain("write:conversations");
  });

  it("never requests read:conversations (not a real Mastodon scope)", () => {
    // Upstream has no read:conversations scope: the inbox index requires
    // `read`/`read:statuses` (both already NOW) and read/delete require
    // `write:conversations`. Requesting read:conversations busts the
    // per-origin cached app and stock Mastodon 422s the re-registration.
    expect(SCOPES_NOW).not.toContain("read:conversations");
    expect(SCOPES_LATER).toContain("read:conversations");
  });

  it("registerApp posts the conversation write scope (old tokens upgrade via the prompt)", async () => {
    const store = createMemoryStore();
    const calls = stubFetch(() => ({ client_id: "cid", client_secret: "csec" }));
    await registerApp({ store, origin: ORIGIN, redirectUri: REDIRECT });
    const body = JSON.parse(String(calls[0].init?.body)) as { scopes: string };
    const tokens = body.scopes.split(" ");
    expect(tokens).not.toContain("read:conversations");
    expect(tokens).toContain("write:conversations");
  });
});

// Login-hotfix guard: every scope in SCOPES_NOW must exist on stock Mastodon,
// or `POST /api/v1/apps` answers 422 `Scopes doesn't match those configured
// on the server` and ALL logins (new + re-auth) break. Allowlist copied from
// upstream `config/initializers/doorkeeper.rb` (default_scopes + optional_scopes,
// fetched 2026-10-22; `enforce_configured_scopes` is on). A scope allowlist is
// facts, not copied code. Notably absent upstream: `read:conversations` — the
// inbox index needs `read`/`read:statuses`, read/delete need `write:conversations`
// (upstream `app/controllers/api/v1/conversations_controller.rb`, main).
describe("SCOPES_NOW is a subset of Mastodon's configured scopes (login-hotfix guard)", () => {
  const MASTODON_CONFIGURED_SCOPES = [
    "read",
    "profile",
    "write",
    "write:accounts",
    "write:blocks",
    "write:bookmarks",
    "write:collections",
    "write:conversations",
    "write:favourites",
    "write:filters",
    "write:follows",
    "write:lists",
    "write:media",
    "write:mutes",
    "write:notifications",
    "write:reports",
    "write:statuses",
    "read:accounts",
    "read:blocks",
    "read:bookmarks",
    "read:collections",
    "read:favourites",
    "read:filters",
    "read:follows",
    "read:lists",
    "read:mutes",
    "read:notifications",
    "read:search",
    "read:statuses",
    "follow",
    "push",
    "admin:read",
    "admin:read:accounts",
    "admin:read:reports",
    "admin:read:domain_allows",
    "admin:read:domain_blocks",
    "admin:read:ip_blocks",
    "admin:read:email_domain_blocks",
    "admin:read:canonical_email_blocks",
    "admin:write",
    "admin:write:accounts",
    "admin:write:reports",
    "admin:write:domain_allows",
    "admin:write:domain_blocks",
    "admin:write:ip_blocks",
    "admin:write:email_domain_blocks",
    "admin:write:canonical_email_blocks",
  ];

  it("requests no scope stock Mastodon would reject at POST /api/v1/apps", () => {
    for (const scope of SCOPES_NOW) {
      expect(MASTODON_CONFIGURED_SCOPES).toContain(scope);
    }
  });

  it("the Mastodon-family request string is a subset too (either string registers cleanly)", () => {
    // Registration must succeed on BOTH flavors with EITHER string: the
    // per-flavor choice (ADR 0005) is about URL length, not acceptability.
    for (const scope of SCOPES_MASTODON) {
      expect(MASTODON_CONFIGURED_SCOPES).toContain(scope);
    }
  });
});

// ADR 0005 — per-flavor scope strings: Mastodon-family requests ONLY the
// umbrella triple `read write follow`.
//
// Why the triple suffices on Mastodon: Doorkeeper's scope check is ANY-of
// (upstream `lib/doorkeeper/models/concerns/scopes.rb`
// `includes_scope?`: `required_scopes.any? { ... }`), and EVERY Mastodon
// API controller lists the umbrella alongside the granular scope
// (`doorkeeper_authorize! :read, :'read:statuses'` across
// `app/controllers/api/v1/*.rb`) — so an umbrella-only token passes every
// shipped endpoint. `ScopeParser`/`ScopeTransformer`
// (`app/lib/scope_parser.rb`, `app/lib/scope_transformer.rb`) and
// `grouped_scopes` (`app/helpers/application_helper.rb`) are authorize-page
// display grouping only, not access checks. Akkoma keeps the full string:
// its umbrella-scope checks are unmapped and a granular-only token 403s
// shipped Explore surfaces (live probe, ADR 0003). No network: stubbed.
describe("per-flavor scope strings (ADR 0005)", () => {
  it("SCOPES_MASTODON is exactly the umbrella triple", () => {
    expect(SCOPES_MASTODON).toEqual(["read", "write", "follow"]);
  });

  it("mastodon flavor requests the triple; akkoma/pleroma/unknown keep the full set", () => {
    expect(scopesForFlavor("mastodon")).toEqual(["read", "write", "follow"]);
    expect(scopesForFlavor("akkoma")).toEqual(SCOPES_NOW);
    expect(scopesForFlavor("pleroma")).toEqual(SCOPES_NOW);
    // Unknown defaults to the full set: a wrongly-narrowed Akkoma token
    // breaks shipped features, while stock Mastodon accepts the full set
    // (pinned above) — detection resolves the flavor first in practice.
    expect(scopesForFlavor("unknown")).toEqual(SCOPES_NOW);
  });

  it("registerApp requests the flavor string and caches it", async () => {
    const store = createMemoryStore();
    const calls = stubFetch(() => ({ client_id: "cid", client_secret: "csec" }));

    const app = await registerApp({
      store,
      origin: ORIGIN,
      redirectUri: REDIRECT,
      flavor: "mastodon",
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init?.body)) as { scopes: string };
    expect(body.scopes).toBe("read write follow");
    expect(app.scopes).toBe("read write follow");
    // The cache binds on the flavor string: a full-set cached app is NOT
    // reused for a Mastodon login (and vice versa).
    expect(getCachedApp(store, ORIGIN, REDIRECT, "read write follow")?.client_id).toBe("cid");
    expect(getCachedApp(store, ORIGIN, REDIRECT)).toBeNull();
  });

  it("registerApp without a flavor keeps the full set (previous behavior)", async () => {
    const store = createMemoryStore();
    stubFetch(() => ({ client_id: "cid", client_secret: "csec" }));
    const app = await registerApp({ store, origin: ORIGIN, redirectUri: REDIRECT });
    expect(app.scopes).toBe(NOW);
  });

  it("the built Mastodon authorize URL stays under 480 chars (tight-buffer 502 guard)", async () => {
    // Fresh PKCE + state, standard dev redirect: this is the exact shape
    // that 502s past ~512 chars on tight-header-buffer servers. The full
    // 26-scope string builds ~700-char URLs; the triple must stay small
    // with margin (fixed 43-char lengths = real randomToken/S256 sizes).
    const clientId = "a".repeat(43);
    const state = randomToken();
    const verifier = randomToken();
    expect(state).toHaveLength(43);
    const challenge = await s256Challenge(verifier);
    expect(challenge).toHaveLength(43);
    const url = buildAuthorizeUrl({
      origin: ORIGIN,
      clientId,
      redirectUri: "https://app.example/auth/callback",
      scopes: scopesForFlavor("mastodon").join(" "),
      state,
      codeChallenge: challenge,
    });
    expect(new URL(url).searchParams.get("scope")).toBe("read write follow");
    expect(url.length).toBeLessThan(480);
  });

  it("the Akkoma password grant still asks for the full set", async () => {
    const store = createMemoryStore();
    const calls = stubFetch((url) =>
      url.endsWith("/api/v1/apps")
        ? { client_id: "cid", client_secret: "csec" }
        : { access_token: "tok", token_type: "Bearer" },
    );
    const app = await registerApp({ store, origin: ORIGIN, redirectUri: REDIRECT, flavor: "akkoma" });
    expect(app.scopes).toBe(NOW);
    await passwordGrant({
      origin: ORIGIN,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      username: "alice",
      password: "pw",
      scopes: app.scopes,
    });

    const tokenCall = calls.find((c) => c.url === `${ORIGIN}/oauth/token`);
    expect(tokenCall).toBeDefined();
    const form = new URLSearchParams(String(tokenCall?.init?.body));
    expect(form.get("scope")).toBe(NOW);
  });
});
