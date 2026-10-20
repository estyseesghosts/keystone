// Phase 1 item B — `src/core/config.ts` (plan §2.3). Missing file, missing
// field, malformed JSON ⇒ default, never an error; the cache is honoured.
//
// Jest port: `beforeEach/describe/it/expect` are globals (no vitest import).
import {
  CONFIG_FILE,
  DEFAULT_RUNTIME_CONFIG,
  loadRuntimeConfig,
  mergeRuntimeConfig,
  normalizeBasePath,
  resetRuntimeConfigCache,
  resolveHomeServer,
  runtimeConfig,
  type ConfigProber,
} from "../src/core/config";

function proberReturning(status: number, body: unknown): ConfigProber & { calls: string[] } {
  const calls: string[] = [];
  const prober = (url: string) => {
    calls.push(url);
    return Promise.resolve({ status, body });
  };
  return Object.assign(prober, { calls });
}

beforeEach(() => resetRuntimeConfigCache());

describe("mergeRuntimeConfig", () => {
  it("all fields", () => {
    const cfg = mergeRuntimeConfig({
      mode: "first-party",
      homeServer: "https://Example.com/some/path",
      allowExternalAccounts: false,
      basePath: "keystone",
      brand: "Pine",
      name: "My Keystone",
      linkPreviewProxy: "https://proxy.example/?url=",
    });
    expect(cfg.mode).toBe("first-party");
    expect(cfg.homeServer).toBe("https://example.com");
    expect(cfg.allowExternalAccounts).toBe(false);
    expect(cfg.basePath).toBe("/keystone/");
    expect(cfg.brand).toBe("Pine");
    expect(cfg.name).toBe("My Keystone");
    expect(cfg.linkPreviewProxy).toBe("https://proxy.example/?url=");
  });

  it("missing fields fall back to defaults", () => {
    expect(mergeRuntimeConfig({ mode: "third-party" })).toEqual({
      ...DEFAULT_RUNTIME_CONFIG,
      mode: "third-party",
    });
  });

  it("non-object body is all defaults", () => {
    expect(mergeRuntimeConfig(null)).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(mergeRuntimeConfig("nope")).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(mergeRuntimeConfig([1, 2])).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("wrong-typed fields never corrupt the defaults", () => {
    const cfg = mergeRuntimeConfig({
      mode: "banana",
      homeServer: 42,
      allowExternalAccounts: "yes",
      basePath: { nested: true },
      brand: "",
      linkPreviewProxy: "not a url",
    });
    expect(cfg).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("homeServer must be an http(s) URL", () => {
    expect(mergeRuntimeConfig({ homeServer: "example.com" }).homeServer).toBeNull();
    expect(mergeRuntimeConfig({ homeServer: "ftp://example.com" }).homeServer).toBeNull();
    expect(mergeRuntimeConfig({ homeServer: "http://localhost:3000" }).homeServer).toBe(
      "http://localhost:3000",
    );
  });

  it("linkPreviewProxy is off by default (allorigins fallback is opt-in)", () => {
    expect(DEFAULT_RUNTIME_CONFIG.linkPreviewProxy).toBeNull();
    expect(mergeRuntimeConfig({}).linkPreviewProxy).toBeNull();
    expect(mergeRuntimeConfig({ linkPreviewProxy: "javascript:alert(1)" }).linkPreviewProxy).toBeNull();
  });
});

describe("normalizeBasePath", () => {
  it("root forms", () => {
    expect(normalizeBasePath(null)).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
  });
  it("namespaced forms normalize to /…/", () => {
    expect(normalizeBasePath("keystone")).toBe("/keystone/");
    expect(normalizeBasePath("/keystone")).toBe("/keystone/");
    expect(normalizeBasePath("/keystone/")).toBe("/keystone/");
    expect(normalizeBasePath("  /keystone  ")).toBe("/keystone/");
  });
});

describe("loadRuntimeConfig", () => {
  it("404 on the config request is normal: defaults, no error", async () => {
    const prober = proberReturning(404, null);
    const cfg = await loadRuntimeConfig({ prober });
    expect(cfg).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(prober.calls).toEqual([`/${CONFIG_FILE}`]);
  });

  it("malformed JSON body is treated as absent", async () => {
    const cfg = await loadRuntimeConfig({ prober: proberReturning(200, null) });
    expect(cfg).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("fetches from the given base path", async () => {
    const prober = proberReturning(200, { mode: "first-party" });
    await loadRuntimeConfig({ base: "/keystone/", prober });
    expect(prober.calls).toEqual([`/keystone/${CONFIG_FILE}`]);
  });

  it("caches: a second load does not refetch", async () => {
    const prober = proberReturning(200, { name: "Cached" });
    const first = await loadRuntimeConfig({ prober });
    const second = await loadRuntimeConfig({ prober });
    expect(second).toBe(first);
    expect(prober.calls.length).toBe(1);
    expect(runtimeConfig().name).toBe("Cached");
  });

  it("sync accessor returns defaults before any load", () => {
    expect(runtimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("a throwing prober resolves to defaults", async () => {
    const cfg = await loadRuntimeConfig({
      prober: () => Promise.reject(new Error("boom")),
    });
    expect(cfg).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});

describe("resolveHomeServer", () => {
  it("explicit homeServer wins over everything", () => {
    const cfg = mergeRuntimeConfig({ homeServer: "https://hs.example", mode: "first-party" });
    expect(resolveHomeServer(cfg, { devHomeServer: "http://dev:3000", origin: "http://app" })).toBe(
      "https://hs.example",
    );
  });

  it("dev override is the default home server when none is configured", () => {
    const cfg = mergeRuntimeConfig({});
    expect(resolveHomeServer(cfg, { devHomeServer: "http://127.0.0.1:3101" })).toBe(
      "http://127.0.0.1:3101",
    );
  });

  it("first-party defaults to location.origin", () => {
    const cfg = mergeRuntimeConfig({ mode: "first-party" });
    expect(resolveHomeServer(cfg, { origin: "https://app.example" })).toBe(
      "https://app.example",
    );
  });

  it("auto/third-party without an explicit server resolve to null", () => {
    expect(resolveHomeServer(mergeRuntimeConfig({}), { origin: "https://app.example" })).toBeNull();
  });
});
