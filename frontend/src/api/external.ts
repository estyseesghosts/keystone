// External Misskey-family accounts: Keystone as an *external* client.
//
// The internal login flow is UNCHANGED and lives in `./client` + `../state/auth`:
// same-backend `signin-flow` -> `miauth/gen-token` -> check through the Vite
// proxy, tokens under per-backend keys. Nothing here touches that path.
//
// This module adds a second, independent path for testing Keystone against a
// live, populated server: the standard external MiAuth flow, which happens
// OUTSIDE Keystone on the host instance (Keystone never sees the password):
//
//   1. Keystone mints a session id and opens
//      `https://<host>/miauth/<session>?name=..&permission=..&callback=..`
//      in a new tab. The user approves (or denies) on the host instance.
//   2. Keystone polls `POST https://<host>/api/miauth/<session>/check`
//      (direct fetch — Misskey-family API servers answer CORS `origin: *`,
//      verified in `ApiServerService.ts`) until `{ ok: true, token, user }`.
//   3. The issued token is verified with `POST https://<host>/api/i`, then
//      stored in `keystone_external_sessions`. All later API traffic for that
//      account goes direct to `https://<host>/api/...` — the internal proxy
//      path is never used for external tokens, and an external token is never
//      sent to the configured internal backend (per-host session isolation,
//      mirroring the per-backend isolation of internal tokens).
//
// Streaming stays on the internal proxy socket only: an external token must
// never be sent to the local `/streaming` endpoint, so `api/stream`
// refuses to open a socket while an external account is active (feeds still
// work via paging + refresh). This has NOT been exercised against a live
// server from this machine (no browser / no public instance here) — the
// browser round-trip is marked not yet verified.

import { KEYSTONE_APP_NAME, KEYSTONE_PERMISSIONS } from "./backend";
import { ApiError } from "./error";
import type { MeDetailed } from "./types";

export type ExternalScheme = "https" | "http";

export interface ExternalSession {
  /** Normalized bare host (`example.com`, `example.com:3000`). No scheme. */
  host: string;
  scheme: ExternalScheme;
  token: string;
  user: MeDetailed;
}

const SESSIONS_KEY = "keystone_external_sessions";
const ACTIVE_KEY = "keystone_active_external";

/** Normalize user-entered host text to a bare host + scheme.
 * Accepts `example.com`, `https://example.com`, `example.com:3000`,
 * `http://host:port/path…`. Defaults to https; an explicit `http://` is
 * honored (local test targets). Throws a human-readable Error otherwise. */
export function normalizeHost(input: string): {
  host: string;
  scheme: ExternalScheme;
} {
  const raw = input.trim();
  if (!raw) throw new Error("Enter an instance host, e.g. example.com.");
  let scheme: ExternalScheme = "https";
  let withScheme = raw;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  if (schemeMatch) {
    const given = schemeMatch[1].toLowerCase();
    if (given !== "https" && given !== "http") {
      throw new Error("Use an http(s) instance address, e.g. example.com.");
    }
    scheme = given;
    withScheme = raw;
  } else {
    withScheme = `https://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That host does not look like a valid instance address.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname.includes(" ")) {
    throw new Error("That host does not look like a valid instance address.");
  }
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  return { host, scheme };
}

export function externalOrigin(
  scheme: ExternalScheme,
  host: string,
): string {
  return `${scheme}://${host}`;
}

export function newExternalSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** The host-instance authorize URL Keystone opens in a new tab.
 * `permission` is comma-separated (the instance page splits on commas —
 * see Misskey `pages/miauth.vue`). `callback` is optional: when present the
 * instance redirects back with `?session=<session>` appended. */
export function buildMiauthUrl(
  scheme: ExternalScheme,
  host: string,
  session: string,
  callback?: string,
): string {
  const params = new URLSearchParams({
    name: KEYSTONE_APP_NAME,
    permission: KEYSTONE_PERMISSIONS.join(","),
  });
  if (callback) params.set("callback", callback);
  return `${externalOrigin(scheme, host)}/miauth/${encodeURIComponent(session)}?${params.toString()}`;
}

export interface MiauthCheckResponse {
  ok: boolean;
  token?: string;
  user?: unknown;
}

interface ApiErrorBody {
  error?: { message?: string; code?: string; kind?: string };
}

/** POST to an absolute instance URL with Misskey-family semantics: 204 is
 * empty success (never blind `response.json()`), non-JSON errors keep the
 * HTTP status on the thrown ApiError. A hard timeout converts a hung
 * request into a retryable error naming the endpoint — feeds must never
 * sit on eternal skeletons because one call never settled. */
const DIRECT_TIMEOUT_MS = 30_000;

async function postDirect<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(
      err instanceof DOMException && err.name === "AbortError"
        ? `Request timed out (${url}): the instance did not answer within ${DIRECT_TIMEOUT_MS / 1000}s. Retry.`
        : `Could not reach the instance (${err instanceof Error ? err.message : "network error"}). Is the host correct?`,
    );
  } finally {
    clearTimeout(timer);
  }
  const raw = response.status === 204 ? "" : await response.text();
  let payload: unknown;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError(`API returned invalid JSON (HTTP ${response.status})`, response.status);
    }
  }
  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    throw new ApiError(
      apiError?.error?.message ?? `API error: HTTP ${response.status}`,
      response.status,
      apiError?.error?.code,
      apiError?.error?.kind,
    );
  }
  return payload as T;
}

/** Poll the host instance for the user's MiAuth decision. `{ ok: false }`
 * means "not approved yet" — not an error. */
export function checkExternalSession(
  scheme: ExternalScheme,
  host: string,
  session: string,
): Promise<MiauthCheckResponse> {
  return postDirect<MiauthCheckResponse>(
    `${externalOrigin(scheme, host)}/api/miauth/${encodeURIComponent(session)}/check`,
    {},
  );
}

/** Verify an issued external token and pack the account user. */
export function fetchExternalMe(
  scheme: ExternalScheme,
  host: string,
  token: string,
): Promise<MeDetailed> {
  return postDirect<MeDetailed>(`${externalOrigin(scheme, host)}/api/i`, {
    i: token,
  });
}

/** Authenticated API call against an external instance (direct fetch). */
export function externalApiCall<T>(
  scheme: ExternalScheme,
  host: string,
  token: string,
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return postDirect<T>(
    `${externalOrigin(scheme, host)}/api/${endpoint}`,
    { ...params, i: params.i ?? token },
  );
}

/** Multipart Drive upload against an external instance (`drive/files/create`
 * is FormData, never JSON — same contract as the internal path). */
export async function externalUploadFile<T>(
  scheme: ExternalScheme,
  host: string,
  token: string,
  file: File,
  opts: { isSensitive?: boolean; comment?: string } = {},
): Promise<T> {
  const form = new FormData();
  form.append("i", token);
  form.append("file", file, file.name);
  if (opts.isSensitive !== undefined)
    form.append("isSensitive", String(opts.isSensitive));
  if (opts.comment !== undefined) form.append("comment", opts.comment);
  let response: Response;
  try {
    response = await fetch(`${externalOrigin(scheme, host)}/api/drive/files/create`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the instance (${err instanceof Error ? err.message : "network error"}). Is the host correct?`,
    );
  }
  const raw = response.status === 204 ? "" : await response.text();
  let payload: unknown;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError(
        `API returned invalid JSON (HTTP ${response.status})`,
        response.status,
      );
    }
  }
  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    throw new ApiError(
      apiError?.error?.message ?? `API error: HTTP ${response.status}`,
      response.status,
      apiError?.error?.code,
      apiError?.error?.kind,
    );
  }
  return payload as T;
}

/** Best-effort revocation of an external token (failures are ignored —
 * local state always clears regardless, same policy as internal sign-out). */
export function revokeExternalToken(
  scheme: ExternalScheme,
  host: string,
  token: string,
): Promise<void> {
  return externalApiCall<undefined>(scheme, host, token, "i/revoke-token", {})
    .then(() => undefined)
    .catch(() => undefined);
}

// --- Local storage (dev-only persistence, same caveat as internal tokens) ---

function readSessions(): ExternalSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ExternalSession =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { host?: unknown }).host === "string" &&
        typeof (s as { token?: unknown }).token === "string" &&
        typeof (s as { user?: unknown }).user === "object",
    );
  } catch {
    return [];
  }
}

export function loadExternalSessions(): ExternalSession[] {
  return readSessions();
}

function writeSessions(sessions: ExternalSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage unavailable: sessions last for this page only.
  }
}

/** Insert or replace the session for a host (one session per host). */
export function saveExternalSession(session: ExternalSession): ExternalSession[] {
  const next = [
    session,
    ...readSessions().filter((s) => s.host !== session.host),
  ];
  writeSessions(next);
  return next;
}

export function removeExternalSession(host: string): ExternalSession[] {
  const next = readSessions().filter((s) => s.host !== host);
  writeSessions(next);
  if (getActiveExternalHost() === host) setActiveExternalHost(null);
  return next;
}

export function updateExternalSessionUser(
  host: string,
  user: MeDetailed,
): ExternalSession[] {
  const next = readSessions().map((s) => (s.host === host ? { ...s, user } : s));
  writeSessions(next);
  return next;
}

export function getActiveExternalHost(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveExternalHost(host: string | null): void {
  try {
    if (host) localStorage.setItem(ACTIVE_KEY, host);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage unavailable: the switch lasts for this page only.
  }
}

/** The currently active external session, or null when the internal
 * (proxy) account is active. A stale pointer (host with no stored
 * session) resolves to null — never to a half session. */
export function getActiveExternal(): ExternalSession | null {
  const host = getActiveExternalHost();
  if (!host) return null;
  return readSessions().find((s) => s.host === host) ?? null;
}

/** True when an external account is active. The streaming client uses this
 * to stay off the local socket (an external token must never be sent to
 * the internal `/streaming` endpoint); feeds fall back to paging+refresh. */
export function isExternalAccountActive(): boolean {
  return getActiveExternal() !== null;
}
