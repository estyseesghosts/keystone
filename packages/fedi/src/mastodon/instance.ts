// Instance discovery + normalized capabilities
// (docs/mastoapi-contract.md §3, keystodon.md §5).
//
// Order: GET /api/v2/instance → fall back to GET /api/v1/instance on
// 404/405 ONLY. Never fall back on timeout/401/403/other 4xx/5xx.
// Akkoma has NO v2 instance, so the fallback is the common path there.
//
// Normalization rules:
// - Unknown values are `null` (or a missing key) — never "undefined" strings.
// - Family detection combines the version marker, response shape
//   (`pleroma.metadata`), and NodeInfo — never a strict version parse.
// - Feature flags distinguish "supported" / "unsupported" / "unknown";
//   extension gating elsewhere keys off this (contract §9).

import { isUnsupportedError, request, toApiError } from "./client";
import { resolveSameOriginUrl, type FetchImpl } from "../core/http";
import type { InstanceV1, InstanceV2, NodeInfo } from "./wire";

export type ServerFamily = "mastodon" | "pleroma" | "akkoma" | "unknown";
export type FeatureSupport = "supported" | "unsupported" | "unknown";

export interface InstanceCapabilities {
  origin: string;
  domain: string | null;
  title: string | null;
  version: string | null;
  maxStatusCharacters: number | null;
  maxMediaAttachments: number | null;
  /** Normalized `ws(s)://host[:port]` streaming origin, or null when the
   * instance did not advertise one — or the advertisement was refused
   * (foreign host, IP literal, credentials, scheme mismatch: privacy 6).
   * NEVER assume the REST host; null means "dial the session origin". */
  streamingOrigin: string | null;
  /** Why the advertised streaming origin was accepted or refused
   * (`decideStreamingOrigin` reason; persisted for the UI evidence). */
  streamingOriginReason: StreamingOriginReason | null;
  serverFamily: ServerFamily;
  features: Record<string, FeatureSupport>;
}

/**
 * Known feature keys (values are three-state on purpose):
 * - `emoji_reactions`  — Pleroma/Akkoma reaction chips (owner directive:
 *                        OFF on vanilla Mastodon → hide controls, never
 *                        delete the reaction code).
 * - `quote_posting`    — structured quote composition support.
 * - `status_editing`   — PUT /api/v1/statuses/:id.
 * - `translation`      — POST /statuses/:id/translate availability.
 * - `password_grant`   — internal login via ROPC (Akkoma/Pleroma only).
 * - `mfa_challenge`    — /oauth/mfa/challenge (Akkoma/Pleroma only).
 * - `pkce`             — PKCE on /oauth/authorize (Mastodon 4.3+; sending
 *                        it to servers without support is harmless).
 */
export type KnownFeature =
  | "emoji_reactions"
  | "quote_posting"
  | "status_editing"
  | "translation"
  | "password_grant"
  | "mfa_challenge"
  | "pkce";

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Normalize a streaming host advertisement to a `ws(s)://host[:port]`
 * origin. `configuration.urls.streaming` (v2) may be a DIFFERENT host;
 * `urls.streaming_api` (v1) is Akkoma's ws origin. When the session
 * origin is known the advertised host must ALSO belong to it (see
 * `decideStreamingOrigin`): a mismatch answers null so the stream client
 * falls back to the session origin's mapping instead of handing the
 * token to a third host (contract §8, privacy 6). */
export function normalizeStreamingOrigin(
  raw: unknown,
  sessionOrigin?: string | null,
): string | null {
  return decideStreamingOrigin(sessionOrigin ?? null, raw).origin;
}

/** Why an advertised streaming origin was accepted or refused. Kept in
 * `evidence` (via `streamingEvidenceFor`) so the UI can say why the REST
 * origin is dialed instead of the advertised host. */
export type StreamingOriginReason =
  | "equal"
  | "subdomain"
  | "sibling"
  | "unvalidated"
  | "scheme-mismatch"
  | "foreign"
  | "ip-literal"
  | "credentials"
  | "invalid";

/** The validator's answer: the ws(s) origin to dial (null = refused, dial
 * the session origin instead) plus the reason for the evidence record. */
export interface StreamingOriginDecision {
  origin: string | null;
  reason: StreamingOriginReason;
}

/** True when the hostname is an IP literal in any common encoding — never
 * an acceptable streaming advertisement (a token must not ride to a bare
 * address on a stranger's word alone). DNS names go through the
 * equal/subdomain/sibling checks below. */
function isIpLiteralHost(host: string): boolean {
  if (host.includes(":")) return true; // IPv6 literal (`URL` strips the brackets)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true; // dotted IPv4
  if (/^\d+$/.test(host)) return true; // decimal single-part
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true; // hex single-part
  if (/^0[0-7]+$/.test(host)) return true; // octal single-part
  return false;
}

/** Accept an advertised streaming origin only for its own session origin:
 * the scheme must pin as before (`https` → `wss`, `http` → `ws`), and the
 * advertised host must equal the session host, be a subdomain of it, or be
 * a sibling under a shared parent of at least two labels (so `evil.com`
 * can never pass as a "sibling" of `victim.com` through the bare `com`).
 * Anything else — foreign hosts, IP literals, userinfo-bearing URLs —
 * is refused (null) so the client dials the session origin instead; the
 * reason survives for the evidence record. Without a session origin the
 * scheme-mapped origin is returned unvalidated (the composer-limits path).
 * Pure. */
export function decideStreamingOrigin(
  sessionOrigin: string | null | undefined,
  raw: unknown,
): StreamingOriginDecision {
  const value = strOrNull(raw);
  if (!value) return { origin: null, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { origin: null, reason: "invalid" };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { origin: null, reason: "credentials" };
  }
  let origin: string;
  if (url.protocol === "ws:" || url.protocol === "wss:") origin = url.origin;
  else if (url.protocol === "http:") origin = `ws://${url.host}`;
  else if (url.protocol === "https:") origin = `wss://${url.host}`;
  else return { origin: null, reason: "invalid" };
  if (!sessionOrigin) return { origin, reason: "unvalidated" };
  let session: URL;
  try {
    session = new URL(sessionOrigin);
  } catch {
    return { origin: null, reason: "invalid" };
  }
  const expected = session.protocol === "https:" ? "wss:" : session.protocol === "http:" ? "ws:" : null;
  if (expected !== null && new URL(origin).protocol !== expected) {
    return { origin: null, reason: "scheme-mismatch" };
  }
  const sessionHost = session.hostname.toLowerCase().replace(/\.$/, "");
  const advHost = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!sessionHost || !advHost) return { origin: null, reason: "invalid" };
  if (isIpLiteralHost(advHost)) return { origin: null, reason: "ip-literal" };
  if (advHost === sessionHost) return { origin, reason: "equal" };
  if (advHost.endsWith(`.${sessionHost}`)) return { origin, reason: "subdomain" };
  const sessionLabels = sessionHost.split(".");
  const advLabels = advHost.split(".");
  if (
    sessionLabels.length >= 3 &&
    advLabels.length >= 3 &&
    sessionLabels.slice(1).join(".") === advLabels.slice(1).join(".")
  ) {
    return { origin, reason: "sibling" };
  }
  return { origin: null, reason: "foreign" };
}

/** The persisted evidence shape for a streaming-origin decision (X3.4
 * copies this into `Session.evidence`, which owns the widened fields).
 * `streamingOrigin` is the validated ws(s) origin (null = refused, dial
 * the session origin); `streamingOriginReason` is the `decide` reason. */
export interface StreamingOriginEvidence {
  streamingOrigin: string | null;
  streamingOriginReason: StreamingOriginReason | null;
}

/** Evidence patch for a streaming advertisement: the validated origin plus
 * its reason, ready for X3.4 to persist on the session. Pure. */
export function streamingEvidenceFor(
  sessionOrigin: string | null | undefined,
  raw: unknown,
): StreamingOriginEvidence {
  const decided = decideStreamingOrigin(sessionOrigin, raw);
  return { streamingOrigin: decided.origin, streamingOriginReason: decided.reason };
}

/** Family detection: substring markers on the version FIRST (Akkoma's
 * format changed across releases — "compatible; Pleroma" → "compatible;
 * Akkoma" — never parse strictly), then response shape, then NodeInfo.
 * Mastodon forks collapse to `mastodon` (MD11): glitch-soc and Hometown
 * report Mastodon-compatible versions, GoToSocial speaks the Mastodon
 * API — recorded live-unverified (no GTS on the rig). Stays "unknown"
 * when the evidence is ambiguous. */
export function detectFamily(
  version: string | null,
  pleromaBody: boolean,
  pleromaFeatures: readonly string[],
  nodeinfoName?: string | null,
): ServerFamily {
  const v = (version ?? "").toLowerCase();
  if (v.includes("akkoma")) return "akkoma";
  if (v.includes("pleroma")) return "pleroma";
  if (
    v.includes("mastodon") ||
    v.includes("glitch") ||
    v.includes("hometown") ||
    v.includes("gotosocial")
  )
    return "mastodon";
  // Shape evidence: Akkoma/Pleroma always serialize `pleroma.metadata`;
  // Akkoma advertises its own feature flag.
  if (pleromaBody || pleromaFeatures.includes("akkoma_api")) {
    return pleromaFeatures.includes("akkoma_api") ? "akkoma" : "pleroma";
  }
  const soft = (nodeinfoName ?? "").toLowerCase();
  if (soft === "akkoma") return "akkoma";
  if (soft === "pleroma") return "pleroma";
  // NodeInfo `software.name` for the collapsed forks (MD11 — same
  // Mastodon-API treatment as the version markers above).
  if (soft === "mastodon" || soft === "glitch-soc" || soft === "hometown" || soft === "gotosocial") {
    return "mastodon";
  }
  return "unknown";
}

function buildFeatures(
  family: ServerFamily,
  pleromaFeatures: readonly string[],
  v1: InstanceV1 | null,
  v2: InstanceV2 | null,
): Record<string, FeatureSupport> {
  const has = (flag: string) => pleromaFeatures.includes(flag);
  const features: Record<string, FeatureSupport> = {
    emoji_reactions: "unknown",
    quote_posting: "unknown",
    status_editing: "unknown",
    translation: "unknown",
    password_grant: "unknown",
    mfa_challenge: "unknown",
    pkce: "unknown",
  };

  // Pleroma/Akkoma instance-metadata evidence (contract §9).
  if (has("pleroma_emoji_reactions") || has("exposable_reactions")) {
    features.emoji_reactions = "supported";
  }
  if (has("quote_posting")) features.quote_posting = "supported";
  if (has("editing")) features.status_editing = "supported";
  if (has("akkoma:machine_translation")) features.translation = "supported";

  // Translation config lives under configuration.* on Mastodon (v1+v2).
  const translationCfg =
    v2?.configuration?.translation?.enabled ?? v1?.configuration?.translation?.enabled;
  if (typeof translationCfg === "boolean") {
    features.translation = translationCfg ? "supported" : "unsupported";
  }

  if (family === "akkoma" || family === "pleroma") {
    // Verified in source: native ROPC + MFA challenge (contract §2.2),
    // native reaction extension (contract §9).
    features.password_grant = "supported";
    features.mfa_challenge = "supported";
    features.pkce = "unsupported"; // grep-verified absent on Akkoma 3.20
    if (features.emoji_reactions === "unknown") features.emoji_reactions = "supported";
  } else if (family === "mastodon") {
    // grant_flows = authorization_code + client_credentials only; no
    // password grant exists (contract §2.2). Reactions: OFF — favourite
    // ❤ + reblog 🔁 only; the chips UI hides with a reason.
    features.password_grant = "unsupported";
    features.mfa_challenge = "unsupported";
    features.emoji_reactions = "unsupported";
    features.pkce = "supported"; // 4.3+; harmless on older servers
  }

  return features;
}

/** NodeInfo secondary detection (contract §3): only used when the version
 * and response shape leave the family ambiguous. Never follows a
 * cross-origin href. Tolerant — returns null on any failure. */
export async function fetchNodeinfo(
  origin: string,
  timeoutMs = 8_000,
  fetchImpl?: FetchImpl,
): Promise<NodeInfo | null> {
  try {
    const disco = await request<{ links?: Array<{ rel?: string; href?: string }> }>(
      origin,
      "/.well-known/nodeinfo",
      { timeoutMs, fetchImpl },
    );
    const links = Array.isArray(disco.data?.links) ? disco.data.links : [];
    const preferred =
      links.find((l) => typeof l.rel === "string" && l.rel.includes("/2.1")) ??
      links[links.length - 1];
    const href = preferred?.href;
    if (typeof href !== "string") return null;
    const same = resolveSameOriginUrl(origin, href);
    if (!same) return null;
    const info = await request<NodeInfo>(origin, same, { timeoutMs, fetchImpl });
    return info.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch and normalize instance metadata for `origin`.
 * v2 → v1 fallback on 404/405 only; every other failure propagates as a
 * typed error (a timeout is never treated as "v2 missing"). Transport
 * failures leave here as the shared `ApiError` (MD12 — so
 * `isUnsupportedError`/`isPermissionError` read direct instance calls
 * the same as backend calls); the v2→v1 probe still branches on the raw
 * transport error internally.
 */
export async function fetchInstanceCapabilities(
  origin: string,
  opts: { timeoutMs?: number; token?: string | null; fetchImpl?: FetchImpl } = {},
): Promise<InstanceCapabilities> {
  try {
    return await fetchInstanceCapabilitiesInner(origin, opts);
  } catch (err) {
    throw toApiError(err);
  }
}

async function fetchInstanceCapabilitiesInner(
  origin: string,
  opts: { timeoutMs?: number; token?: string | null; fetchImpl?: FetchImpl } = {},
): Promise<InstanceCapabilities> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const token = opts.token ?? null;
  const fetchImpl = opts.fetchImpl;

  let v2: InstanceV2 | null = null;
  let v1: InstanceV1 | null = null;

  try {
    const res = await request<InstanceV2>(origin, "/api/v2/instance", { timeoutMs, token, fetchImpl });
    v2 = res.data ?? null;
  } catch (err) {
    if (!isUnsupportedError(err)) throw err; // never fall back on timeout/401/403/5xx
    const res = await request<InstanceV1>(origin, "/api/v1/instance", { timeoutMs, token, fetchImpl });
    v1 = res.data ?? null;
  }

  // Mastodon can serve BOTH shapes; Akkoma only v1. Read both when present
  // (contract §3: v1 in this Mastodon version still carries configuration).
  if (!v1 && v2) {
    try {
      const res = await request<InstanceV1>(origin, "/api/v1/instance", { timeoutMs, token, fetchImpl });
      v1 = res.data ?? null;
    } catch {
      // v1 enrichment is optional — v2 alone is authoritative on Mastodon.
    }
  }

  const version = strOrNull(v2?.version) ?? strOrNull(v1?.version);
  const pleromaMeta = v1?.pleroma?.metadata;
  const pleromaFeatures = Array.isArray(pleromaMeta?.features)
    ? pleromaMeta.features.filter((f): f is string => typeof f === "string")
    : [];
  const pleromaBody = v1?.pleroma !== undefined || v2?.pleroma !== undefined;

  // Secondary detection only while ambiguous (contract §3).
  let nodeinfo: NodeInfo | null = null;
  const preliminary = detectFamily(version, pleromaBody, pleromaFeatures, null);
  if (preliminary === "unknown") {
    nodeinfo = await fetchNodeinfo(origin, timeoutMs, fetchImpl);
  }
  const family = detectFamily(
    version,
    pleromaBody,
    pleromaFeatures,
    nodeinfo?.software?.name ?? null,
  );

  // `domain` (v2) and `uri` (v1) are the instance domain — distinct from
  // Account fields (acct/url), never conflated (keystodon.md §7).
  const domain = strOrNull(v2?.domain) ?? strOrNull(v1?.uri) ?? null;

  const streaming = decideStreamingOrigin(
    origin,
    v2?.configuration?.urls?.streaming ?? v1?.urls?.streaming_api ?? null,
  );

  return {
    origin,
    domain,
    title: strOrNull(v2?.title) ?? strOrNull(v1?.title),
    version,
    maxStatusCharacters:
      numOrNull(v2?.configuration?.statuses?.max_characters) ??
      numOrNull(v1?.configuration?.statuses?.max_characters) ??
      numOrNull(v1?.max_toot_chars),
    maxMediaAttachments: numOrNull(v2?.configuration?.statuses?.max_media_attachments),
    streamingOrigin: streaming.origin,
    streamingOriginReason: streaming.reason,
    serverFamily: family,
    features: buildFeatures(family, pleromaFeatures, v1, v2),
  };
}

/**
 * Reactions capability gate (handoff §2 / contract §9): ON when a fetched
 * Status carries `emoji_reactions` OR instance metadata advertises the
   extension; vanilla Mastodon → OFF (chips hidden, favourite ❤ only).
 * Never probed by 404 alone. Unknown → OFF: never show extension controls
 * without positive evidence. */
export function reactionsSupported(
  caps: Pick<InstanceCapabilities, "features"> | null,
  sample?: { emoji_reactions?: unknown } | null,
): boolean {
  if (sample && Array.isArray(sample.emoji_reactions)) return true;
  return caps?.features?.emoji_reactions === "supported";
}
