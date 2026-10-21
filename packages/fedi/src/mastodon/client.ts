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
import { resolveSameOriginUrl } from "../core/http";

/** Hard ceiling for a single call. Hung requests surface as retryable
 * `kind: "timeout"` errors naming the endpoint — never eternal skeletons. */
export const DEFAULT_TIMEOUT_MS = 30_000;

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

/**
 * Transport errors become the UI's shared `ApiError` AT the boundary, so
 * every honest-state rule the Misskey family relies on (`isUnsupportedError`
 * = 404/405, `isPermissionError` = 401/403) reads the same here. A
 * timeout keeps `kind: "timeout"` — it is never "endpoint unsupported".
 * Non-transport values pass through untouched. Direct endpoint / oauth /
 * instance callers (which bypass the backend's guarded client) should run
 * failures through this before probing support — MD12.
 */
export function toApiError(err: unknown): unknown {
  if (err instanceof MastoHttpError) {
    const code =
      err.body !== null && typeof err.body === "object"
        ? ((err.body as { error?: unknown }).error as string | undefined)
        : undefined;
    return new ApiError(err.message, err.status, code, err.kind);
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
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      // Never carry cookies cross-origin: auth is the Bearer token.
      credentials: "omit",
    });
  } catch (err) {
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
    if (err instanceof DOMException && err.name === "AbortError") throw err; // caller cancelled
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

  // Tolerant parsing: read text first, never blind response.json().
  // Empty bodies (204, some 200/202/206) resolve with data: undefined.
  const raw = await response.text();
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
  };
}
