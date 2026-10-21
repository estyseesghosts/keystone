// OAuth + credential exchange for BOTH Keystodon login modes
// (docs/mastoapi-contract.md §2).
//
// EXTERNAL mode (standard OAuth, both backends):
//   POST /api/v1/apps (cached per origin) → GET /oauth/authorize with
//   state + PKCE S256 (harmless where unsupported — Akkoma has NO PKCE,
//   Mastodon 4.3+ does) → callback validates state ONCE, strips the code
//   from the visible URL, exchanges the code via form-encoded
//   POST /oauth/token (+ code_verifier; ALWAYS client_secret — Mastodon
//   apps are confidential) → verify_credentials.
//
// INTERNAL mode (first-party, never bounces through /oauth/authorize):
//   Akkoma/Pleroma = password grant (ROPC) with a runtime-registered app;
//   MFA answers 403 `mfa_required` → POST /oauth/mfa/challenge → retry.
//   Vanilla Mastodon has NO password grant — internal mode there uses the
//   server-injected per-session token (mastodon-web pattern); the entry
//   point is stubbed below (handoff §4.1, open design question).
//
// Security rules: never log tokens/secrets/codes; the password is sent
// only to its own origin; client_secret here is a per-browser runtime app
// (akkoma-fe model — it identifies no trusted party, contract §2.3).

import {
  MastoHttpError,
  request,
} from "./client";
import { FediError } from "../core/errors";
import { OAUTH_APPS_KEY, type KeyValueStore } from "../core/sessions";
import type {
  CredentialAccount,
  OAuthErrorBody,
  RegisteredApp,
  TokenResponse,
} from "./wire";

/** Granular v1 scope set (contract §2.1). Both backends accept it; older
 * servers that only understand umbrella scopes get FALLBACK_SCOPES only
 * when registration fails AND no discovery doc exists. */
export const MASTO_SCOPES: string[] = [
  "read:accounts",
  "read:blocks",
  "read:bookmarks",
  "read:filters",
  "read:lists",
  "read:mutes",
  "read:statuses",
  "read:notifications",
  "read:search",
  "read:follows",
  "write:accounts",
  "write:blocks",
  "write:bookmarks",
  "write:filters",
  "write:follows",
  "write:lists",
  "write:media",
  "write:mutes",
  "write:notifications",
  "write:statuses",
  "write:favourites",
];

/** Legacy umbrella fallback: `read write follow` (contract §2.1). */
export const FALLBACK_SCOPES = "read write follow";

export const KEYSTODON_APP_NAME = "Keystone";

const OAUTH_TIMEOUT_MS = 15_000;
/** The per-origin app cache is the unified `keystone_apps` key — the same
 * one `core/sessions.revokeSessionToken` reads for RFC 7009 revocation. */
const APPS_KEY = OAUTH_APPS_KEY;
const PENDING_PREFIX = "keystodon_pending_oauth_";
/** OAuth pendings older than this are rejected (stale/abandoned tabs). */
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

/** Default OAuth callback path (the app passes its own when it differs —
 * the old web default was `/keystone/callback` at the root base,
 * `/auth/callback` under a non-root base). */
export const DEFAULT_CALLBACK_PATH = "/keystone/callback";

/** The exact callback URL registered with each instance
 * (plan §2.3 (c)): `${origin}${callbackPath}`. First- and third-party
 * flows share it; the OAuth redirect_uri must match the registered string
 * EXACTLY, and a changed URI re-registers the cached app. The path is an
 * explicit parameter (no router import — this package is UI-free). */
export function callbackUri(
  origin: string,
  callbackPath: string = DEFAULT_CALLBACK_PATH,
): string {
  return `${origin}${callbackPath}`;
}

// --- App registration (per-origin cache) ----------------------------------

/** Runtime-registered OAuth app credentials for one origin. */
export interface CachedApp {
  origin: string;
  redirect_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  createdAt: number;
}

function readApps(store: KeyValueStore): Record<string, CachedApp> {
  try {
    const raw = store.getItem(APPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as Record<string, CachedApp>;
  } catch {
    return {};
  }
}

function writeApps(store: KeyValueStore, apps: Record<string, CachedApp>): void {
  try {
    store.setItem(APPS_KEY, JSON.stringify(apps));
  } catch {
    // Storage unavailable: the app re-registers next launch.
  }
}

/** Cached app for `origin`, but ONLY when it was registered with exactly
 * this callback (a changed redirect URI means re-registration) and the
 * same scope set (scope requests differ → the credentials differ too). */
export function getCachedApp(
  store: KeyValueStore,
  origin: string,
  redirectUri: string,
  scopes: string = MASTO_SCOPES.join(" "),
): CachedApp | null {
  const app = readApps(store)[origin];
  if (!app) return null;
  if (app.redirect_uri !== redirectUri) return null;
  if (app.scopes !== scopes) return null;
  if (
    typeof app.client_id !== "string" ||
    typeof app.client_secret !== "string" ||
    !app.client_id ||
    !app.client_secret
  ) {
    return null;
  }
  return app;
}

export function cacheApp(store: KeyValueStore, app: CachedApp): void {
  const apps = readApps(store);
  apps[app.origin] = app;
  writeApps(store, apps);
}

export function clearCachedApp(store: KeyValueStore, origin: string): void {
  const apps = readApps(store);
  delete apps[origin];
  writeApps(store, apps);
}

/** `/.well-known/oauth-authorization-server` exists on Mastodon 4.3+ and
 * is absent on Akkoma (contract §2.1) — used ONLY to decide whether a
 * granular-scope registration failure may fall back to umbrella scopes. */
async function discoveryPresent(origin: string): Promise<boolean> {
  try {
    const res = await request<Record<string, unknown>>(
      origin,
      "/.well-known/oauth-authorization-server",
      { timeoutMs: 6_000 },
    );
    return res.data !== undefined && res.data !== null && typeof res.data === "object";
  } catch {
    return false;
  }
}

function isBodyError(err: unknown, status: number, codes: string[]): boolean {
  if (!(err instanceof MastoHttpError) || err.status !== status) return false;
  const body = err.body;
  if (body === null || typeof body !== "object") return false;
  const code = (body as OAuthErrorBody).error;
  return typeof code === "string" && codes.includes(code);
}

/**
 * Register (or reuse) the Keystodon OAuth app on `origin`. Unauthenticated
 * `POST /api/v1/apps` with JSON (accepted by both backends — verified in
 * `app_controller.ex` `body_params` + Mastodon Rails params).
 * `scopes` must be a space-separated string (contract §2.1).
 */
export async function registerApp(opts: {
  store: KeyValueStore;
  origin: string;
  redirectUri: string;
  scopes?: string;
  appName?: string;
  allowScopeFallback?: boolean;
  /** Public website of the app (sent as `website` on registration). */
  website?: string;
}): Promise<CachedApp> {
  const { store, origin, redirectUri } = opts;
  const scopes = opts.scopes ?? MASTO_SCOPES.join(" ");
  const cached = getCachedApp(store, origin, redirectUri, scopes);
  if (cached) return cached;

  const attempt = async (scopeValue: string): Promise<RegisteredApp> => {
    const res = await request<RegisteredApp>(origin, "/api/v1/apps", {
      method: "POST",
      json: {
        client_name: opts.appName ?? KEYSTODON_APP_NAME,
        redirect_uris: redirectUri,
        scopes: scopeValue,
        ...(opts.website ? { website: opts.website } : {}),
      },
      timeoutMs: OAUTH_TIMEOUT_MS,
    });
    const app = res.data;
    if (!app || typeof app.client_id !== "string" || typeof app.client_secret !== "string") {
      throw new FediError(
        "The server registered an app but did not return usable credentials.",
        "errors.auth.noCredentials",
      );
    }
    return app;
  };

  let registered: RegisteredApp;
  let grantedScopes = scopes;
  try {
    registered = await attempt(scopes);
  } catch (err) {
    // Umbrella fallback only when granular registration itself failed AND
    // the server advertises no OAuth discovery doc (contract §2.1).
    const canFallback =
      opts.allowScopeFallback !== false &&
      err instanceof MastoHttpError &&
      err.status >= 400 &&
      err.status < 500 &&
      !(await discoveryPresent(origin));
    if (!canFallback) throw err;
    grantedScopes = FALLBACK_SCOPES;
    registered = await attempt(FALLBACK_SCOPES);
  }

  const app: CachedApp = {
    origin,
    redirect_uri: redirectUri,
    client_id: registered.client_id,
    client_secret: registered.client_secret,
    scopes: grantedScopes,
    createdAt: Date.now(),
  };
  cacheApp(store, app);
  return app;
}

// --- PKCE + state ---------------------------------------------------------

/** Cryptographically random URL-safe string (state, code_verifier). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  let binary = "";
  for (const b of buf) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Pure-TS SHA-256 (FIPS 180-4), synchronous.
 *
 * Fallback for `crypto.subtle`, which BROWSERS EXPOSE ONLY IN SECURE
 * CONTEXTS (https, localhost, 127.0.0.1). Opening Keystodon over plain
 * http via a LAN IP/hostname leaves `crypto.subtle` undefined — PKCE
 * must keep working there with a REAL S256 challenge instead of crashing
 * ("Cannot read properties of undefined (reading 'digest')", observed
 * live against mstdn.ca 2026-10-17) or silently downgrading the
 * `code_challenge_method`. Exported for the smoke vectors.
 */
export function pureSha256(input: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

  const len = input.length;
  // Padding: 0x80, zeros, then the 64-bit big-endian bit length.
  const withOne = len + 1;
  const paddedLen = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
  const msg = new Uint8Array(paddedLen);
  msg.set(input);
  msg[len] = 0x80;
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  dv.setUint32(paddedLen - 8, Math.floor(len / 0x20000000)); // len*8 >> 32
  dv.setUint32(paddedLen - 4, (len * 8) >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) odv.setUint32(i * 4, H[i]);
  return out;
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)).
 * Uses WebCrypto when the context has it (secure contexts), otherwise
 * the pure-TS fallback above — the challenge is real S256 either way. */
export async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const subtle =
    typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function"
      ? crypto.subtle
      : null;
  const bytes = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", data))
    : pureSha256(data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build the remote instance's authorize URL (external mode step 3). */
export function buildAuthorizeUrl(opts: {
  origin: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${opts.origin}/oauth/authorize?${params.toString()}`;
}

// --- Pending external authorization (survives the redirect) ----------------

export interface PendingExternalAuth {
  /** Whose server: "first-party" = the home server behind this origin
   * (same-origin PKCE), "third-party" = a remote instance. */
  hosting?: "first-party" | "third-party";
  origin: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  scopes: string;
  createdAt: number;
}

export function savePendingAuth(store: KeyValueStore, pending: PendingExternalAuth): void {
  try {
    store.setItem(PENDING_PREFIX + pending.state, JSON.stringify(pending));
  } catch {
    throw new FediError(
      "Could not save the sign-in state (storage blocked) — the redirect flow cannot continue safely.",
      "errors.auth.savePending",
    );
  }
}

/**
 * Read AND delete the pending flow for `state` — validation happens once:
 * a second callback with the same state finds nothing (replay guard).
 * Returns null on mismatch, malformed data, or an expired pending.
 */
export function takePendingAuth(store: KeyValueStore, state: string): PendingExternalAuth | null {
  const key = PENDING_PREFIX + state;
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
    store.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingExternalAuth;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.state !== state ||
      typeof parsed.origin !== "string" ||
      typeof parsed.codeVerifier !== "string"
    ) {
      return null;
    }
    if (Date.now() - parsed.createdAt > PENDING_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Discard a pending flow without using it (OAuth error / cancel). */
export function clearPendingAuth(store: KeyValueStore, state: string): void {
  try {
    store.removeItem(PENDING_PREFIX + state);
  } catch {
    // Ignore.
  }
}

// --- Token endpoint calls -------------------------------------------------

const TOKEN_ERROR_MESSAGE: Record<string, string> = {
  "errors.auth.signinFailed": "Sign-in failed.",
  "errors.auth.mfaFailed": "Two-factor sign-in failed.",
};

function requireToken(
  res: { data: TokenResponse | undefined },
  code: "errors.auth.signinFailed" | "errors.auth.mfaFailed",
): TokenResponse {
  const token = res.data;
  if (!token || typeof token.access_token !== "string" || !token.access_token) {
    throw new FediError(
      `${TOKEN_ERROR_MESSAGE[code]}: the server did not return an access token.`,
      code,
    );
  }
  return token;
}

/** Form-encoded `POST /oauth/token` (authorization_code grant). */
export async function exchangeCode(opts: {
  origin: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
}): Promise<TokenResponse> {
  const res = await request<TokenResponse>(opts.origin, "/oauth/token", {
    method: "POST",
    form: {
      grant_type: "authorization_code",
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret, // Mastodon apps are confidential — always sent
      redirect_uri: opts.redirectUri,
      ...(opts.codeVerifier ? { code_verifier: opts.codeVerifier } : {}),
    },
    timeoutMs: OAUTH_TIMEOUT_MS,
  });
  return requireToken(res, "errors.auth.signinFailed");
}

/** The server rejected `grant_type=password`: vanilla Mastodon has no
 * password grant (contract §2.2) — internal mode there needs the
 * server-injected token (see getInjectedSessionToken). */
export function isUnsupportedGrantType(err: unknown): boolean {
  return (
    isBodyError(err, 400, ["unsupported_grant_type"]) ||
    isBodyError(err, 405, ["unsupported_grant_type"])
  );
}

/** HTTP 403 `{error: "mfa_required", mfa_token, supported_challenge_types}`
 * from a password grant (Akkoma `MFAView.render("mfa_response.json")`). */
export class MfaRequiredError extends FediError {
  readonly mfaToken: string;
  readonly challengeTypes: string[];

  constructor(mfaToken: string, challengeTypes: string[]) {
    super(
      "This account requires two-factor authentication. Enter your code to finish signing in.",
      "errors.auth.mfaRequired",
    );
    this.name = "MfaRequiredError";
    this.mfaToken = mfaToken;
    this.challengeTypes = challengeTypes.length > 0 ? challengeTypes : ["totp"];
  }
}

function mfaFromError(err: unknown): MfaRequiredError | null {
  if (!(err instanceof MastoHttpError) || err.status !== 403) return null;
  const body = err.body;
  if (body === null || typeof body !== "object") return null;
  const record = body as Partial<{ error: string; mfa_token: string; supported_challenge_types: string[] }>;
  if (record.error !== "mfa_required" || typeof record.mfa_token !== "string") return null;
  const types = Array.isArray(record.supported_challenge_types)
    ? record.supported_challenge_types.filter((t): t is string => typeof t === "string")
    : [];
  return new MfaRequiredError(record.mfa_token, types);
}

/** INTERNAL mode step 1 (Akkoma/Pleroma): ROPC password grant. Throws
 * MfaRequiredError on 403 mfa_required; passes other typed errors through. */
export async function passwordGrant(opts: {
  origin: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  scopes?: string;
}): Promise<TokenResponse> {
  try {
    const res = await request<TokenResponse>(opts.origin, "/oauth/token", {
      method: "POST",
      form: {
        grant_type: "password",
        username: opts.username,
        password: opts.password,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        ...(opts.scopes ? { scope: opts.scopes } : {}),
      },
      timeoutMs: OAUTH_TIMEOUT_MS,
    });
    return requireToken(res, "errors.auth.signinFailed");
  } catch (err) {
    const mfa = mfaFromError(err);
    if (mfa) throw mfa;
    throw err;
  }
}

/** MFA second step: `POST /oauth/mfa/challenge`
 * (client_id, client_secret, mfa_token, challenge_type totp|recovery,
 * code → token; 400 `{error: "Invalid code"}` on failure). */
export async function mfaChallenge(opts: {
  origin: string;
  clientId: string;
  clientSecret: string;
  mfaToken: string;
  challengeType: string;
  code: string;
}): Promise<TokenResponse> {
  const res = await request<TokenResponse>(opts.origin, "/oauth/mfa/challenge", {
    method: "POST",
    form: {
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      mfa_token: opts.mfaToken,
      challenge_type: opts.challengeType,
      code: opts.code,
    },
    timeoutMs: OAUTH_TIMEOUT_MS,
  });
  return requireToken(res, "errors.auth.mfaFailed");
}

/**
 * INTERNAL-mode entry point for vanilla Mastodon (handoff §4.1 — open
 * design question: server-injected per-session token vs deploy-time seed;
 * precedent: Keystone's KEYSTONE_BACKEND_ONLY patch). Mastodon's own web UI
 * does exactly this (superapp token minted by Rails and injected into the
 * served page).
 *
 * The token arrives as a PARAMETER (the app layer reads its own channel —
 * e.g. a `<meta name="keystone-access-token">` element on web, the secure
 * store on native — and passes the value here). This package never touches
 * the DOM: without a token the flow answers null (→ honest "not available"
 * message). The channel decision (meta tag `keystone-access-token`,
 * legacy `keystodon-access-token` still read) belongs to the app layer.
 */
export function normalizeInjectedToken(raw: string | null | undefined): string | null {
  const token = raw?.trim();
  return token ? token : null;
}

// --- Session verification / revocation ------------------------------------

/**
 * `GET /api/v1/accounts/verify_credentials` with a Bearer token — the
 * single source of truth for session restore on both backends (contract
 * §2.1 step 4 / §2.2).
 */
export async function verifyCredentials(
  origin: string,
  token: string,
  timeoutMs = 10_000,
): Promise<CredentialAccount> {
  const res = await request<CredentialAccount>(
    origin,
    "/api/v1/accounts/verify_credentials",
    { token, timeoutMs },
  );
  const account = res.data;
  if (!account || typeof account !== "object" || typeof account.id !== "string") {
    throw new FediError(
      "verify_credentials did not return an account.",
      "errors.auth.noVerifyAccount",
    );
  }
  return account;
}

/**
 * `POST /oauth/revoke` (contract §2.1 step 5). Best-effort: local session
 * state always clears regardless of the outcome. Requires the same app
 * credentials the token was issued under — skipped when none are cached.
 */
export async function revokeToken(
  origin: string,
  app: CachedApp | null,
  token: string,
): Promise<void> {
  if (!app || !token) return;
  try {
    await request(origin, "/oauth/revoke", {
      method: "POST",
      form: {
        token,
        client_id: app.client_id,
        client_secret: app.client_secret,
      },
      timeoutMs: 8_000,
    });
  } catch {
    // RFC 7009: Akkoma always answers {}; failures are non-fatal.
  }
}
