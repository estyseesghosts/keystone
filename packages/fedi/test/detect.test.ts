// Phase 1 item B — `src/core/detect.ts` (plan §2.1) exercised against
// inline bodies copied verbatim from the old repo's synthesised fixtures
// (all synthesised — they prove the code handles the documented shapes,
// not that a live server emits them). Fixture dirs land in slices 2.2/2.3;
// until then the three bodies these tests need live here.
//
// Jest port: `describe/it/expect` are globals (no vitest import).
import {
  buildCapabilities,
  detectFlavor,
  detectServer,
  familyOf,
  flavorFromNodeInfoName,
  flavorFromVersion,
  looksMastodon,
  looksMisskey,
  type Prober,
  type ProbeResponse,
} from "../src/core/detect";

/** Inline copies of the old repo's synthesised fixtures (see note above). */
const MISSKEY_META = {
  maintainerName: "SYNTHESISED FIXTURE — not recorded from a live server",
  name: "Misskey",
  version: "2026.10.1-alpha.0",
  uri: "https://misskey.example",
  description:
    "Synthesised from the shapes in frontend/src/api/types.ts and docs/api-surface.md. Re-record with scripts/record_fixtures.py on the backend machine.",
  langs: ["en"],
  repositoryUrl: "https://github.com/misskey-dev/misskey",
  disableRegistration: false,
  maxNoteTextLength: 3000,
};

const MASTODON_INSTANCE_V2 = {
  domain: "mastodon.example",
  title: "SYNTHESISED Mastodon 4.x fixture",
  version: "4.4.3",
  source_url: "https://github.com/mastodon/mastodon",
  description:
    "Synthesised from InstanceV2 in frontend/src/api/mastodon/wire.ts and docs/mastoapi-contract.md. Re-record with scripts/record_fixtures.py against a live Mastodon 4.x.",
  usage: { users: { active_month: 1 } },
  configuration: {
    statuses: { max_characters: 500, max_media_attachments: 4 },
    translation: { enabled: true },
    urls: { streaming: "wss://mastodon.example" },
  },
  registrations: { enabled: true, approval_required: false },
};

const AKKOMA_INSTANCE_V1 = {
  uri: "akkoma.example",
  title: "SYNTHESISED Akkoma fixture",
  version: "compatible; Akkoma 3.20.0",
  description:
    "Synthesised from InstanceV1 in frontend/src/api/mastodon/wire.ts and the shape rules in docs/mastoapi-contract.md §3/§9 (pleroma.metadata.features is the Akkoma/Pleroma shape marker). Akkoma has NO /api/v2/instance — this fixture is the v1 body the 404-fallback lands on. Re-record with scripts/record_fixtures.py against a live Akkoma.",
  stats: { user_count: 1, status_count: 1, domain_count: 1 },
  max_toot_chars: 5000,
  poll_limits: { max_options: 4 },
  upload_limit: 16777216,
  urls: { streaming_api: "wss://akkoma.example" },
  pleroma: {
    metadata: {
      features: [
        "akkoma_api",
        "exposable_reactions",
        "quote_posting",
        "editing",
        "akkoma:machine_translation",
      ],
      federation: { enabled: true },
    },
    vapid_public_key: "BMSynthesisedFixtureKey_NotARealKey_NotARealKey_NotARealKey_",
  },
};

/** Minimal stand-in for the old `test/helpers.ts` fixture loader. */
function fixture<T = unknown>(rel: string): T {
  const table: Record<string, unknown> = {
    "misskey/meta.json": MISSKEY_META,
    "mastodon/instance-v2.json": MASTODON_INSTANCE_V2,
    "akkoma/instance-v1.json": AKKOMA_INSTANCE_V1,
  };
  const hit = table[rel];
  if (!hit) throw new Error(`unknown inline fixture: ${rel}`);
  return hit as T;
}

const ORIGIN = "https://server.example";

interface Route {
  method: "GET" | "POST";
  match: string;
  status: number;
  body: unknown;
}

/** Prober that answers from a route table and records every call. */
function proberFor(routes: Route[]): Prober & { calls: string[] } {
  const calls: string[] = [];
  const prober: Prober = (method, url) => {
    calls.push(`${method} ${url.replace(ORIGIN, "")}`);
    const path = url.replace(ORIGIN, "");
    const route = routes.find((r) => r.method === method && path === r.match);
    const res: ProbeResponse = route
      ? { status: route.status, body: route.body }
      : { status: 404, body: null };
    return Promise.resolve(res);
  };
  return Object.assign(prober, { calls });
}

const NODEINFO_DISCOVERY = {
  links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: `${ORIGIN}/nodeinfo/2.1` }],
};

function nodeinfoRoute(
  name: string,
  version: string,
  body: Record<string, unknown> = {},
): Route {
  return {
    method: "GET",
    match: "/nodeinfo/2.1",
    status: 200,
    body: { ...body, software: { name, version } },
  };
}

describe("detectServer against fixtures (synthesised shapes)", () => {
  it("misskey: NodeInfo decides", async () => {
    const prober = proberFor([
      { method: "GET", match: "/.well-known/nodeinfo", status: 200, body: NODEINFO_DISCOVERY },
      nodeinfoRoute("misskey", "2026.10.1-alpha.0"),
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("misskey");
    expect(d.family).toBe("misskey");
    expect(d.decidedBy).toBe("nodeinfo");
    expect(d.version).toBe("2026.10.1-alpha.0");
    expect(d.features.mfm).toBe("supported");
    expect(d.features.reactions).toBe("supported");
    expect(d.features.miauth).toBe("supported");
    expect(d.features.drive).toBe("supported");
    expect(d.features.favourites_distinct_from_reactions).toBe("unsupported");
  });

  it("sharkey: NodeInfo decides", async () => {
    const prober = proberFor([
      { method: "GET", match: "/.well-known/nodeinfo", status: 200, body: NODEINFO_DISCOVERY },
      nodeinfoRoute("sharkey", "2025.4.7"),
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("sharkey");
    expect(d.family).toBe("misskey");
  });

  it("pinetree: NodeInfo decides (software.name 'pinetree' is ASSUMED — fixtures are synthesised)", async () => {
    const prober = proberFor([
      { method: "GET", match: "/.well-known/nodeinfo", status: 200, body: NODEINFO_DISCOVERY },
      nodeinfoRoute("pinetree", "0.0.0"),
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("pinetree");
    expect(d.family).toBe("misskey");
    // Verified Pinetree gaps (state/STATE.md):
    expect(d.features.drive).toBe("unsupported");
    expect(d.features.antennas).toBe("unsupported");
    expect(d.features.miauth).toBe("unsupported");
    expect(d.features.streaming).toBe("unsupported");
    expect(d.features.password_grant).toBe("supported");
  });

  it("mastodon 4.x: NodeInfo decides", async () => {
    const prober = proberFor([
      { method: "GET", match: "/.well-known/nodeinfo", status: 200, body: NODEINFO_DISCOVERY },
      nodeinfoRoute("mastodon", "4.4.3"),
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("mastodon");
    expect(d.family).toBe("mastodon");
    expect(d.features.reactions).toBe("unsupported");
    expect(d.features.password_grant).toBe("unsupported");
    expect(d.features.mfa_challenge).toBe("unsupported");
    expect(d.features.pkce).toBe("supported");
  });

  it("mastodon 4.x without NodeInfo: the family probe decides via shape", async () => {
    const prober = proberFor([
      { method: "POST", match: "/api/meta", status: 404, body: null },
      {
        method: "GET",
        match: "/api/v2/instance",
        status: 200,
        body: fixture("mastodon/instance-v2.json"),
      },
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("mastodon");
    expect(d.family).toBe("mastodon");
    expect(d.decidedBy).toBe("probe-shape");
    expect(d.version).toBe("4.4.3");
  });

  it("misskey without NodeInfo: /api/meta decides via shape", async () => {
    const prober = proberFor([
      { method: "POST", match: "/api/meta", status: 200, body: fixture("misskey/meta.json") },
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("misskey");
    expect(d.family).toBe("misskey");
    expect(d.decidedBy).toBe("probe-shape");
    expect(d.version).toBe("2026.10.1-alpha.0");
  });

  it("akkoma: no v2 (404 → v1 fallback), pleroma shape + features decide", async () => {
    const prober = proberFor([
      { method: "POST", match: "/api/meta", status: 404, body: null },
      { method: "GET", match: "/api/v2/instance", status: 404, body: null },
      {
        method: "GET",
        match: "/api/v1/instance",
        status: 200,
        body: fixture("akkoma/instance-v1.json"),
      },
    ]);
    const d = await detectServer(ORIGIN, { prober });
    expect(d.flavor).toBe("akkoma");
    expect(d.family).toBe("mastodon");
    expect(d.features.reactions).toBe("supported");
    expect(d.features.quote_posting).toBe("supported");
    expect(d.features.status_editing).toBe("supported");
    expect(d.features.translation).toBe("supported");
    expect(d.features.password_grant).toBe("supported");
    expect(d.features.mfa_challenge).toBe("supported");
    expect(d.features.pkce).toBe("unsupported");
  });
});

describe("the v2→v1 fallback gotcha is preserved", () => {
  it("falls back to v1 on 404/405 only", async () => {
    for (const status of [404, 405]) {
      const prober = proberFor([
        { method: "POST", match: "/api/meta", status: 404, body: null },
        { method: "GET", match: "/api/v2/instance", status, body: null },
        {
          method: "GET",
          match: "/api/v1/instance",
          status: 200,
          body: { uri: "server.example", title: "T", version: "compatible; Pleroma 2.7.0" },
        },
      ]);
      await detectServer(ORIGIN, { prober });
      expect(prober.calls).toContain("GET /api/v1/instance");
    }
  });

  it("NEVER falls back on 500/401/403 — a timeout/server error is not 'v2 missing'", async () => {
    for (const status of [500, 401, 403, 0]) {
      const prober = proberFor([
        { method: "POST", match: "/api/meta", status: 404, body: null },
        { method: "GET", match: "/api/v2/instance", status, body: null },
      ]);
      const d = await detectServer(ORIGIN, { prober });
      expect(prober.calls).not.toContain("GET /api/v1/instance");
      expect(d.flavor).toBe("unknown");
      expect(d.family).toBeNull();
      expect(d.decidedBy).toBe("none");
    }
  });
});

describe("detection order and safety", () => {
  it("NodeInfo name wins over probe shape", () => {
    expect(
      detectFlavor({
        nodeinfoName: "sharkey",
        misskeyBody: true,
        version: "2025.4.7",
      }),
    ).toBe("sharkey");
  });

  it("shape beats version markers; a 'mastodon' version string on a pleroma body is Pleroma", () => {
    expect(
      detectFlavor({
        version: "compatible; Mastodon 4.0",
        pleromaBody: true,
        pleromaFeatures: [],
      }),
    ).toBe("pleroma");
  });

  it("never follows a cross-origin NodeInfo href", async () => {
    const prober = proberFor([
      {
        method: "GET",
        match: "/.well-known/nodeinfo",
        status: 200,
        body: {
          links: [
            {
              rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
              href: "https://evil.example/nodeinfo/2.1",
            },
          ],
        },
      },
      { method: "POST", match: "/api/meta", status: 200, body: fixture("misskey/meta.json") },
    ]);
    await detectServer(ORIGIN, { prober });
    expect(prober.calls.every((c) => !c.includes("evil.example"))).toBe(true);
  });
});

describe("heuristics (the old detectFamily shape, generalised)", () => {
  it("version markers are substrings, never a strict parse", () => {
    expect(flavorFromVersion("compatible; Akkoma 3.20.0")).toBe("akkoma");
    expect(flavorFromVersion("compatible; Pleroma")).toBe("pleroma");
    expect(flavorFromVersion("4.4.3")).toBe("unknown");
    expect(flavorFromVersion("2026.10.1-alpha.0")).toBe("unknown");
    expect(flavorFromVersion(null)).toBe("unknown");
  });

  it("NodeInfo names map to flavors only when exact", () => {
    expect(flavorFromNodeInfoName("misskey")).toBe("misskey");
    expect(flavorFromNodeInfoName("Sharkey")).toBe("sharkey");
    expect(flavorFromNodeInfoName("gotosocial")).toBe("unknown");
    expect(flavorFromNodeInfoName(null)).toBe("unknown");
  });

  it("pleroma shape with the akkoma feature flag is Akkoma, without is Pleroma", () => {
    expect(
      detectFlavor({ pleromaBody: true, pleromaFeatures: ["akkoma_api"], version: null }),
    ).toBe("akkoma");
    expect(detectFlavor({ pleromaBody: true, pleromaFeatures: [], version: null })).toBe("pleroma");
    expect(
      detectFlavor({ pleromaBody: false, pleromaFeatures: ["akkoma_api"], version: null }),
    ).toBe("akkoma");
  });

  it("shape helpers recognize the documented bodies", () => {
    expect(looksMisskey(fixture("misskey/meta.json"))).toBe(true);
    expect(looksMisskey(fixture("mastodon/instance-v2.json"))).toBe(false);
    expect(looksMastodon(fixture("mastodon/instance-v2.json"))).toBe(true);
    expect(looksMastodon(fixture("akkoma/instance-v1.json"))).toBe(true);
    expect(looksMastodon(fixture("misskey/meta.json"))).toBe(false);
  });

  it("family mapping", () => {
    expect(familyOf("misskey")).toBe("misskey");
    expect(familyOf("pinetree")).toBe("misskey");
    expect(familyOf("akkoma")).toBe("mastodon");
    expect(familyOf("unknown")).toBeNull();
  });
});

describe("three-state capabilities", () => {
  it("unknown flavor is all-unknown — never unlocks an affordance", () => {
    const caps = buildCapabilities("unknown");
    for (const value of Object.values(caps)) expect(value).toBe("unknown");
  });

  it("probe evidence raises flags from the flavor table", () => {
    const caps = buildCapabilities("pleroma", {
      pleromaFeatures: ["exposable_reactions", "quote_posting", "editing"],
    });
    expect(caps.reactions).toBe("supported");
    expect(caps.quote_posting).toBe("supported");
    expect(caps.status_editing).toBe("supported");
    expect(caps.pkce).toBe("unsupported");
    expect(caps.miauth).toBe("unsupported");
  });
});
