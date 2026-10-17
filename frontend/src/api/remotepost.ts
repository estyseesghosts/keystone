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

const REQUEST_TIMEOUT_MS = 6000;
const AP_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

const resolved = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

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
 * or the object carries no readable `url`). Synchronous, for click handlers. */
export function cachedRemotePostUrl(uri: string): string | null {
  return resolved.get(uri) ?? null;
}

/** Resolve the page URL for an AP id. Resolves null when the browser cannot
 * read the object (no CORS), it is unreachable, or it has no `url`. Each
 * id is fetched at most once per session. */
export function resolveRemotePostUrl(uri: string): Promise<string | null> {
  if (resolved.has(uri)) return Promise.resolve(resolved.get(uri) ?? null);
  const pending = inflight.get(uri);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(uri, {
        headers: { Accept: AP_ACCEPT },
        credentials: "omit",
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
      window.clearTimeout(timer);
    }
  })().then((url) => {
    resolved.set(uri, url);
    inflight.delete(uri);
    return url;
  });

  inflight.set(uri, task);
  return task;
}
