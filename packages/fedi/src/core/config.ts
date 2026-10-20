// Runtime configuration (plan §2.3, Phase 1 item B).
//
// `GET ${base}keystone.config.json` — OPTIONAL and CACHED. There is one
// `dist/` for every deployment; mode and hosting resolve at runtime, never
// at build time. Missing file, missing field, or malformed JSON ⇒ default,
// never an error. A 404 on the config request is the normal case.
//
// Fields (plan §2.3):
//   mode                "first-party" | "third-party" | "auto"   default "auto"
//   homeServer          origin    default location.origin in first-party mode
//   allowExternalAccounts boolean                              default true
//   basePath            string                                  default "/"
//   brand, name         string                                  default null
//   linkPreviewProxy    URL string | null     default null (the allorigins.win
//                       fallback in api/linkpreview.ts is opt-in, never default)
//
// This module is a seam only: no call site consumes it yet (that is
// Phase 2/4 work). Behaviour of the shipped app is unchanged.

export type HostingMode = "first-party" | "third-party" | "auto";

export interface RuntimeConfig {
  mode: HostingMode;
  /** Home server origin; null = fall back to the defaults resolver. */
  homeServer: string | null;
  allowExternalAccounts: boolean;
  /** Router/proxy namespace. Normalized to `/…/` form ("" becomes "/"). */
  basePath: string;
  brand: string | null;
  name: string | null;
  /** Opt-in link-preview proxy URL, or null (the privacy-preserving default). */
  linkPreviewProxy: string | null;
}

export const CONFIG_FILE = "keystone.config.json";

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  mode: "auto",
  homeServer: null,
  allowExternalAccounts: true,
  basePath: "/",
  brand: null,
  name: null,
  linkPreviewProxy: null,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalize a base path to `/…/` form: `""` → `/`, `"keystone"` →
 * `/keystone/`, `"/keystone/"` → `/keystone/`, `/` stays `/`. */
export function normalizeBasePath(raw: string | null): string {
  if (!raw) return "/";
  let value = raw.trim();
  if (value === "" || value === "/") return "/";
  if (!value.startsWith("/")) value = `/${value}`;
  if (!value.endsWith("/")) value = `${value}/`;
  return value;
}

/** Merge a parsed config file body onto the defaults. Unknown fields are
 * ignored; a field of the wrong type falls back to its default (a hostile
 * or stale config can never change behaviour beyond the documented set). */
export function mergeRuntimeConfig(raw: unknown): RuntimeConfig {
  const out: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG };
  if (!isPlainObject(raw)) return out;

  const mode = raw.mode;
  if (mode === "first-party" || mode === "third-party" || mode === "auto") {
    out.mode = mode;
  }

  const homeServer = strOrNull(raw.homeServer);
  if (homeServer) {
    try {
      // Only a real http(s) origin is accepted; path/query are dropped.
      const url = new URL(homeServer);
      if (url.protocol === "http:" || url.protocol === "https:") {
        out.homeServer = url.origin;
      }
    } catch {
      // Not a URL: default (null) stands.
    }
  }

  if (typeof raw.allowExternalAccounts === "boolean") {
    out.allowExternalAccounts = raw.allowExternalAccounts;
  }

  out.basePath = normalizeBasePath(strOrNull(raw.basePath));

  out.brand = strOrNull(raw.brand);
  out.name = strOrNull(raw.name);

  const proxy = strOrNull(raw.linkPreviewProxy);
  if (proxy) {
    try {
      const url = new URL(proxy);
      if (url.protocol === "http:" || url.protocol === "https:") {
        out.linkPreviewProxy = url.toString();
      }
    } catch {
      // Not a URL: stays off.
    }
  }

  return out;
}

/**
 * Resolve the home server for a config:
 * explicit `homeServer` wins, then the dev-only build override (if any was
 * handed in), then the injected `origin` in first-party mode. `auto` and
 * `third-party` without an explicit homeServer resolve to null — the
 * third-party flow asks the user which server to sign in to.
 *
 * No ambient origin is read here (pure-TS rule: no `location` access) — the
 * host app passes its own origin explicitly.
 */
export function resolveHomeServer(
  config: RuntimeConfig,
  opts: { devHomeServer?: string | null; origin?: string | null } = {},
): string | null {
  if (config.homeServer) return config.homeServer;
  const dev = opts.devHomeServer ?? null;
  if (dev) return dev;
  if (config.mode === "first-party") {
    return opts.origin ?? null;
  }
  return null;
}

// --- Load + cache ----------------------------------------------------------

export interface ConfigFetchResult {
  status: number;
  body: unknown;
}

/** Injectable transport for tests; returns status + parsed body (or null). */
export type ConfigProber = (url: string) => Promise<ConfigFetchResult>;

let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

async function defaultProber(url: string): Promise<ConfigFetchResult> {
  try {
    const res = await fetch(url, { method: "GET", credentials: "omit" });
    const raw = res.status === 204 ? "" : await res.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null; // malformed config is treated as absent
      }
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Load (once) and cache the runtime config. Never throws: any failure
 * resolves to the defaults. `base` is the app base path (`/` by default);
 * the file is fetched from `${base}keystone.config.json`.
 */
export function loadRuntimeConfig(opts: {
  base?: string;
  prober?: ConfigProber;
} = {}): Promise<RuntimeConfig> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  const base = normalizeBasePath(opts.base ?? "/");
  const url = `${base}${CONFIG_FILE}`;
  const prober = opts.prober ?? defaultProber;
  inflight = prober(url)
    .then((res) => {
      cached = res.status >= 200 && res.status < 300 ? mergeRuntimeConfig(res.body) : { ...DEFAULT_RUNTIME_CONFIG };
      return cached;
    })
    .catch(() => {
      cached = { ...DEFAULT_RUNTIME_CONFIG };
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The cached config, or the defaults before/without a load. Sync access
 * for render paths; call `loadRuntimeConfig` at boot to populate it. */
export function runtimeConfig(): RuntimeConfig {
  return cached ?? { ...DEFAULT_RUNTIME_CONFIG };
}

/** Test hook: drop the cache so the next load runs again. */
export function resetRuntimeConfigCache(): void {
  cached = null;
  inflight = null;
}
