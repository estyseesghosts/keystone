// Typed request helper for the Keystone API targets (Pinetree + Misskey-family).
// Transport for all three: JSON POST to /api/${endpoint}; auth via the `i`
// body field (all backends also accept `Authorization: Bearer`, but the `i`
// field is used consistently). API errors use an envelope shaped like
// `{ error: { message, code, ... } }`.

import {
  BACKEND_ID,
  KEYSTONE_APP_NAME,
  KEYSTONE_PERMISSIONS,
  tokenKeyFor,
} from "./backend";
import { ApiError } from "./error";
import {
  externalApiCall,
  externalUploadFile,
  getActiveExternal,
} from "./external";

// (Token storage keys are per-backend; see backend.ts `tokenKeyFor`.)

/** Re-exported so existing `import { ApiError } from "./client"` sites keep
 * working; the class itself lives in `./error` (shared with `./external`). */
export { ApiError } from "./error";

interface ApiErrorBody {
  error?: { message?: string; code?: string; kind?: string };
}

export function getToken(): string | null {
  // Per-backend session isolation: a token stored for one backend is never
  // returned (and therefore never sent) when another backend is selected.
  try {
    return (
      localStorage.getItem(tokenKeyFor()) ??
      // One-time migration from the pre-multibackend Pinetree key.
      (BACKEND_ID === "pinetree" ? localStorage.getItem("pinetree_token") : null)
    );
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(tokenKeyFor(), token);
    if (BACKEND_ID === "pinetree") localStorage.removeItem("pinetree_token");
  } catch {
    // Storage unavailable (private mode, etc.): session simply won't persist.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(tokenKeyFor());
    if (BACKEND_ID === "pinetree") localStorage.removeItem("pinetree_token");
  } catch {
    // Ignore.
  }
}

async function postJson<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the server (${err instanceof Error ? err.message : "network error"}). Is it running?`,
    );
  }

  // Successful writes may return 204 No Content: read text first, never
  // blind response.json(). Unknown POST paths on Misskey-family backends
  // answer 404 with a non-JSON body; that still surfaces as an ApiError
  // carrying the HTTP status so callers can probe for support (404).
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

  return payload as T; // Use T = undefined for successful 204 endpoints.
}

/** POST without injecting the stored token (login, token checks). */
export function apiCallPublic<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return postJson<T>(endpoint, params);
}

export async function apiCall<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  // External account active: route direct to its instance. The internal
  // proxy path below is untouched and runs exactly as before otherwise —
  // an external token never reaches the internal backend and vice versa.
  const ext = getActiveExternal();
  if (ext) {
    return externalApiCall<T>(ext.scheme, ext.host, ext.token, endpoint, params);
  }
  return apiCallInternal<T>(endpoint, params);
}

/** The internal (proxy-backend) path with no external routing. Used by the
 * auth store for session operations that must always target the configured
 * backend (restore, internal sign-in/out, internal refresh) even while an
 * external account is active. */
export async function apiCallInternal<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const body = token ? { ...params, i: params.i ?? token } : params;
  return postJson<T>(endpoint, body);
}

// --- Misskey-family native authentication (Keystone-owned, no redirects) ---
//
// The whole exchange stays inside Keystone via API calls; Keystone never
// navigates to the instance-hosted MiAuth (/miauth/:session) or authorize
// pages:
//   1. POST /api/signin-flow {username, password} -> {finished:true,id,i}
//      (`i` is the user's full-authority native token — the permanent
//      account credential from SigninService, NOT a short-lived token.
//      Keystone holds it in module memory only for step 3 and never
//      persists it: not in localStorage, not in a signal.)
//   2. POST /api/miauth/gen-token {i: <native>, session, permission}
//      (authenticated with the native credential) -> {token}.
//   3. POST /api/miauth/:session/check {} -> {ok:true, token, user}.
//   4. The scoped app token becomes the Keystone session; the native
//      credential is dropped from memory and never persisted.
//
// There is no separate "grant Keystone access" screen: Keystone is the
// first-party client, the permission set is fixed and least-privilege, and
// typing the password is the consent. The login form lists the requested
// permissions as information, not as a second approval step.

export interface SigninFinished {
  finished: true;
  id: string;
  /** Full-authority native user token: used only for the gen-token
   * exchange below, held in memory, never persisted. */
  i: string;
}

export interface SigninPending {
  finished: false;
  next: string;
}

export type SigninFlowResponse = SigninFinished | SigninPending;

export function signinFlow(
  username: string,
  password: string,
): Promise<SigninFlowResponse> {
  return apiCallPublic<SigninFlowResponse>("signin-flow", { username, password });
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export interface MiauthCheckResponse {
  ok: boolean;
  token?: string;
  user?: unknown;
}

/** Exchange a native credential for a scoped Keystone app token. */
export async function mintAppToken(nativeToken: string): Promise<string> {
  const session = newSessionId();
  await postJson<{ token: string }>("miauth/gen-token", {
    i: nativeToken,
    session,
    name: KEYSTONE_APP_NAME,
    permission: KEYSTONE_PERMISSIONS,
  });
  const check = await apiCallPublic<MiauthCheckResponse>(
    `miauth/${session}/check`,
    {},
  );
  if (!check.ok || !check.token) {
    throw new Error("The server did not issue a Keystone token for this session.");
  }
  return check.token;
}

/** True when the server says the endpoint does not exist here (HTTP 404).
 * Callers use this to render an honest "not available on this server"
 * state instead of an error. */
export function isUnsupportedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** True when the scoped token lacks the permission for this endpoint
 * (HTTP 403 PERMISSION_DENIED). This happens to sessions minted before a
 * scope was added — the fix is signing in again, not retrying. */
export function isPermissionError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 403 ||
      (err.status === 401 && err.code === "PERMISSION_DENIED"))
  );
}

/** Multipart Drive upload. `drive/files/create` is NOT JSON: the file and
 * the credential ride as FormData fields (`file`, `i`). The browser sets
 * the multipart boundary — never set Content-Type by hand here. */
export async function uploadDriveFile<T>(
  file: File,
  opts: { isSensitive?: boolean; comment?: string } = {},
): Promise<T> {
  // External account active: upload direct to its instance (multipart
  // FormData, same contract as below).
  const ext = getActiveExternal();
  if (ext) {
    return externalUploadFile<T>(ext.scheme, ext.host, ext.token, file, opts);
  }
  const token = getToken();
  const form = new FormData();
  if (token) form.append("i", token);
  form.append("file", file, file.name);
  if (opts.isSensitive !== undefined)
    form.append("isSensitive", String(opts.isSensitive));
  if (opts.comment !== undefined) form.append("comment", opts.comment);

  let response: Response;
  try {
    response = await fetch("/api/drive/files/create", {
      method: "POST",
      body: form,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the server (${err instanceof Error ? err.message : "network error"}). Is it running?`,
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
