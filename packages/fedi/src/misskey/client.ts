// Misskey-family REST transport, bound to one Session (Phase 1 item D).
//
// `api/client.ts` becomes this module: a transport that is only ever built
// FROM a `Session` (core/sessions.ts), so a token can only reach its own
// origin — the fix for the auth-survey finding that the old free
// `opts.token` parameter let a caller send any token to any origin. There
// is no token parameter anywhere in this file's request path: credentials
// come from the session the client was built with.
//
// Reused from the Mastodon client's transport (core/http.ts): the origin
// guard (`resolveSameOriginUrl`, cross-origin refusal before any I/O) and
// the error kinds (`MastoHttpError` → `HttpError`).
//
// Auth (plan §2.1 / Phase 1 item D): `Authorization: Bearer` where the
// flavor supports it (the Mastodon family, which has no `i` field), the
// `i` body field otherwise. The Misskey family also accepts Bearer, but
// `i` is the on-the-wire behaviour Keystone has today — switching families
// mid-phase would change observable traffic, so `i` stays the Misskey-
// family style until a later phase says otherwise.
//
// Behaviour preserved bit-for-bit from api/client.ts + api/external.ts:
// - a caller-supplied `i` (the `miauth/gen-token` native credential) wins
//   over the session token;
// - 204 / empty bodies resolve as `undefined`, never `response.json()`;
// - unknown POST paths answering 404 non-JSON still throw an `ApiError`
//   carrying the HTTP status (callers probe support via `isUnsupportedError`);
// - the exact error message strings for timeout/network, in both the
//   internal (first-party) and external (third-party) wording.

import { HttpError, requestJson, resolveSameOriginUrl } from "../core/http";
import type { ServerFlavor } from "../core/detect";
import type { Session } from "../core/sessions";
import { ApiError, FediError } from "../core/errors";

interface ApiErrorBody {
  error?: { message?: string; code?: string; kind?: string };
}

export type AuthStyle = "bearer" | "body-i";

/** Bearer on the Mastodon-family flavors; the `i` body field otherwise. */
export function authStyleFor(flavor: ServerFlavor): AuthStyle {
  return flavor === "mastodon" || flavor === "akkoma" || flavor === "pleroma"
    ? "bearer"
    : "body-i";
}

export interface MisskeyClientOptions {
  /** Request deadline. Defaults to 30s, as before. */
  timeoutMs?: number;
}

export interface UploadOptions {
  isSensitive?: boolean;
  comment?: string;
}

export interface MisskeyClient {
  readonly session: Session;
  /** Authenticated call (session credential injected per auth style). */
  call<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
  /** Unauthenticated call (login, token checks): no credential at all. */
  callPublic<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
  /** Multipart Drive upload (`drive/files/create` is FormData, never JSON). */
  upload<T>(file: File, opts?: UploadOptions): Promise<T>;
}

/** A wire-call function (the routing facade's `apiCall`, or the Backend's
 * injected transport in tests). Wire modules take one as an optional
 * parameter so their endpoint calls stay in ONE place and stay testable. */
export type WireCall = <T>(endpoint: string, params?: Record<string, unknown>) => Promise<T>;

const DEFAULT_TIMEOUT_MS = 30_000;

/** Build the request path for an endpoint, refusing anything that would
 * escape the session's origin (defence in depth — `apiCall` endpoints are
 * plain strings, but the guard makes the binding absolute). */
function endpointPath(origin: string, endpoint: string): string {
  const path = `/api/${endpoint}`;
  const resolved = resolveSameOriginUrl(origin, path);
  if (!resolved) {
    throw new HttpError({
      kind: "cross-origin",
      code: "errors.network.crossOrigin",
      origin,
      method: "POST",
      path,
      message:
        "Refusing to send this request: the URL points at a different origin than the session's.",
    });
  }
  return path;
}

/** The exact error shapes api/client.ts produced, translated from the
 * shared HttpError kinds. `message` keeps the historical English wording
 * (tests pin it); every throw also carries a stable `code` (+ `params`)
 * the UI localizes (pure-TS rule: no locale framework in this package). */
function translateError(
  err: unknown,
  ctx: { session: Session; endpoint: string; url: string; timeoutMs: number },
): never {
  if (err instanceof HttpError) {
    if (err.kind === "cross-origin") throw err; // typed refusal — keep it
    if (err.kind === "timeout") {
      const seconds = Math.round(ctx.timeoutMs / 1000);
      if (ctx.session.hosting === "third-party") {
        throw new FediError(
          `Request timed out (${ctx.url}): the instance did not answer within ${seconds}s. Retry.`,
          "errors.network.timeoutInstance",
          { target: ctx.url, n: seconds },
        );
      }
      throw new FediError(
        `Request timed out (${ctx.endpoint}): the server did not answer within ${seconds}s. Retry, or check the dev-server terminal.`,
        "errors.network.timeoutServer",
        { target: ctx.endpoint, n: seconds },
      );
    }
    if (err.kind === "network") {
      const reason = err.message.replace(/^Could not reach [^(]*\(/, "").replace(/\)\.?$/, "");
      if (ctx.session.hosting === "third-party") {
        throw new FediError(
          `Could not reach the instance (${reason}). Is the host correct?`,
          "errors.network.unreachableInstance",
          { reason },
        );
      }
      throw new FediError(
        `Could not reach the server (${reason}). Is it running?`,
        "errors.network.unreachableServer",
        { reason },
      );
    }
    if (err.kind === "invalid-json" || typeof err.body === "string") {
      // Non-JSON body (2xx or error) — same message as before for both.
      throw new ApiError(
        `API returned invalid JSON (HTTP ${err.status})`,
        err.status,
        "errors.network.badJson",
        undefined,
        { status: err.status },
      );
    }
    const envelope = (err.body ?? undefined) as ApiErrorBody | undefined;
    throw new ApiError(
      typeof envelope?.error?.message === "string"
        ? envelope.error.message
        : `API error: HTTP ${err.status}`,
      err.status,
      envelope?.error?.code,
      envelope?.error?.kind,
      { status: err.status },
    );
  }
  throw err;
}

function authHeaders(session: Session): Record<string, string> {
  return authStyleFor(session.flavor) === "bearer" && session.token
    ? { Authorization: `Bearer ${session.token}` }
    : {};
}

function authedParams(session: Session, params: Record<string, unknown>): Record<string, unknown> {
  if (authStyleFor(session.flavor) !== "body-i") return params;
  if (!session.token) return params;
  // A caller-supplied `i` (gen-token's native credential) wins.
  return { ...params, i: params.i ?? session.token };
}

/**
 * Build a transport for exactly one session. Every request this client
 * makes goes to `session.origin` carrying only `session.token`.
 */
export function createMisskeyClient(
  session: Session,
  opts: MisskeyClientOptions = {},
): MisskeyClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    authenticated: boolean,
  ): Promise<T> {
    const path = endpointPath(session.origin, endpoint);
    const body = authenticated ? authedParams(session, params) : params;
    try {
      const res = await requestJson<T>(session.origin, path, {
        method: "POST",
        json: body,
        headers: authenticated ? authHeaders(session) : {},
        timeoutMs,
      });
      return res.data as T; // T = undefined for successful 204 endpoints
    } catch (err) {
      return translateError(err, {
        session,
        endpoint,
        url: `${session.origin}${path}`,
        timeoutMs,
      });
    }
  }

  return {
    session,
    call: (endpoint, params) => call(endpoint, params ?? {}, true),
    callPublic: (endpoint, params) => call(endpoint, params ?? {}, false),
    async upload<T>(file: File, uploadOpts: UploadOptions = {}): Promise<T> {
      // `drive/files/create` is multipart FormData (file + credential as
      // fields) — the fetch implementation sets the multipart boundary,
      // never by hand. No deadline here, matching the pre-Phase-1 upload
      // path exactly.
      const path = endpointPath(session.origin, "drive/files/create");
      const form = new FormData();
      if (authStyleFor(session.flavor) === "body-i" && session.token) {
        form.append("i", session.token);
      }
      form.append("file", file, file.name);
      if (uploadOpts.isSensitive !== undefined) {
        form.append("isSensitive", String(uploadOpts.isSensitive));
      }
      if (uploadOpts.comment !== undefined) form.append("comment", uploadOpts.comment);

      let response: Response;
      try {
        response = await fetch(`${session.origin}${path}`, {
          method: "POST",
          credentials: "omit",
          body: form,
          headers: authHeaders(session),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        if (session.hosting === "third-party") {
          throw new FediError(
            `Could not reach the instance (${reason}). Is the host correct?`,
            "errors.network.unreachableInstance",
            { reason },
          );
        }
        throw new FediError(
          `Could not reach the server (${reason}). Is it running?`,
          "errors.network.unreachableServer",
          { reason },
        );
      }
      // 204 / empty-body tolerance + envelope errors, exactly as before.
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
    },
  };
}

/** True when the server says the endpoint does not exist here (HTTP
 * 404/405 — contract §3 feature probing: 404/405 ≈ absent on the
 * Mastodon family too). Callers use this to render an honest "not
 * available on this server" state instead of an error. */
export function isUnsupportedError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
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
