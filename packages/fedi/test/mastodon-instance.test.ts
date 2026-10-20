// Mastodon-family instance discovery: v2 → v1 fallback + capability
// normalization, against the per-flavor fixtures (mastodon, akkoma).
//
// Keeps the Akkoma contract: Akkoma has NO /api/v2/instance, so the
// fallback (404/405 ONLY — never timeout/401/403/5xx) is the common path
// there. Ported from the old `test/detect.test.ts` fallback cases, aimed
// at `mastodon/instance.fetchInstanceCapabilities`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectFamily,
  fetchInstanceCapabilities,
  normalizeStreamingOrigin,
  reactionsSupported,
} from "../src/mastodon/instance";

function fixture<T>(flavor: string, name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", flavor, name), "utf8");
  return JSON.parse(raw) as T;
}

const ORIGIN = "https://instance.example";

interface Route {
  method: string;
  match: string;
  status: number;
  body: unknown;
}

function stubFetch(routes: Route[]): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const text = String(url);
    const method = "GET";
    calls.push(`${method} ${new URL(text).pathname}`);
    const route = routes.find((r) => r.method === method && text.includes(r.match));
    const status = route?.status ?? 404;
    const body = route?.body ?? null;
    return new Response(body === null ? "" : JSON.stringify(body), { status });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

describe("fetchInstanceCapabilities v2→v1 fallback (Akkoma contract)", () => {
  it("akkoma: no v2 (404 → v1 fallback), pleroma shape + features decide", async () => {
    const stub = stubFetch([
      { method: "GET", match: "/api/v2/instance", status: 404, body: null },
      {
        method: "GET",
        match: "/api/v1/instance",
        status: 200,
        body: fixture("akkoma", "instance-v1.json"),
      },
    ]);
    try {
      const caps = await fetchInstanceCapabilities(ORIGIN);
      expect(stub.calls).toContain("GET /api/v2/instance");
      expect(stub.calls).toContain("GET /api/v1/instance");
      expect(caps.serverFamily).toBe("akkoma");
      expect(caps.domain).toBe("akkoma.example");
      expect(caps.version).toContain("Akkoma");
      expect(caps.features.emoji_reactions).toBe("supported");
      expect(caps.features.password_grant).toBe("supported");
      expect(caps.features.quote_posting).toBe("supported");
      expect(caps.streamingOrigin).toBe("wss://akkoma.example");
    } finally {
      stub.restore();
    }
  });

  it("falls back to v1 on 404/405 only", async () => {
    for (const status of [404, 405]) {
      const stub = stubFetch([
        { method: "GET", match: "/api/v2/instance", status, body: null },
        {
          method: "GET",
          match: "/api/v1/instance",
          status: 200,
          body: fixture("akkoma", "instance-v1.json"),
        },
      ]);
      try {
        const caps = await fetchInstanceCapabilities(ORIGIN);
        expect(stub.calls).toContain("GET /api/v1/instance");
        expect(caps.serverFamily).toBe("akkoma");
      } finally {
        stub.restore();
      }
    }
  });

  it("NEVER falls back on 500/401/403 — a server error is not 'v2 missing'", async () => {
    for (const status of [500, 401, 403]) {
      const stub = stubFetch([
        { method: "GET", match: "/api/v2/instance", status, body: null },
        {
          method: "GET",
          match: "/api/v1/instance",
          status: 200,
          body: fixture("akkoma", "instance-v1.json"),
        },
      ]);
      try {
        await expect(fetchInstanceCapabilities(ORIGIN)).rejects.toThrow();
        expect(stub.calls).not.toContain("GET /api/v1/instance");
      } finally {
        stub.restore();
      }
    }
  });

  it("mastodon v2 answers directly (family + limits + streaming origin)", async () => {
    const stub = stubFetch([
      {
        method: "GET",
        match: "/api/v2/instance",
        status: 200,
        body: fixture("mastodon", "instance-v2.json"),
      },
      { method: "GET", match: "/api/v1/instance", status: 404, body: null },
      // The bare "4.4.3" version carries no marker: NodeInfo decides.
      {
        method: "GET",
        match: "/.well-known/nodeinfo",
        status: 200,
        body: {
          links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: `${ORIGIN}/nodeinfo/2.1` }],
        },
      },
      {
        method: "GET",
        match: "/nodeinfo/2.1",
        status: 200,
        body: fixture("mastodon", "nodeinfo.json"),
      },
    ]);
    try {
      const caps = await fetchInstanceCapabilities(ORIGIN);
      expect(caps.serverFamily).toBe("mastodon");
      expect(caps.domain).toBe("mastodon.example");
      expect(caps.maxStatusCharacters).toBe(500);
      expect(caps.maxMediaAttachments).toBe(4);
      expect(caps.streamingOrigin).toBe("wss://mastodon.example");
      expect(caps.features.emoji_reactions).toBe("unsupported");
      expect(caps.features.password_grant).toBe("unsupported");
    } finally {
      stub.restore();
    }
  });
});

describe("instance helpers", () => {
  it("normalizeStreamingOrigin maps http(s) hosts to ws(s) origins", () => {
    expect(normalizeStreamingOrigin("wss://mastodon.example")).toBe("wss://mastodon.example");
    expect(normalizeStreamingOrigin("https://mastodon.example")).toBe("wss://mastodon.example");
    expect(normalizeStreamingOrigin("http://localhost:4000")).toBe("ws://localhost:4000");
    expect(normalizeStreamingOrigin(null)).toBeNull();
    expect(normalizeStreamingOrigin("gopher://x")).toBeNull();
  });

  it("detectFamily uses version markers, then shape, then NodeInfo", () => {
    expect(detectFamily("compatible; Akkoma 3.20.0", true, ["akkoma_api"], null)).toBe("akkoma");
    expect(detectFamily("4.4.3", false, [], null)).toBe("unknown");
    expect(detectFamily("4.4.3 (compatible; Mastodon)", false, [], null)).toBe("mastodon");
    expect(detectFamily(null, true, [], null)).toBe("pleroma");
    expect(detectFamily(null, false, [], "akkoma")).toBe("akkoma");
  });

  it("reactionsSupported needs positive evidence — unknown is OFF", () => {
    expect(reactionsSupported(null)).toBe(false);
    expect(reactionsSupported({ features: { emoji_reactions: "unknown" } })).toBe(false);
    expect(reactionsSupported({ features: { emoji_reactions: "supported" } })).toBe(true);
    expect(reactionsSupported(null, { emoji_reactions: [{ name: "x" }] })).toBe(true);
  });
});
