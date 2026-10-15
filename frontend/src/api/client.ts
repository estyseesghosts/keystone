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

// (Token storage keys are per-backend; see backend.ts `tokenKeyFor`.)

interface ApiErrorBody {
  error?: { message?: string; code?: string; kind?: string };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  kind?: string;

  constructor(message: string, status: number, code?: string, kind?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
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
//      (`i` is the native user token: a temporary credential, never stored).
//   2. Keystone shows its own permission screen (the list below).
//   3. POST /api/miauth/gen-token {i: <native>, session, permission}
//      (authenticated with the temporary credential) -> {token}.
//   4. POST /api/miauth/:session/check {} -> {ok:true, token, user}.
//   5. The scoped app token becomes the Keystone session; the temporary
//      native credential is dropped from memory and never persisted.

export interface SigninFinished {
  finished: true;
  id: string;
  /** Native user token: temporary credential for step 3 only. */
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

/** Exchange a temporary native credential for a scoped Keystone app token. */
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
