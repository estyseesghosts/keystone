// Remote post links: the human-readable page for a federated post.
//
// Every ActivityPub object has an `id` (the `uri` the server packs). Some
// objects also carry a `url`, the page a person reads:
// - Misskey-family objects send no `url`, but their `uri` serves HTML to a
//   browser, so opening the `uri` reaches the post.
// - Mastodon and Pleroma/Akkoma objects carry `url`, and their `uri` 301s to
//   the same page.
//
// Reading the object's `url` needs a cross-origin fetch, which only works
// where the remote server sends `Access-Control-Allow-Origin` (verified on
// Misskey-family servers; Mastodon and Pleroma send no CORS header, so the
// read fails and the `uri` fallback applies). There is deliberately no
// proxy here: it would send every remote post address to a third party.
//
// The object is trusted only when its `id` equals the requested `uri`.
//
// Cache scope (R1.2): this cache is process-wide AND safe to share,
// because it is public-only — resolution uses an injected `fetch` with
// `credentials: "omit"`, so no session credential ever travels here and
// no per-account data is stored. Positive entries (a validated public
// page URL for an exact AP id) settle; negative entries (unreachable,
// non-JSON, id-mismatched, or CORS-refused) expire after
// REMOTE_POST_NEGATIVE_TTL_MS so transient failures become retryable
// instead of cached forever.

const REQUEST_TIMEOUT_MS = 6000;
const AP_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

import { defaultFetchImpl, type FetchImpl } from "../core/http";
import { isPublicHttpsUrl } from "../core/urlPolicy";

/** Negatives are transient (network/CORS/server hiccup): retryable after this. */
export const REMOTE_POST_NEGATIVE_TTL_MS = 5 * 60_000;
const RESOLVED_MAX = 500;

const resolved = new Map<string, { url: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

function remember(uri: string, url: string | null): void {
  resolved.set(uri, { url, at: Date.now() });
  while (resolved.size > RESOLVED_MAX) {
    const oldest = resolved.keys().next();
    if (oldest.done) break;
    resolved.delete(oldest.value);
  }
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** `url` may be a string, a Link object, or an array of either. */
function pageUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pageUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    return httpUrl((value as { href?: unknown }).href);
  }
  return httpUrl(value);
}

/** The page URL already resolved for this AP id, or null (not yet known,
 * negatively cached but still fresh, or the object carries no readable
 * `url`). Synchronous, for click handlers. An expired negative also
 * reads null here — `resolveRemotePostUrl` refetches it. */
export function cachedRemotePostUrl(uri: string): string | null {
  const known = resolved.get(uri);
  if (!known) return null;
  if (known.url === null && Date.now() - known.at >= REMOTE_POST_NEGATIVE_TTL_MS) {
    return null;
  }
  return known.url;
}

/** Resolve the page URL for an AP id. Resolves null when the browser cannot
 * read the object (no CORS), it is unreachable, or it has no `url`.
 * Positive results are kept; negative results are kept only for
 * REMOTE_POST_NEGATIVE_TTL_MS and then retried. Each id has at most one
 * fetch in flight. Sends no credentials (see above), so entries carry no
 * per-account data. The fetch is injectable (tests pin URLs); production
 * flows from the core/http seam edge. */
export function resolveRemotePostUrl(
  uri: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<string | null> {
  const known = resolved.get(uri);
  if (
    known &&
    (known.url !== null || Date.now() - known.at < REMOTE_POST_NEGATIVE_TTL_MS)
  ) {
    return Promise.resolve(known.url);
  }
  const pending = inflight.get(uri);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    // Outbound policy (repair X2.4): never fetch a non-public AP id —
    // private/loopback hosts in any encoding, local names, non-https
    // schemes. The menu falls back to the raw id (see `menuModel`, which
    // reads `cachedRemotePostUrl(uri) ?? uri`). Redirects are not
    // followed (`redirect: 'manual'`): the object is only trusted when
    // its `id` equals the requested `uri`, and following a 3xx would
    // still send the device's request to the next hop before the trust
    // check could reject it.
    if (!isPublicHttpsUrl(uri)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await (opts.fetchImpl ?? defaultFetchImpl)(uri, {
        headers: { Accept: AP_ACCEPT },
        credentials: "omit",
        redirect: "manual",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (!body || typeof body !== "object") return null;
      const object = body as { id?: unknown; url?: unknown };
      // Only trust an object that describes the requested address.
      if (object.id !== uri) return null;
      return pageUrl(object.url);
    } catch {
      // CORS refusal, timeout, network error, or non-JSON: fall back to uri.
      return null;
    } finally {
      clearTimeout(timer);
    }
  })().then((url) => {
    remember(uri, url);
    inflight.delete(uri);
    return url;
  });

  inflight.set(uri, task);
  return task;
}
