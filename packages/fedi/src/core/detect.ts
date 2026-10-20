// Server family/flavor detection (plan §2.1, Phase 1 item B).
//
// Generalises Keystodon's `detectFamily` (`api/mastodon/instance.ts`) so the
// Misskey family is detected too. Self-contained on purpose: `src/core/` is
// below both adapters and imports no wire module.
//
// Detection order (plan §2.1):
//   1. NodeInfo `software.name`;
//   2. the family probe — Misskey `POST /api/meta`, or Mastodon
//      `GET /api/v2/instance` with a v1 fallback;
//   3. the version-string and shape heuristics (the old `detectFamily`
//      shape: never parse one substring as the sole detector).
//
// Preserved gotcha from `mastodon/instance.ts`: the v2→v1 instance fallback
// happens on 404/405 ONLY — never on timeout/401/403/other 4xx/5xx, because
// Akkoma has NO v2 endpoint and a timeout is never evidence of absence.
// Akkoma's version marker changed across releases ("compatible; Pleroma" →
// "compatible; Akkoma"), so markers are combined with shape evidence
// (`pleroma.metadata`, `pleroma.features`) and NodeInfo, and detection
// stays unknown when the evidence is ambiguous.

export type ServerFamily = "misskey" | "mastodon";

export type ServerFlavor =
  | "misskey"
  | "sharkey"
  | "catodon"
  | "pinetree"
  | "mastodon"
  | "akkoma"
  | "pleroma"
  | "unknown";

export type FeatureSupport = "supported" | "unsupported" | "unknown";

export type FeatureKey =
  // Posting
  | "reactions"
  | "reaction_acceptance"
  | "mfm"
  | "quote_posting"
  | "status_editing"
  | "polls_multi"
  | "scheduled_posts"
  | "server_drafts"
  | "local_only"
  // Misskey-family extras
  | "drive"
  | "antennas"
  | "clips"
  | "channels"
  | "chats"
  // Organization
  | "lists"
  | "bookmarks"
  | "favourites_distinct_from_reactions"
  // Server services
  | "translation"
  | "streaming"
  // Auth
  | "password_grant"
  | "mfa_challenge"
  | "pkce"
  | "miauth";

export type Capabilities = Record<FeatureKey, FeatureSupport>;

export const FEATURE_KEYS: readonly FeatureKey[] = [
  "reactions",
  "reaction_acceptance",
  "mfm",
  "quote_posting",
  "status_editing",
  "polls_multi",
  "scheduled_posts",
  "server_drafts",
  "local_only",
  "drive",
  "antennas",
  "clips",
  "channels",
  "chats",
  "lists",
  "bookmarks",
  "favourites_distinct_from_reactions",
  "translation",
  "streaming",
  "password_grant",
  "mfa_challenge",
  "pkce",
  "miauth",
];

export function familyOf(flavor: ServerFlavor): ServerFamily | null {
  switch (flavor) {
    case "misskey":
    case "sharkey":
    case "catodon":
    case "pinetree":
      return "misskey";
    case "mastodon":
    case "akkoma":
    case "pleroma":
      return "mastodon";
    default:
      return null;
  }
}

// --- Evidence --------------------------------------------------------------

export interface DetectionEvidence {
  /** NodeInfo 2.x `software.name` (lowercased compare), or null. */
  nodeinfoName?: string | null;
  /** NodeInfo `software.version`, or null. */
  nodeinfoVersion?: string | null;
  /** Version string from meta / instance probes, or null. */
  version?: string | null;
  /** True when a probed body carried `pleroma` (Akkoma/Pleroma shape). */
  pleromaBody?: boolean;
  /** `pleroma.metadata.features` entries (Akkoma/Pleroma feature flags). */
  pleromaFeatures?: readonly string[];
  /** True when a probed body is Misskey-shaped (meta). */
  misskeyBody?: boolean;
  /** True when a probed body is Mastodon-shaped (v1/v2 instance). */
  mastodonBody?: boolean;
  /** Misskey-family `meta.translatorAvailable`, when the probe saw it
   * (lets `buildCapabilities` set `translation` honestly). */
  translatorAvailable?: boolean | null;
}

/** NodeInfo `software.name` → flavor. Exact names only; anything else falls
 * through to the probes/heuristics. */
export function flavorFromNodeInfoName(name: string | null | undefined): ServerFlavor {
  const soft = (name ?? "").trim().toLowerCase();
  if (soft === "misskey") return "misskey";
  if (soft === "sharkey") return "sharkey";
  if (soft === "catodon") return "catodon";
  if (soft === "pinetree") return "pinetree";
  if (soft === "mastodon") return "mastodon";
  if (soft === "akkoma") return "akkoma";
  if (soft === "pleroma") return "pleroma";
  return "unknown";
}

/** Version-string markers (substring, never a strict parse — Akkoma's
 * format changed across releases). */
export function flavorFromVersion(version: string | null | undefined): ServerFlavor {
  const v = (version ?? "").toLowerCase();
  if (v.includes("akkoma")) return "akkoma";
  if (v.includes("pleroma")) return "pleroma";
  if (v.includes("mastodon")) return "mastodon";
  if (v.includes("sharkey")) return "sharkey";
  if (v.includes("catodon")) return "catodon";
  if (v.includes("pinetree")) return "pinetree";
  if (v.includes("misskey")) return "misskey";
  return "unknown";
}

/**
 * Combined flavour decision — the generalized `detectFamily`. Priority is
 * the plan's detection order: NodeInfo name first, then response shape,
 * then version markers. Never one substring alone: shape evidence
 * (`pleromaBody`/`pleromaFeatures`) and NodeInfo back each other up, and
 * ambiguous evidence stays "unknown".
 */
export function detectFlavor(evidence: DetectionEvidence): ServerFlavor {
  const fromNodeinfo = flavorFromNodeInfoName(evidence.nodeinfoName);
  if (fromNodeinfo !== "unknown") return fromNodeinfo;

  const pleromaFeatures = evidence.pleromaFeatures ?? [];
  if (evidence.pleromaBody || pleromaFeatures.includes("akkoma_api") || pleromaFeatures.includes("pleroma_api")) {
    return pleromaFeatures.includes("akkoma_api") ? "akkoma" : "pleroma";
  }
  if (evidence.misskeyBody) {
    // Misskey-shaped but unmarked: the version string may still name the
    // fork (Sharkey/Catodon builds sometimes embed it).
    const byVersion = flavorFromVersion(evidence.version);
    return byVersion === "misskey" || byVersion === "sharkey" || byVersion === "catodon" || byVersion === "pinetree"
      ? byVersion
      : "misskey";
  }
  if (evidence.mastodonBody) return "mastodon";

  return flavorFromVersion(evidence.version);
}

// --- Capabilities (three-state, plan §2.1) ---------------------------------

const UNKNOWN_ALL = (): Capabilities => {
  const out = {} as Capabilities;
  for (const key of FEATURE_KEYS) out[key] = "unknown";
  return out;
};

/**
 * Flavor table defaults. Conservative on purpose: verified facts from
 * `docs/api-surface.md` / `docs/mastoapi-contract.md` are "supported" /
 * "unsupported"; anything not verified stays "unknown" — an unknown flag
 * must never unlock a UI affordance. Probe evidence can raise an "unknown"
 * (see `buildCapabilities`) but never silently downgrade a verified fact
 * except where the docs say the feature is absent.
 */
const FLAVOR_FEATURES: Record<ServerFlavor, Partial<Capabilities>> = {
  misskey: {
    mfm: "supported",
    reactions: "supported",
    reaction_acceptance: "supported",
    quote_posting: "supported",
    // `notes/create` poll takes `multiple` (v1 `docs/api-surface.md:67`,
    // verified against Misskey/Sharkey/Pinetree backends).
    polls_multi: "supported",
    // v1 shipped `notes/edit` (`frontend/src/misskey/noteEdit.ts`); the
    // menu degrades honestly until the W3 editor connects `onEdit`.
    status_editing: "supported",
    // v1 shipped scheduling (`FloatingComposer` + `schedule.ts`) and the
    // v2 backend implements list/create/delete; the date-picker polish
    // is W3 (C8).
    scheduled_posts: "supported",
    // v1 shipped server drafts (`serverDrafts.ts`); the v2 backend
    // implements list/create/update/delete/count; the UI is W3 (C9).
    server_drafts: "supported",
    local_only: "supported",
    drive: "supported",
    antennas: "supported",
    lists: "supported",
    clips: "supported",
    // v1 shipped `i/favorites` + `notes/favorites/create|delete`
    // (`frontend/src/misskey/favorites.ts`, `NoteMenu.tsx:490`).
    bookmarks: "supported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  sharkey: {
    mfm: "supported",
    reactions: "supported",
    reaction_acceptance: "supported",
    quote_posting: "supported",
    // Same `notes/create` poll `multiple` support as Misskey (v1
    // `docs/api-surface.md:67`).
    polls_multi: "supported",
    // Sharkey-family `notes/edit` (same Misskey-family endpoint v1
    // shipped in `noteEdit.ts`).
    status_editing: "supported",
    // Same shipped scheduling + server-draft endpoints as Misskey.
    scheduled_posts: "supported",
    server_drafts: "supported",
    local_only: "supported",
    drive: "supported",
    antennas: "supported",
    lists: "supported",
    clips: "supported",
    // Same `i/favorites` + `notes/favorites/*` endpoints v1 shipped.
    bookmarks: "supported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  catodon: {
    mfm: "supported",
    reactions: "supported",
    quote_posting: "supported",
    local_only: "supported",
    drive: "supported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  // Pinetree gaps verified 404/reject (state/STATE.md "Decisions since
  // stonekey"): no drive/files listing, no antennas, polls rejected, and
  // no Miauth (it uses the native `signin`). `translation: unsupported`
  // is live-probed: `POST :3000/api/meta` answers
  // `translatorAvailable: false` (2026-10-20 session).
  pinetree: {
    mfm: "supported",
    reactions: "supported",
    quote_posting: "supported",
    polls_multi: "unsupported",
    local_only: "supported",
    drive: "unsupported",
    antennas: "unsupported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "unsupported",
    translation: "unsupported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  mastodon: {
    mfm: "unsupported",
    reactions: "unsupported",
    polls_multi: "unsupported",
    status_editing: "supported",
    scheduled_posts: "supported",
    server_drafts: "unsupported",
    local_only: "unsupported",
    drive: "unsupported",
    antennas: "unsupported",
    channels: "unsupported",
    chats: "unsupported",
    lists: "supported",
    bookmarks: "supported",
    clips: "unsupported",
    favourites_distinct_from_reactions: "supported",
    streaming: "supported",
    password_grant: "unsupported",
    mfa_challenge: "unsupported",
    pkce: "supported",
    miauth: "unsupported",
  },
  akkoma: {
    mfm: "supported",
    reactions: "supported",
    status_editing: "supported",
    local_only: "supported",
    lists: "supported",
    clips: "unsupported",
    favourites_distinct_from_reactions: "supported",
    translation: "supported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "supported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  pleroma: {
    status_editing: "supported",
    reactions: "supported",
    favourites_distinct_from_reactions: "supported",
    clips: "unsupported",
    local_only: "supported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "supported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  unknown: {},
};

/** Evidence-derived overrides (contract §9 for the Pleroma/Akkoma feature
 * flags). Evidence can only raise from "unknown" or contradict the table
 * where the server itself is authoritative. */
export function buildCapabilities(
  flavor: ServerFlavor,
  evidence: DetectionEvidence = {},
): Capabilities {
  const out: Capabilities = { ...UNKNOWN_ALL(), ...FLAVOR_FEATURES[flavor] };
  const has = (flag: string) => (evidence.pleromaFeatures ?? []).includes(flag);

  if (has("pleroma_emoji_reactions") || has("exposable_reactions")) {
    out.reactions = "supported";
  }
  if (has("quote_posting")) out.quote_posting = "supported";
  // Vanilla Mastodon gained quote posting in 4.5.
  if (flavor === "mastodon" && typeof evidence.version === "string") {
    const m = evidence.version.match(/^(\d+)\.(\d+)/);
    if (m && (Number(m[1]) > 4 || (Number(m[1]) === 4 && Number(m[2]) >= 5))) {
      out.quote_posting = "supported";
    }
  }
  if (has("editing")) out.status_editing = "supported";
  if (has("akkoma:machine_translation")) out.translation = "supported";

  // Meta-level hint (Misskey-family `translatorAvailable`, when present).
  if (typeof evidence.translatorAvailable === "boolean") {
    out.translation = evidence.translatorAvailable ? "supported" : "unsupported";
  }
  return out;
}

// --- Probing ---------------------------------------------------------------

export interface ProbeResponse {
  status: number;
  body: unknown;
}

export type Prober = (
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) => Promise<ProbeResponse>;

export interface DetectOptions {
  prober?: Prober;
  timeoutMs?: number;
}

export interface ServerDetection {
  /** null when no evidence placed the server in either family. */
  family: ServerFamily | null;
  flavor: ServerFlavor;
  /** Best-known version string (NodeInfo or probe), or null. */
  version: string | null;
  features: Capabilities;
  /** Which source decided the flavor (for diagnostics/tests). */
  decidedBy: "nodeinfo" | "probe-shape" | "version" | "none";
  /** The collected probe evidence (kept so sessions can recompute
   * capabilities from the current flavor table later). */
  evidence: DetectionEvidence;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Misskey-family `/api/meta` body markers (shape, not one field alone). */
export function looksMisskey(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return (
    typeof body.maxNoteTextLength === "number" ||
    typeof body.maintainerName === "string" ||
    ("name" in body && "uri" in body && !("domain" in body) && !("configuration" in body))
  );
}

/** Mastodon-family instance body markers (v1 or v2). */
export function looksMastodon(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return (
    "domain" in body ||
    "configuration" in body ||
    "pleroma" in body ||
    "max_toot_chars" in body
  );
}

export function pleromaFeaturesOf(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  const pleroma = body.pleroma;
  if (!isPlainObject(pleroma)) return [];
  const metadata = pleroma.metadata;
  if (!isPlainObject(metadata)) return [];
  const features = metadata.features;
  return Array.isArray(features)
    ? features.filter((f): f is string => typeof f === "string")
    : [];
}

function versionOf(body: unknown): string | null {
  if (!isPlainObject(body)) return null;
  return typeof body.version === "string" && body.version.length > 0 ? body.version : null;
}

/** NodeInfo secondary source: discovery document → 2.1 (or last) link. Only
 * same-origin hrefs are followed. Tolerant — null on any failure. */
async function fetchNodeinfo(
  origin: string,
  prober: Prober,
): Promise<{ name: string | null; version: string | null; body: unknown } | null> {
  const disco = await prober("GET", `${origin}/.well-known/nodeinfo`);
  if (disco.status !== 200 || !isPlainObject(disco.body)) return null;
  const links = Array.isArray(disco.body.links) ? disco.body.links : [];
  const preferred =
    links.find(
      (l) => isPlainObject(l) && typeof l.rel === "string" && l.rel.includes("/2.1"),
    ) ?? links[links.length - 1];
  const href = isPlainObject(preferred) ? preferred.href : null;
  if (typeof href !== "string") return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return null; // never follow a cross-origin href
  const doc = await prober("GET", url.toString());
  if (doc.status !== 200 || !isPlainObject(doc.body)) return null;
  const software = doc.body.software;
  const name = isPlainObject(software) && typeof software.name === "string" ? software.name : null;
  const version =
    isPlainObject(software) && typeof software.version === "string" ? software.version : null;
  return { name, version, body: doc.body };
}

async function defaultProber(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  timeoutMs = 8_000,
): Promise<ProbeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      credentials: "omit",
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: ctrl.signal,
    });
    const raw = res.status === 204 ? "" : await res.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detect family + flavor + capabilities for `origin`. Never throws: probes
 * that fail simply contribute no evidence (a timeout is never evidence of
 * absence), and an unreachable server reports flavor "unknown".
 */
export async function detectServer(
  origin: string,
  opts: DetectOptions = {},
): Promise<ServerDetection> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const prober: Prober =
    opts.prober ?? ((method, url, body) => defaultProber(method, url, body, timeoutMs));

  const evidence: DetectionEvidence = {
    nodeinfoName: null,
    nodeinfoVersion: null,
    version: null,
    pleromaBody: false,
    pleromaFeatures: [],
    misskeyBody: false,
    mastodonBody: false,
  };

  // 1. NodeInfo software.name first.
  const nodeinfo = await fetchNodeinfo(origin, prober);
  if (nodeinfo) {
    evidence.nodeinfoName = nodeinfo.name;
    evidence.nodeinfoVersion = nodeinfo.version;
    const nodeinfoFeatures = pleromaFeaturesOf(nodeinfo.body);
    if (nodeinfoFeatures.length > 0) evidence.pleromaFeatures = nodeinfoFeatures;
  }
  const nodeinfoFlavor = flavorFromNodeInfoName(evidence.nodeinfoName);

  // 2. Family probe — needed for shape evidence and version when NodeInfo
  //    did not decide (or was absent).
  if (nodeinfoFlavor === "unknown") {
    // Misskey-family probe first: `POST /api/meta` is public on every
    // Misskey-family server; elsewhere it 404s and costs one request.
    const meta = await prober("POST", `${origin}/api/meta`, {});
    if (meta.status === 200 && looksMisskey(meta.body)) {
      evidence.misskeyBody = true;
      evidence.version = versionOf(meta.body);
      const translator = (meta.body as { translatorAvailable?: unknown }).translatorAvailable;
      evidence.translatorAvailable = typeof translator === "boolean" ? translator : null;
    } else {
      // Mastodon-family probe: v2 → v1 fallback on 404/405 ONLY (never on
      // timeout/401/403/5xx — see the header comment).
      const v2 = await prober("GET", `${origin}/api/v2/instance`);
      let instanceBody: unknown = null;
      if (v2.status === 200) {
        instanceBody = v2.body;
      } else if (v2.status === 404 || v2.status === 405) {
        const v1 = await prober("GET", `${origin}/api/v1/instance`);
        if (v1.status === 200) instanceBody = v1.body;
      }
      if (instanceBody !== null && looksMastodon(instanceBody)) {
        evidence.mastodonBody = true;
        evidence.version = versionOf(instanceBody);
        evidence.pleromaBody = isPlainObject(instanceBody) && "pleroma" in instanceBody;
        evidence.pleromaFeatures = pleromaFeaturesOf(instanceBody);
      }
    }
  } else {
    evidence.version = evidence.nodeinfoVersion;
  }

  // 3. Heuristics over the collected evidence.
  const flavor = detectFlavor(evidence);
  const decidedBy: ServerDetection["decidedBy"] =
    nodeinfoFlavor !== "unknown"
      ? "nodeinfo"
      : evidence.misskeyBody || evidence.mastodonBody || evidence.pleromaBody
        ? "probe-shape"
        : flavor !== "unknown"
          ? "version"
          : "none";

  return {
    family: familyOf(flavor) ?? (evidence.misskeyBody ? "misskey" : evidence.mastodonBody ? "mastodon" : null),
    flavor,
    version: evidence.version ?? evidence.nodeinfoVersion ?? null,
    features: buildCapabilities(flavor, evidence),
    decidedBy,
    evidence,
  };
}
