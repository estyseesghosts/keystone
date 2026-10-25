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
  | "redirect" // refused to follow a 3xx with a credential (manual only)
  | "aborted" // caller cancelled via `signal` — never retried, never an error
  | "cross-origin"; // refused to send the request to another origin

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Injectable fetch seam. Every transport module takes this (never the
 * platform global) and falls back to `defaultFetchImpl` below — so the
 * production default flows from this one edge, and tests pin URLs by
 * injecting a recording stub. Structural (not `typeof fetch`) so seam
 * modules never name the banned global, not even in type position.
 */
export type FetchImpl = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The platform fetch behind the seam edge. Resolved lazily at CALL time
 * (not bound at module load) so `globalThis.fetch` swaps in tests keep
 * working exactly as before. This is the only `fetch` reference in
 * `packages/fedi` production code outside the two stream transports
 * (which construct sockets, not requests).
 */
export const defaultFetchImpl: FetchImpl = (input, init) => fetch(input, init);

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
  // Cleartext is local-targets-only (repair X2.2 step 6): `https:` always
  // passes; `http:` for a public host throws `errors.origin.insecure`
  // (except under the `__DEV__` rig hatch inside `rejectNonLocalHttp`).
  rejectNonLocalHttp(url);
  // URL.origin canonicalizes scheme/host case and default ports.
  return url.origin;
}

/** True for a 3xx the transport must never follow with a credential. */
export function isRedirectStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

// --- Local-http policy (repair X2.2 step 6) ----------------------------------
//
// `http:` origins are accepted ONLY for local targets: `localhost` /
// `*.localhost`, loopback (127/8, ::1), RFC1918 (10/8, 172.16/12,
// 192.168/16), link-local (169.254/16, fe80::/10), `*.local`, and the
// Android emulator host alias `10.0.2.2`. Anything else over cleartext
// is rejected with `FediError('errors.origin.insecure')`.
//
// Fail-closed on encodings: only plain dotted-decimal IPv4 is recognized
// as local here. Hex/octal/decimal-single-int forms of a loopback address
// are NOT recognized — they are rejected (safe: a rig can use the plain
// form). DNS names that merely resolve to private addresses cannot be
// detected here (no resolver access) and are rejected unless allow-listed
// by name above — also fail-closed.

function isLoopbackOrPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    nums.push(n);
  }
  const [a, b] = nums;
  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // RFC1918 10/8 (covers 10.0.2.2 as well)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  return false;
}

/** True when an `http:` hostname is a local target (see above). Pure. */
export function isLocalHttpHostname(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]") && host.length >= 2) {
    host = host.slice(1, -1);
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host === "10.0.2.2") return true;
  if (host === "::1") return true;
  if (host.startsWith("fe80:") || host === "fe80") return true; // link-local v6
  return isLoopbackOrPrivateIPv4(host);
}

declare const __DEV__: boolean | undefined;

/**
 * Rig escape hatch: `__DEV__` dev builds may use http for non-local hosts.
 * Closed under test runners (`NODE_ENV=test`, which the jest-expo preset
 * also marks `__DEV__ === true`): the rejection must stay verifiable in
 * tests. Same `__DEV__` + non-test convention as the dev API census in
 * the family transports.
 */
function devAllowsInsecureHttp(): boolean {
  if (typeof __DEV__ === "undefined" || __DEV__ !== true) return false;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return false;
  return true;
}

/**
 * Throw `FediError('errors.origin.insecure')` when `url` is an `http:`
 * URL whose host is not a local target (and no `__DEV__` hatch applies).
 */
export function rejectNonLocalHttp(url: URL): void {
  if (url.protocol !== "http:") return;
  if (isLocalHttpHostname(url.hostname)) return;
  if (devAllowsInsecureHttp()) return;
  throw new FediError(
    `Refusing to use insecure http for "${url.hostname}". Use https or a local test host.`,
    "errors.origin.insecure",
    { host: url.hostname },
  );
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
  /** Injectable fetch — defaults to the seam edge (`defaultFetchImpl`). */
  fetchImpl?: FetchImpl;
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
  let raw: string;
  try {
    response = await (opts.fetchImpl ?? defaultFetchImpl)(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      // Never follow a redirect with a credential: a 3xx is refused below
      // (repair X2.2 step 1). `manual` keeps the body on this origin.
      redirect: "manual",
      // Never carry cookies cross-origin: auth is bound to the session.
      credentials: "omit",
    });
    // A 3xx here means "send this (credentialed) body elsewhere". Refuse
    // before any second request: the caller sees a typed redirect error.
    if (isRedirectStatus(response.status)) {
      throw new HttpError({
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
    // below, after `text()` settles — a stalled body times out like
    // stalled headers. Read text first, never blind response.json().
    raw = await response.text();
  } catch (err) {
    // The redirect refusal above is already typed — keep it.
    if (err instanceof HttpError && err.kind === "redirect") throw err;
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
    // NOTE: never `err instanceof DOMException` here — Hermes/RN may not
    // provide the global, and evaluating it would throw *inside* this catch
    // block. A name check covers DOMException and cross-realm aborts alike.
    const isAbort =
      typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
    if (isAbort && !timedOut) {
      // Caller cancellation (repair X3.1): the timer did not fire, so
      // this abort came from `opts.signal`, not our deadline. It surfaces
      // as the typed `aborted` kind — never retried, never an error.
      const target = `${method} ${url.pathname}`;
      throw new HttpError({
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
