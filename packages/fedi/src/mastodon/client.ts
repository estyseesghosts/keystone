// Mastodon-family REST transport (docs/mastoapi-contract.md §1).
//
// One choke point for every MastoAPI call in Keystodon:
// - GET/POST/PUT/PATCH/DELETE; query arrays as repeated `key[]`; JSON
//   bodies where the server accepts them; `application/x-www-form-urlencoded`
//   for OAuth (URLSearchParams); `FormData` for media (browser sets the
//   multipart boundary — Content-Type is NEVER set by hand there).
// - `Authorization: Bearer` on authenticated calls.
// - Per-request timeout + caller cancellation. A timeout is a TIMEOUT
//   (`kind: "timeout"`), never "endpoint unsupported".
// - Tolerant response parsing: 200 JSON, `{}`/empty 204-ish, **202**
//   (async media), **206** (home-timeline regenerating / media processing)
//   all resolve with `data: undefined` when the body is empty.
// - Typed errors carrying HTTP status + body + request context; 429 keeps
//   `Retry-After` and the X-RateLimit-* values.
// - `Idempotency-Key` for status create (contract §1).
// - Origin safety: a Bearer token is NEVER attached to a different origin
//   than the session's. Absolute URLs (e.g. from Link headers) are
//   resolved and REJECTED cross-origin before any request is sent.

import type { OAuthErrorBody } from "./wire";
import { ApiError } from "../core/errors";
import { HttpError, type HttpErrorKind } from "../core/http";
import type { HttpMethod } from "../core/http";
import { defaultFetchImpl, isRedirectStatus, resolveSameOriginUrl, type FetchImpl } from "../core/http";

/** Deadline for a single call (headers AND the body read — the timer is
 * cleared only after `response.text()` settles, repair X2.2 step 3). Hung
 * requests surface as retryable `kind: "timeout"` errors naming the
 * endpoint — never eternal skeletons. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Injected dev logger (repair X8.1): the app passes its redacting
 * logger (`src/lib/logger.ts`); absent it is a no-op, so tests and
 * production stay silent. Never carries bodies or tokens — method + path
 * only. Pure-TS: a bare function type, no imports. */
export type FediLogFn = (level: "debug" | "info" | "warn" | "error", message: string) => void;

export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryValue = QueryPrimitive | QueryValue[] | { [key: string]: QueryValue };

export type MastoErrorKind = HttpErrorKind;

export interface RateLimitInfo {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  /** Raw `Retry-After` header (seconds or HTTP-date), when present. */
  retryAfter: string | null;
}

/** Typed transport/API error. `status` is 0 for transport-level failures
 * (timeout/network) — callers must not treat 0 as an HTTP answer.
 * Extends the shared `HttpError` so `err.code` works uniformly across
 * families; `rateLimit` is the Mastodon-family addition (429 headers). */
export class MastoHttpError extends HttpError {
  readonly rateLimit: RateLimitInfo | null;

  constructor(opts: {
    message: string;
    code?: string;
    params?: Record<string, unknown>;
    status?: number;
    kind: MastoErrorKind;
    body?: unknown;
    origin: string;
    method?: HttpMethod | "GET";
    path?: string;
    rateLimit?: RateLimitInfo | null;
  }) {
    super({
      message: opts.message,
      code: opts.code ?? "errors.network.apiError",
      params: opts.params ?? { status: opts.status ?? 0 },
      status: opts.status,
      kind: opts.kind,
      body: opts.body,
      origin: opts.origin,
      method: opts.method,
      path: opts.path,
    });
    this.name = "MastoHttpError";
    this.rateLimit = opts.rateLimit ?? null;
  }
}

/** Server says the endpoint does not exist here (404/405). A timeout or
 * network failure is NEVER this (contract §1, keystodon.md §5). */
export function isUnsupportedError(err: unknown): boolean {
  return err instanceof MastoHttpError && (err.status === 404 || err.status === 405);
}

/** Auth/scope problem — NOT proof that the feature is absent
 * (keystodon.md §5: 401/403 mean authentication/scope). */
export function isAuthError(err: unknown): boolean {
  return err instanceof MastoHttpError && (err.status === 401 || err.status === 403);
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof MastoHttpError && err.status === 429;
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof MastoHttpError && err.kind === "timeout";
}

/** Parse a raw `Retry-After` value (delta-seconds or HTTP-date) to a
 * millisecond delay, else null. Pure. */
export function retryAfterMs(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return null;
}

/**
 * Transport errors become the UI's shared `ApiError` AT the boundary, so
 * every honest-state rule the Misskey family relies on (`isUnsupportedError`
 * = 404/405, `isPermissionError` = 401/403) reads the same here. A
 * timeout keeps `kind: "timeout"` — it is never "endpoint unsupported".
 * The transport error's own `code`/`kind`/`params` are mapped through
 * (repair X2.2 step 4): the server's free-form `error` text is NEVER the
 * stable code — it survives only as `detail` in params. The 429 headers
 * survive in `params` (`retryAfter` raw + `retryAfterMs` parsed) so
 * callers can back off intelligently instead of hammering.
 * Non-transport values pass through untouched. Direct
 * endpoint / oauth / instance callers (which bypass the backend's
 * guarded client) should run failures through this before probing
 * support — MD12.
 */
export function toApiError(err: unknown): unknown {
  if (err instanceof MastoHttpError) {
    let detail: string | undefined;
    const body = err.body;
    if (body !== null && typeof body === "object") {
      const rec = body as { error?: unknown; error_description?: unknown };
      if (typeof rec.error === "string" && rec.error.trim()) detail = rec.error;
      else if (typeof rec.error_description === "string" && rec.error_description.trim()) {
        detail = rec.error_description;
      }
    } else if (typeof body === "string" && body.trim() && body.length < 300) {
      detail = body.trim();
    }
    const rateLimit = err.rateLimit;
    return new ApiError(err.message, err.status, err.code, err.kind, {
      ...err.params,
      ...(detail !== undefined ? { detail } : {}),
      ...(rateLimit
        ? {
            retryAfter: rateLimit.retryAfter,
            retryAfterMs: retryAfterMs(rateLimit.retryAfter),
            rateLimitRemaining: rateLimit.remaining,
            rateLimitReset: rateLimit.reset,
          }
        : {}),
    });
  }
  return err;
}

// --- Query strings --------------------------------------------------------

function appendQuery(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    // Both backends document `[]`-suffixed array params (contract §1).
    for (const item of value) appendQuery(params, `${key}[]`, item);
    return;
  }
  if (typeof value === "object") {
    for (const [inner, v] of Object.entries(value)) {
      appendQuery(params, `${key}[${inner}]`, v as QueryValue);
    }
    return;
  }
  params.append(key, value === true ? "true" : value === false ? "false" : String(value));
}

/** Build a query string: arrays as repeated `key[]=`, nested objects as
 * `key[sub]=`, undefined/null skipped. Exported for unit checks. */
export function buildQueryString(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) appendQuery(params, key, value);
  return params.toString();
}

/** Record → URLSearchParams for form-encoded (OAuth) bodies. */
export function toFormParams(
  form: Record<string, QueryValue> | URLSearchParams,
): URLSearchParams {
  if (form instanceof URLSearchParams) return form;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) appendQuery(params, key, value);
  return params;
}

// --- Core request ---------------------------------------------------------

export interface RequestResult<T> {
  status: number;
  /** Parsed JSON, or undefined for empty bodies (204 / `{}`-less 2xx). */
  data: T | undefined;
  headers: Headers;
}

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  /** Bearer token. NEVER sent to another origin (see resolveSameOriginUrl). */
  token?: string | null;
  /** JSON body (Content-Type: application/json). */
  json?: unknown;
  /** URL-encoded body for OAuth endpoints (fetch sets the content type). */
  form?: Record<string, QueryValue> | URLSearchParams;
  /** Multipart body for media upload — Content-Type never set by hand. */
  formData?: FormData;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Status-create idempotency (one key per logical post attempt). */
  idempotencyKey?: string;
  /** Injectable fetch — defaults to the core/http seam edge. */
  fetchImpl?: FetchImpl;
  /** Injected dev logger (method + path only; default no-op). */
  log?: FediLogFn;
}

/** Parse rate-limit response headers into a structured form. Returns null
 * when the server sent none (Akkoma's 429 observed without them — Mastodon
 * sends Retry-After/X-RateLimit-*; surfaced whenever present, contract §1). */
export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  const retryAfter = headers.get("Retry-After");
  if (limit === null && remaining === null && reset === null && retryAfter === null) {
    return null;
  }
  return { limit, remaining, reset, retryAfter };
}

/** Best human-readable message from an error body. OAuth errors use
 * `error_description`, API errors `{error: "…"}` (contract §1). */
function messageFromBody(data: unknown, status: number, statusText: string): string {
  if (data !== null && typeof data === "object") {
    const body = data as OAuthErrorBody;
    if (typeof body.error_description === "string" && body.error_description.trim()) {
      return body.error_description;
    }
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  }
  if (typeof data === "string" && data.trim() && data.length < 300) return data.trim();
  return `API error: HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
}

/**
 * Perform one request against `origin`. `path` may be an absolute URL only
 * when it stays on `origin` (Link-header next URLs) — anything else throws
 * `kind: "cross-origin"` BEFORE any token leaves the browser.
 */
export async function request<T = unknown>(
  origin: string,
  path: string,
  opts: RequestOptions = {},
): Promise<RequestResult<T>> {
  const method: HttpMethod = opts.method ?? "GET";

  let url: URL;
  if (/^https?:\/\//i.test(path)) {
    const same = resolveSameOriginUrl(origin, path);
    if (!same) {
      throw new MastoHttpError({
        kind: "cross-origin",
        code: "errors.network.crossOrigin",
        origin,
        method,
        path,
        message:
          "Refusing to send this request: the URL points at a different origin than the session's.",
      });
    }
    url = new URL(same);
  } else {
    if (!path.startsWith("/")) {
      throw new MastoHttpError({
        kind: "cross-origin",
        code: "errors.network.badPath",
        params: { path },
        origin,
        method,
        path,
        message: `Request path must start with "/": got "${path}".`,
      });
    }
    url = new URL(`${origin}${path}`);
  }
  if (opts.query) {
    const qs = buildQueryString(opts.query);
    if (qs) url.search = url.search ? `${url.search}&${qs}` : `?${qs}`;
  }

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets multipart boundary — never by hand
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form !== undefined) {
    // fetch sets `application/x-www-form-urlencoded` for URLSearchParams.
    body = toFormParams(opts.form);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  let raw: string;
  try {
    opts.log?.("debug", `[fedi-api] → ${method} ${url.pathname + url.search}`);
    response = await (opts.fetchImpl ?? defaultFetchImpl)(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      // Never follow a redirect with the Bearer token (repair X2.2 step 1):
      // a 3xx is refused below before any second request. `manual` keeps
      // the token on this origin (fetch strips cross-origin Authorization
      // headers, but same-origin redirects would still re-send it — and a
      // compromised origin must not bounce the token elsewhere).
      redirect: "manual",
      // Never carry cookies cross-origin: auth is the Bearer token.
      credentials: "omit",
    });
    if (isRedirectStatus(response.status)) {
      throw new MastoHttpError({
        kind: "redirect",
        code: "errors.network.redirect",
        params: { status: response.status },
        status: response.status,
        origin,
        method,
        path: url.pathname + url.search,
        message: `Server redirected the request (HTTP ${response.status}); refusing to follow with credentials.`,
      });
    }
    // The body read stays INSIDE the deadline (repair X2.2 step 3): the
    // timer and the caller-abort listener are cleared in the `finally`
    // below, after `text()` settles. Tolerant parsing: read text first,
    // never blind response.json(). Empty bodies (204, some 200/202/206)
    // resolve with data: undefined.
    raw = await response.text();
  } catch (err) {
    // The redirect refusal above is already typed — keep it.
    if (err instanceof MastoHttpError && err.kind === "redirect") throw err;
    if (timedOut) {
      const target = `${method} ${url.pathname}`;
      const n = Math.round(timeoutMs / 1000);
      throw new MastoHttpError({
        kind: "timeout",
        code: "errors.network.timeoutInstance",
        params: { target, n },
        origin,
        method,
        path: url.pathname + url.search,
        message: `Request timed out (${target}): the instance did not answer within ${n}s. Retry.`,
      });
    }
    // NOTE: never `err instanceof DOMException` — Hermes/RN may not
    // provide the global (repair X2.2 step 5 / networking L3); a name
    // check covers DOMException and cross-realm aborts alike.
    const isAbort =
      typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
    if (isAbort && !timedOut) {
      // Caller cancellation (repair X3.1): the timer did not fire, so
      // this abort came from `opts.signal`, not our deadline. It surfaces
      // as the typed `aborted` kind — never retried, never an error.
      // `toApiError` maps the kind/code through, so the UI sees one shape.
      const target = `${method} ${url.pathname}`;
      throw new MastoHttpError({
        kind: "aborted",
        code: "errors.network.aborted",
        params: { target },
        origin,
        method,
        path: url.pathname + url.search,
        message: `Request was cancelled (${target}).`,
      });
    }
    if (isAbort) throw err; // caller cancelled
    {
      const reason = err instanceof Error ? err.message : "network error";
      throw new MastoHttpError({
        kind: "network",
        code: "errors.network.unreachableOrigin",
        params: { origin, reason },
        origin,
        method,
        path: url.pathname + url.search,
        message: `Could not reach ${origin} (${reason}). Is the server running and the host correct?`,
      });
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }

  let data: unknown;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (response.ok) {
        const target = `${method} ${url.pathname}`;
        throw new MastoHttpError({
          kind: "invalid-json",
          code: "errors.network.badJson",
          params: { status: response.status, target },
          status: response.status,
          body: raw,
          origin,
          method,
          path: url.pathname + url.search,
          message: `Server returned a non-JSON body (HTTP ${response.status}) for ${target}.`,
        });
      }
      data = raw; // HTML/plain error page (proxy, Phoenix catch-all, …)
    }
  }

  const rateLimit = parseRateLimit(response.headers);

  if (!response.ok) {
    // 202 (async media) and 206 (regenerating/processing) are OK statuses.
    opts.log?.("debug", `[fedi-api] ✕ ${method} ${url.pathname + url.search} → ${response.status}`);
    throw new MastoHttpError({
      kind: "http",
      code: "errors.network.apiError",
      params: { status: response.status },
      status: response.status,
      body: data,
      origin,
      method,
      path: url.pathname + url.search,
      rateLimit,
      message: messageFromBody(data, response.status, response.statusText),
    });
  }

  return { status: response.status, data: data as T | undefined, headers: response.headers };
}

// --- Client sugar ---------------------------------------------------------

export interface MastoClient {
  origin: string;
  token: string | null;
  get<T>(path: string, query?: Record<string, QueryValue>, opts?: RequestOptions): Promise<RequestResult<T>>;
  post<T>(path: string, json?: unknown, opts?: RequestOptions): Promise<RequestResult<T>>;
  put<T>(path: string, json?: unknown, opts?: RequestOptions): Promise<RequestResult<T>>;
  patch<T>(path: string, json?: unknown, opts?: RequestOptions): Promise<RequestResult<T>>;
  delete<T>(path: string, json?: unknown, opts?: RequestOptions): Promise<RequestResult<T>>;
  /** Form-encoded POST (OAuth endpoints). */
  postForm<T>(path: string, form: Record<string, QueryValue>, opts?: RequestOptions): Promise<RequestResult<T>>;
  /** Multipart POST (media upload) — no manual Content-Type. */
  postFormData<T>(path: string, formData: FormData, opts?: RequestOptions): Promise<RequestResult<T>>;
  /** Multipart PATCH (account credential images, clickstone §1.8) — the
   * only multipart write besides media upload; no manual Content-Type. */
  patchFormData<T>(path: string, formData: FormData, opts?: RequestOptions): Promise<RequestResult<T>>;
}

/** Thin typed wrapper bound to one (origin, token) session pair. The token
 * is only ever sent to `origin` — enforced by `request`. */
export function createClient(origin: string, token: string | null = null): MastoClient {
  const call = <T>(
    method: HttpMethod,
    path: string,
    json: unknown,
    opts?: RequestOptions,
  ): Promise<RequestResult<T>> =>
    request<T>(origin, path, {
      ...opts,
      method,
      token: opts?.token !== undefined ? opts.token : token,
      ...(json !== undefined ? { json } : {}),
    });

  return {
    origin,
    token,
    get: (path, query, opts) =>
      request(origin, path, { ...opts, method: "GET", token: opts?.token !== undefined ? opts.token : token, ...(query ? { query } : {}) }),
    post: (path, json, opts) => call("POST", path, json, opts),
    put: (path, json, opts) => call("PUT", path, json, opts),
    patch: (path, json, opts) => call("PATCH", path, json, opts),
    delete: (path, json, opts) => call("DELETE", path, json, opts),
    postForm: (path, form, opts) =>
      request(origin, path, { ...opts, method: "POST", form, token: opts?.token !== undefined ? opts.token : token }),
    postFormData: (path, formData, opts) =>
      request(origin, path, { ...opts, method: "POST", formData, token: opts?.token !== undefined ? opts.token : token }),
    patchFormData: (path, formData, opts) =>
      request(origin, path, { ...opts, method: "PATCH", formData, token: opts?.token !== undefined ? opts.token : token }),
  };
}
