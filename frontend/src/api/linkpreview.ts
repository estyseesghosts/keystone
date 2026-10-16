// Client-side link previews (no server support needed).
//
// Neither Sharkey (verified 404 on `url-preview`) nor Pinetree offers a
// preview endpoint, so Keystone fetches the page itself: direct first
// (works for CORS-open sites), then a public CORS proxy, byte-capped and
// timed out. Proxy-leg tradeoff worth knowing: the proxy operator sees
// which URLs users preview, and public proxies are flaky — either leg
// failing just degrades to the basic domain card, never an error.
// Results are cached in memory per URL for the session.
//
// A first-party endpoint (Pinetree `url-preview`, or Misskey's where it
// exists) should replace this: same card UI, `LinkCard` keeps its shape
// and just swaps this fetcher for an `apiCall`. See the state log.

export interface LinkPreview {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string | null;
  icon?: string | null;
}

const PREVIEW_TIMEOUT_MS = 10_000;
/** og:/title tags live in `<head>` — 256 KiB is plenty, then stop. */
const PREVIEW_MAX_BYTES = 256 * 1024;

const previewCache = new Map<string, LinkPreview | null>();

function isHttpUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Read at most `PREVIEW_MAX_BYTES` from a response body, then stop. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
      if (total >= PREVIEW_MAX_BYTES) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(Math.min(total, PREVIEW_MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    merged.set(chunk.subarray(0, merged.length - offset), offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch at most `PREVIEW_MAX_BYTES` of a page's HTML: direct first (works
 * for CORS-open sites), then a public CORS proxy. Either leg failing just
 * moves to the next; all failing yields null (basic card). */
async function fetchHeadHtml(pageUrl: string): Promise<string | null> {
  try {
    const direct = await fetchWithTimeout(pageUrl);
    if (direct.ok && direct.body) return await readCapped(direct.body);
  } catch {
    // CORS or network: fall through to the proxy.
  }
  try {
    const proxied = await fetchWithTimeout(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`,
    );
    if (proxied.ok && proxied.body) return await readCapped(proxied.body);
  } catch {
    // Proxy down/blocked: the basic card covers it.
  }
  return null;
}

function metaContent(doc: Document, selector: string): string | undefined {
  const content = doc.querySelector(selector)?.getAttribute("content")?.trim();
  return content ? content : undefined;
}

/** Resolve a possibly-relative asset URL against the page; http(s) only. */
function resolveAsset(raw: string | undefined, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, pageUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

/** Best-effort OpenGraph preview for a page URL, or null when anything
 * fails (network, proxy, parse, no usable tags). */
export async function fetchLinkPreview(pageUrl: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(pageUrl);
  if (cached !== undefined) return cached;
  let preview: LinkPreview | null = null;
  try {
    if (!isHttpUrl(pageUrl)) return null;
    const html = await fetchHeadHtml(pageUrl);
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title =
      metaContent(doc, 'meta[property="og:title"]') ??
      (doc.title.trim() ? doc.title.trim() : undefined);
    const description =
      metaContent(doc, 'meta[property="og:description"]') ??
      metaContent(doc, 'meta[name="description"]');
    const siteName = metaContent(doc, 'meta[property="og:site_name"]');
    const image = resolveAsset(metaContent(doc, 'meta[property="og:image"]'), pageUrl);
    const iconHref =
      doc.querySelector('link[rel="icon"]')?.getAttribute("href") ??
      doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
      undefined;
    const icon = resolveAsset(iconHref?.trim() || undefined, pageUrl);
    if (title || description || image) {
      preview = { title, description, siteName, image, icon };
    }
  } catch {
    preview = null;
  }
  previewCache.set(pageUrl, preview);
  return preview;
}

/** Host display for the basic card ("example.com", no scheme/path). */
export function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return pageUrl;
  }
}
