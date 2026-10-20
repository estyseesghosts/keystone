// Shared HTTP transport core (Phase 1 item D).
//
// This is the generalisation of the Mastodon client's transport layer
// (`api/mastodon/client.ts`): the same origin guard and the same error
// kinds, with `MastoHttpError` renamed to `HttpError` — the island's class
// becomes an alias of this one when Phase 3 rewires it. Self-contained in
// `src/core/` so both adapters can share it without importing each other.
//
// Security model (the fix for the auth-survey finding): `requestJson` has
// NO token parameter at all. Authentication is bound at the session level —
// a transport client is built from a `Session` (see `api/misskey/client.ts`)
// and can only ever talk to that session's origin. A caller can no longer
// hand the request layer an arbitrary token for an arbitrary origin.
//
// Origin safety: a relative `path` must start with "/"; an absolute URL is
// only accepted when it stays on `origin` (Link-header pagination) and is
// REJECTED cross-origin with `kind: "cross-origin"` BEFORE any request is
// sent.

import { FediError } from "./errors";

// i18n note: no locale framework in this package (pure-TS rule). Every
// failure below carries a stable `code` (+ `params`) the UI localizes;
// `message` is the fixed English fallback (same wording as the old catalog).

export type HttpErrorKind =
  | "http" // server answered with a non-2xx status
  | "timeout" // our deadline elapsed — retryable, NOT "unsupported"
  | "network" // could not reach the origin at all
  | "invalid-json" // 2xx with a body that is not JSON
  | "cross-origin"; // refused to send the request to another origin

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Typed transport/API error. `status` is 0 for transport-level failures
 * (timeout/network) — callers must not treat 0 as an HTTP answer. `code`
 * (+ `params`) is the stable localizable identity; `message` is English. */
export class HttpError extends FediError {
  readonly status: number;
  readonly kind: HttpErrorKind;
  /** Parsed JSON body, raw text on non-JSON error bodies, or null. */
  readonly body: unknown;
  readonly origin: string;
  readonly method: HttpMethod;
  /** Path (and query) only — never a token, password, or code. */
  readonly path: string;

  constructor(opts: {
    message: string;
    code: string;
    params?: Record<string, unknown>;
    status?: number;
    kind: HttpErrorKind;
    body?: unknown;
    origin: string;
    method?: HttpMethod;
    path?: string;
  }) {
    super(opts.message, opts.code, opts.params);
    this.name = "HttpError";
    this.status = opts.status ?? 0;
    this.kind = opts.kind;
    this.body = opts.body ?? null;
    this.origin = opts.origin;
    this.method = opts.method ?? "GET";
    this.path = opts.path ?? "";
  }
}

// --- Origins (ported from api/mastodon/client.ts:105-150) ------------------

/**
 * Normalize user-entered instance text to a canonical origin
 * (`https://example.com`, `http://localhost:4000`). Defaults to https; an
 * explicit `http://` is honored (local test targets only). Path/query are
 * dropped — an origin has no path. Throws a human-readable Error otherwise.
 */
export function normalizeOrigin(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new FediError(
      "Enter an instance host, e.g. example.com.",
      "errors.validation.hostRequired",
    );
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  if (hasScheme) {
    const given = raw.slice(0, raw.indexOf("://")).toLowerCase();
    if (given !== "https" && given !== "http") {
      throw new FediError(
        "Use an http(s) instance address, e.g. example.com.",
        "errors.validation.hostScheme",
      );
    }
  }
  const withScheme = hasScheme ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FediError(
      "That host does not look like a valid instance address.",
      "errors.validation.hostInvalid",
    );
  }
  if (url.hostname.includes(" ")) {
    throw new FediError(
      "That host does not look like a valid instance address.",
      "errors.validation.hostInvalid",
    );
  }
  // URL.origin canonicalizes scheme/host case and default ports.
  return url.origin;
}

/** Bare host of an origin (`https://example.com:8443` → `example.com:8443`). */
export function originHost(origin: string): string {
  return origin.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
}

/**
 * Resolve `href` against `origin` and return the absolute URL only when it
 * stays on that exact origin (scheme+host+port). Relative hrefs resolve
 * against `origin`. Returns null for cross-origin, non-http(s), or
 * unparsable URLs — callers must never send a request when this is null.
 */
export function resolveSameOriginUrl(origin: string, href: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// --- Core request ----------------------------------------------------------

export interface HttpJsonResult<T> {
  status: number;
  /** Parsed JSON, or undefined for empty bodies (204 and empty 2xx). */
  data: T | undefined;
  headers: Headers;
}

export interface HttpJsonOptions {
  method?: HttpMethod;
  /** JSON body (Content-Type: application/json). */
  json?: unknown;
  /** Form-encoded body (fetch sets the content type). */
  form?: URLSearchParams;
  /** Multipart body — Content-Type is never set by hand. */
  formData?: FormData;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Perform one JSON request against `origin` + `path`. `path` may be an
 * absolute URL only when it resolves to `origin`; anything else throws
 * `kind: "cross-origin"` BEFORE any network I/O. There is deliberately no
 * token option — see the header comment.
 *
 * Tolerant parsing (kept from both clients): empty bodies resolve with
 * `data: undefined` (204 / 202 / 206 / empty 200). A 2xx with a non-JSON
 * body throws `kind: "invalid-json"`; a non-2xx with a non-JSON body keeps
 * the raw text in `body` (callers can probe support via `status`).
 */
export async function requestJson<T = unknown>(
  origin: string,
  path: string,
  opts: HttpJsonOptions = {},
): Promise<HttpJsonResult<T>> {
  const method: HttpMethod = opts.method ?? "GET";

  let url: URL;
  if (/^https?:\/\//i.test(path)) {
    const same = resolveSameOriginUrl(origin, path);
    if (!same) {
      throw new HttpError({
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
      throw new HttpError({
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

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets the multipart boundary
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form !== undefined) {
    body = opts.form; // fetch sets application/x-www-form-urlencoded
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
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
      // Never carry cookies cross-origin: auth is bound to the session.
      credentials: "omit",
    });
  } catch (err) {
    if (timedOut) {
      const target = `${method} ${url.pathname}`;
      throw new HttpError({
        kind: "timeout",
        code: "errors.network.timeoutInstance",
        params: { target, n: Math.round(timeoutMs / 1000) },
        origin,
        method,
        path: url.pathname + url.search,
        message: `Request timed out (${target}): the instance did not answer within ${Math.round(timeoutMs / 1000)}s. Retry.`,
      });
    }
    if (err instanceof DOMException && err.name === "AbortError") throw err; // caller cancelled
    throw new HttpError({
      kind: "network",
      code: "errors.network.unreachableBare",
      params: { origin, reason: err instanceof Error ? err.message : "network error" },
      origin,
      method,
      path: url.pathname + url.search,
      message: `Could not reach ${origin} (${err instanceof Error ? err.message : "network error"}).`,
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }

  // Read text first, never blind response.json().
  const raw = await response.text();
  let data: unknown;
  if (raw.length > 0) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (response.ok) {
        const target = `${method} ${url.pathname}`;
        throw new HttpError({
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

  if (!response.ok) {
    throw new HttpError({
      kind: "http",
      code: "errors.network.apiError",
      params: { status: response.status },
      status: response.status,
      body: data,
      origin,
      method,
      path: url.pathname + url.search,
      message: httpMessage(data, response.status),
    });
  }

  return { status: response.status, data: data as T | undefined, headers: response.headers };
}

function httpMessage(data: unknown, status: number): string {
  if (data !== null && typeof data === "object") {
    const rec = data as { error?: unknown; error_description?: unknown };
    // Mastodon-style: `{error: "…"}` / OAuth `error_description`.
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
    if (typeof rec.error_description === "string" && rec.error_description.trim()) {
      return rec.error_description;
    }
    // Misskey-style envelope: `{error: {message, code, kind}}`.
    const envelope = rec.error as { message?: unknown } | undefined;
    if (envelope && typeof envelope.message === "string" && envelope.message.trim()) {
      return envelope.message;
    }
  }
  if (typeof data === "string" && data.trim() && data.length < 300) return data.trim();
  return `API error: HTTP ${status}`;
}
