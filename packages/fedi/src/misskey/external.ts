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
// Streaming is per-session: each session's pool targets its own origin,
// so an external token is never sent anywhere but its own instance
// (per-host session isolation, mirroring the per-backend isolation of
// internal tokens).

import { KEYSTONE_APP_NAME, KEYSTONE_PERMISSIONS } from "./auth";
import { ApiError, FediError } from "../core/errors";
import type { MeDetailed } from "./wire";
import type { Account } from "../core/models";
import type { ServerFamily, ServerFlavor } from "../core/detect";
import type { KeyValueStore } from "../core/sessions";
import { adaptMe } from "./adapt";

export type ExternalScheme = "https" | "http";

export interface ExternalSession {
  /** Normalized bare host (`example.com`, `example.com:3000`). No scheme. */
  host: string;
  scheme: ExternalScheme;
  token: string;
  user: Account;
  /** Server family: absent = "misskey" (legacy MiAuth sessions predate
   * the field and were all Misskey-family). Mastodon-family sessions ride
   * the same store and the same account switcher (plan §3 Phase 3 item 2
   * — "a Misskey and a Mastodon account switched between in one tab"). */
  family?: ServerFamily;
  /** Detected flavor; absent = "unknown". */
  flavor?: ServerFlavor;
}

const SESSIONS_KEY = "keystone_external_sessions";
const ACTIVE_KEY = "keystone_active_external";

/** Normalize user-entered host text to a bare host + scheme.
 * Accepts `example.com`, `https://example.com`, `example.com:3000`,
 * `http://host:port/path…`. Defaults to https; an explicit `http://` is
 * honored (local test targets). Throws a `FediError` (stable code +
 * English fallback) otherwise. */
export function normalizeHost(input: string): {
  host: string;
  scheme: ExternalScheme;
} {
  const raw = input.trim();
  if (!raw) {
    throw new FediError(
      "Enter an instance host, e.g. example.com.",
      "errors.validation.hostRequired",
    );
  }
  let scheme: ExternalScheme = "https";
  let withScheme = raw;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  if (schemeMatch) {
    const given = schemeMatch[1].toLowerCase();
    if (given !== "https" && given !== "http") {
      throw new FediError(
        "Use an http(s) instance address, e.g. example.com.",
        "errors.validation.hostScheme",
      );
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
    throw new FediError(
      "That host does not look like a valid instance address.",
      "errors.validation.hostInvalid",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname.includes(" ")) {
    throw new FediError(
      "That host does not look like a valid instance address.",
      "errors.validation.hostInvalid",
    );
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
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FediError(
        `Request timed out (${url}): the instance did not answer within ${DIRECT_TIMEOUT_MS / 1000}s. Retry.`,
        "errors.network.timeoutInstance",
        { target: url, n: DIRECT_TIMEOUT_MS / 1000 },
      );
    }
    const reason = err instanceof Error ? err.message : "network error";
    throw new FediError(
      `Could not reach the instance (${reason}). Is the host correct?`,
      "errors.network.unreachableInstance",
      { reason },
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
      throw new ApiError(
        `API returned invalid JSON (HTTP ${response.status})`,
        response.status,
        "errors.network.badJson",
        undefined,
        { status: response.status },
      );
    }
  }
  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    const serverMessage = apiError?.error?.message;
    throw new ApiError(
      typeof serverMessage === "string" ? serverMessage : `API error: HTTP ${response.status}`,
      response.status,
      apiError?.error?.code,
      apiError?.error?.kind,
      { status: response.status },
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

/** Verify an issued external token and pack the account user (core
 * Account — the wire shape never leaves this module). */
export async function fetchExternalMe(
  scheme: ExternalScheme,
  host: string,
  token: string,
): Promise<Account> {
  return adaptMe(
    await postDirect<MeDetailed>(`${externalOrigin(scheme, host)}/api/i`, {
      i: token,
    }),
  );
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
      credentials: "omit",
      body: form,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network error";
    throw new FediError(
      `Could not reach the instance (${reason}). Is the host correct?`,
      "errors.network.unreachableInstance",
      { reason },
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
        "errors.network.badJson",
        undefined,
        { status: response.status },
      );
    }
  }
  if (!response.ok) {
    const apiError = payload as ApiErrorBody | undefined;
    const serverMessage = apiError?.error?.message;
    throw new ApiError(
      typeof serverMessage === "string" ? serverMessage : `API error: HTTP ${response.status}`,
      response.status,
      apiError?.error?.code,
      apiError?.error?.kind,
      { status: response.status },
    );
  }
  return payload as T;
}

/** Best-effort revocation of an external token (failures are ignored —
 * local state always clears regardless, same policy as internal sign-out).
 * Misskey family: `i/revoke-token`; Mastodon family: `POST /oauth/revoke`
 * with the cached app credentials (RFC 7009) — dispatched through
 * `core/sessions.revokeSessionToken`, which owns both shapes. */
export function revokeExternalToken(
  scheme: ExternalScheme,
  host: string,
  token: string,
  family: ServerFamily = "misskey",
): Promise<void> {
  if (family === "mastodon") {
    return revokeSessionToken({
      id: "",
      origin: externalOrigin(scheme, host),
      family,
      flavor: "unknown",
      accountId: "",
      token,
      grant: "oauth-pkce",
      hosting: "third-party",
    });
  }
  return externalApiCall<undefined>(scheme, host, token, "i/revoke-token", {})
    .then(() => undefined)
    .catch(() => undefined);
}

// --- Local storage (dev-only persistence, same caveat as internal tokens) ---
//
// Phase 2 flip: external sessions live in the UNIFIED session store
// (`core/sessions.ts`, key `keystone_sessions`), keyed `${origin}
// ${accountId}` like every other session. This module keeps the
// `ExternalSession` facade shape the auth store and account UI use, and
// owns the wire->core user adaptation at that boundary.

import {
  getActiveSession,
  loadSessions,
  removeSession,
  revokeSessionToken,
  saveSession,
  sessionId,
  setActiveSessionId,
  type Session,
} from "../core/sessions";

function splitOrigin(origin: string): { scheme: ExternalScheme; host: string } {
  const scheme: ExternalScheme = origin.startsWith("http://") ? "http" : "https";
  return { scheme, host: origin.replace(/^https?:\/\//, "") };
}

function toExternal(s: Session): ExternalSession | null {
  if (s.hosting !== "third-party" || !s.user) return null;
  const { scheme, host } = splitOrigin(s.origin);
  return {
    host,
    scheme,
    token: s.token,
    user: s.user,
    family: s.family,
    flavor: s.flavor,
  };
}

function toSession(e: ExternalSession): Session {
  const origin = externalOrigin(e.scheme, e.host);
  const family = e.family ?? "misskey";
  return {
    id: sessionId(origin, e.user.id),
    origin,
    family,
    // The MiAuth flow never records which fork answered; detection
    // upgrades the flavor. "unknown" auths via the `i` body field, which
    // every Misskey-family server accepts. Mastodon-family sessions carry
    // their detected flavor (OAuth + Bearer either way).
    flavor: e.flavor ?? "unknown",
    accountId: e.user.id,
    token: e.token,
    grant: family === "mastodon" ? "oauth-pkce" : "miauth",
    hosting: "third-party",
    user: e.user,
  };
}

export function loadExternalSessions(store: KeyValueStore, origin?: string): ExternalSession[] {
  return loadSessions(store, origin)
    .map(toExternal)
    .filter((s): s is ExternalSession => s !== null);
}

/** Insert or replace the session for a host (one session per host —
 * signing in as a second account on the same host replaces the first,
 * exactly as the legacy store did). */
export function saveExternalSession(
  store: KeyValueStore,
  session: ExternalSession,
  origin?: string,
): ExternalSession[] {
  const sessionOrigin = externalOrigin(session.scheme, session.host);
  for (const s of loadSessions(store, origin)) {
    if (s.hosting === "third-party" && s.origin === sessionOrigin) removeSession(store, s.id, origin);
  }
  saveSession(store, toSession(session), origin);
  return loadExternalSessions(store, origin);
}

export function removeExternalSession(
  store: KeyValueStore,
  host: string,
  origin?: string,
): ExternalSession[] {
  const active = getActiveSession(store, origin);
  for (const s of loadSessions(store, origin)) {
    if (s.hosting === "third-party" && splitOrigin(s.origin).host === host) {
      removeSession(store, s.id, origin);
      if (active && active.id === s.id) setActiveSessionId(store, null, origin);
    }
  }
  return loadExternalSessions(store, origin);
}

export function updateExternalSessionUser(
  store: KeyValueStore,
  host: string,
  user: Account,
  origin?: string,
): ExternalSession[] {
  for (const s of loadSessions(store, origin)) {
    if (s.hosting === "third-party" && splitOrigin(s.origin).host === host) {
      saveSession(store, { ...s, user }, origin);
    }
  }
  return loadExternalSessions(store, origin);
}

export function getActiveExternalHost(store: KeyValueStore, origin?: string): string | null {
  const active = getActiveSession(store, origin);
  if (!active || active.hosting !== "third-party") return null;
  return splitOrigin(active.origin).host;
}

export function setActiveExternalHost(
  store: KeyValueStore,
  host: string | null,
  origin?: string,
): void {
  if (!host) {
    setActiveSessionId(store, null, origin);
    return;
  }
  const match = loadSessions(store, origin).find(
    (s) => s.hosting === "third-party" && splitOrigin(s.origin).host === host,
  );
  setActiveSessionId(store, match ? match.id : null, origin);
}

/** The currently active external session, or null when the internal
 * (proxy) account is active. A stale pointer (host with no stored
 * session) resolves to null — never to a half session. */
export function getActiveExternal(store: KeyValueStore, origin?: string): ExternalSession | null {
  const active = getActiveSession(store, origin);
  if (!active) return null;
  return toExternal(active);
}

/** True when an external account is active in the given store. */
// (Streaming no longer consults this — each session's pool targets its
// own origin. Kept for the account switcher UI.)
export function isExternalAccountActive(store: KeyValueStore, origin?: string): boolean {
  return getActiveExternal(store, origin) !== null;
}

/**
 * One-time legacy carry: the core store's migration copies the legacy
 * external sessions but cannot adapt their wire user caches (core never
 * imports an adapter). This fills `Session.user` from the legacy
 * `keystone_external_sessions` cache before `removeLegacyKeys()` deletes
 * it, so a flip-time reload keeps showing cached accounts exactly as
 * before. Idempotent; silent when there is nothing to carry.
 */
export function enrichLegacyExternalUsers(store: KeyValueStore): void {
  let legacy: unknown;
  try {
    const raw = store.getItem(SESSIONS_KEY);
    legacy = raw ? JSON.parse(raw) : null;
  } catch {
    return;
  }
  if (!Array.isArray(legacy)) return;
  const byHost = new Map<string, Account>();
  for (const item of legacy) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as { host?: unknown; user?: unknown };
    if (typeof s.host !== "string" || !s.host) continue;
    if (typeof s.user !== "object" || s.user === null) continue;
    const user = s.user as { id?: unknown };
    if (typeof user.id !== "string" || !user.id) continue;
    byHost.set(s.host, adaptMe(s.user as MeDetailed));
  }
  if (byHost.size === 0) return;
  for (const s of loadSessions(store)) {
    if (s.hosting !== "third-party" || s.user) continue;
    const carried = byHost.get(splitOrigin(s.origin).host);
    if (carried) saveSession(store, { ...s, user: carried });
  }
}
