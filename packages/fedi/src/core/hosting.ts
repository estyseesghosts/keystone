// Hosting-mode resolution (plan §2.3 items 1–2, Phase 4 item 1).
//
// ONE dist/ for every deployment: whether Keystone runs as the first-party
// client of the server behind its own origin or as a standalone third-party
// client resolves at RUNTIME from `keystone.config.json` (core/config.ts)
// plus a same-origin probe — never at build time.
//
//   mode "third-party"  no probe. Optional `homeServer` only pre-fills the
//                       domain field.
//   mode "first-party"  the server behind this origin IS the home server;
//                       the probe only learns its flavor.
//   mode "auto"         probe same-origin NodeInfo/meta (core/detect.ts).
//                       A supported server answers -> first-party with
//                       homeServer = location.origin, otherwise third-party.
//
// Invariant: a first-party session is bound to `location.origin` (the
// session store never sends a token to another origin, and the home server
// is reached same-origin through the reverse proxy). An explicit
// `homeServer` on a DIFFERENT origin therefore cannot be first-party: it
// resolves as third-party with that server pre-filled, and says so in
// `reason`.
//
// `devFlavorHint` is the dev-only `VITE_KEYSTONE_BACKEND` override
// (api/backend.ts BACKEND_HINT): it picks between flavors of the SAME
// family when NodeInfo did not decide, and stands in when the probe finds
// nothing, so `npm run dev --mode misskey` behaves as it always has.

import {
  detectServer,
  familyOf,
  type ServerDetection,
  type ServerFamily,
  type ServerFlavor,
} from "./detect";
import type { HostingMode, RuntimeConfig } from "./config";

export type EffectiveHosting = "first-party" | "third-party";

export interface HostingResolution {
  /** The mode that is actually in force. */
  hosting: EffectiveHosting;
  /** What the config asked for (`auto` is resolved into `hosting`). */
  requested: HostingMode;
  /** First-party: the home server origin (`location.origin`). */
  homeOrigin: string | null;
  /** Third-party: a pre-filled sign-in domain from config, if any. */
  suggestedHost: string | null;
  /** Home server identity (first-party). null/"unknown" when undetected. */
  family: ServerFamily | null;
  flavor: ServerFlavor;
  detection: ServerDetection | null;
  /** First-party: may the user add accounts on other servers? Third-party
   * mode ALWAYS allows it — external accounts are the only accounts. */
  allowExternalAccounts: boolean;
  brand: string | null;
  name: string | null;
  linkPreviewProxy: string | null;
  basePath: string;
  /** Human-readable why (diagnostics, Login footnote). */
  reason: string;
}

export interface ResolveOptions {
  /** `location.origin`. */
  origin: string;
  devFlavorHint?: ServerFlavor | null;
  detect?: (origin: string) => Promise<ServerDetection>;
}

function sameOriginHome(homeServer: string | null, origin: string): boolean {
  if (!homeServer) return true;
  try {
    return new URL(homeServer).origin === origin;
  } catch {
    return false;
  }
}

function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, "");
}

/** Apply the dev hint to a detection result. NodeInfo wins; the hint only
 * refines within the same family or fills in for an empty probe. */
function withHint(
  detection: ServerDetection,
  hint: ServerFlavor | null | undefined,
): { family: ServerFamily | null; flavor: ServerFlavor; hinted: boolean } {
  const base = { family: detection.family, flavor: detection.flavor, hinted: false };
  if (!hint || detection.decidedBy === "nodeinfo") return base;
  const hintFamily = familyOf(hint);
  if (!hintFamily) return base;
  if (detection.family === null || detection.family === hintFamily) {
    return { family: hintFamily, flavor: hint, hinted: true };
  }
  return base;
}

export async function resolveHosting(
  config: RuntimeConfig,
  opts: ResolveOptions,
): Promise<HostingResolution> {
  const detect = opts.detect ?? ((o: string) => detectServer(o, { timeoutMs: 4_000 }));
  const common = {
    requested: config.mode,
    brand: config.brand,
    name: config.name,
    linkPreviewProxy: config.linkPreviewProxy,
    basePath: config.basePath,
  };
  const crossOriginHome = !sameOriginHome(config.homeServer, opts.origin);

  const thirdParty = (reason: string): HostingResolution => ({
    ...common,
    hosting: "third-party",
    homeOrigin: null,
    suggestedHost: config.homeServer ? hostOf(config.homeServer) : null,
    family: null,
    flavor: "unknown",
    detection: null,
    allowExternalAccounts: true,
    reason,
  });

  if (config.mode === "third-party") {
    return thirdParty("keystone.config.json sets mode \"third-party\".");
  }

  if (config.mode === "first-party" && crossOriginHome) {
    return thirdParty(
      `mode "first-party" with homeServer ${config.homeServer} on another origin: ` +
        "a first-party session is bound to this origin (reverse-proxy the server under it), so Keystone runs as a third-party client with that server pre-filled.",
    );
  }

  const detection = await detect(opts.origin);
  const hinted = withHint(detection, opts.devFlavorHint);
  const supported = hinted.family !== null && hinted.flavor !== "unknown";

  if (config.mode === "auto" && !supported) {
    return {
      ...thirdParty(
        "auto: no supported server answered NodeInfo/meta on this origin, so Keystone runs as a third-party client.",
      ),
      detection,
    };
  }

  return {
    ...common,
    hosting: "first-party",
    homeOrigin: opts.origin,
    suggestedHost: null,
    family: hinted.family,
    flavor: hinted.flavor,
    detection,
    allowExternalAccounts: config.allowExternalAccounts,
    reason:
      config.mode === "first-party"
        ? supported
          ? `mode "first-party": this origin runs ${hinted.flavor}${hinted.hinted ? " (dev override)" : ""}.`
          : 'mode "first-party": the server behind this origin could not be identified.'
        : `auto: this origin runs ${hinted.flavor}${hinted.hinted ? " (dev override)" : ""} (decided by ${hinted.hinted ? "dev hint" : detection.decidedBy}).`,
  };
}

// --- Process-wide state ----------------------------------------------------
//
// Plain module state + a change hook; `state/hosting.tsx` bridges it into a
// Solid signal. Non-UI code (api/client.ts) reads `getHosting()` directly.

let current: HostingResolution | null = null;
const listeners = new Set<(value: HostingResolution | null) => void>();

export function getHosting(): HostingResolution | null {
  return current;
}

export function setHosting(value: HostingResolution | null): void {
  current = value;
  for (const listener of listeners) listener(value);
}

export function onHostingChange(listener: (value: HostingResolution | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The effective router/OAuth base: the build-pinned `builtBase` when the
 * host app passes one, else the runtime `basePath` from keystone.config.json.
 * (`import.meta.env` cannot be read here — it does not compile under the
 * app's babel pipeline — so the host passes its base path in.) */
export function appBase(opts: { builtBase?: string } = {}): string {
  const built = opts.builtBase ?? "/";
  if (built !== "/") return built;
  return current?.basePath ?? "/";
}

/** The home server's flavor once resolved, else `fallback` (the dev hint /
 * build default before the probe lands). Never claims a flavor it has not
 * seen: "unknown" resolution returns the fallback too. */
export function homeFlavor(fallback: ServerFlavor): ServerFlavor {
  const resolved = current;
  if (!resolved || resolved.hosting !== "first-party" || resolved.flavor === "unknown") {
    return fallback;
  }
  return resolved.flavor;
}
