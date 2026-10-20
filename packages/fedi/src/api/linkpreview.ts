// Client-side link previews (no server support needed).
//
// Neither Sharkey (verified 404 on `url-preview`) nor Pinetree offers a
// preview endpoint, so Keystone fetches the page itself: direct first
// (works for CORS-open sites), then — only if `linkPreviewProxy` is set in
// the runtime config — that CORS proxy, timed out. Proxy-leg tradeoff
// worth knowing: the proxy operator sees which URLs users preview (hence
// opt-in, off by default) — either leg failing just degrades to the
// basic domain card, never an error. Results are cached in memory per URL
// for the session.
//
// A first-party endpoint (Pinetree `url-preview`, or Misskey's where it
// exists) should replace this: same card UI, `LinkCard` keeps its shape
// and just swaps this fetcher for an `apiCall`. See the state log.
//
// RN port notes (slice 2.4): the old implementation parsed with
// `DOMParser` and streamed the body through `ReadableStream.getReader`
// for its byte cap — neither exists on native. Parsing now runs over
// `htmlparser2` (the content-AST parser, shared dep) and the cap bounds
// the buffered text instead (`response.text()` then slice: RN fetch
// bodies are not guaranteed streams). Same card shape, same proxy
// opt-in, same degrade-to-basic-card contract.

import { parseDocument } from "htmlparser2";
import { runtimeConfig } from "../core/config";

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

/** Injectable fetch (tests pass a stub; production uses global fetch). */
export type PreviewFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PreviewOptions {
  fetchImpl?: PreviewFetch;
  /** CORS-proxy template override. `undefined` reads the runtime config. */
  proxy?: string | null;
}

function isHttpUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  fetchImpl: PreviewFetch,
  url: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch at most `PREVIEW_MAX_BYTES` of a page's HTML: direct first (works
 * for CORS-open sites), then the OPT-IN configured CORS proxy (if any).
 * Either leg failing just moves to the next; all failing yields null
 * (basic card). */
async function fetchHeadHtml(
  fetchImpl: PreviewFetch,
  pageUrl: string,
  proxy: string | null,
): Promise<string | null> {
  try {
    const direct = await fetchWithTimeout(fetchImpl, pageUrl);
    if (direct.ok) return (await direct.text()).slice(0, PREVIEW_MAX_BYTES);
  } catch {
    // CORS or network: fall through to the proxy.
  }
  // The CORS proxy is OPT-IN: sending every previewed URL to a third party
  // is never the default. `{url}` in the template is replaced by the
  // encoded page URL; otherwise the encoded URL is appended.
  if (!proxy) return null;
  try {
    const target = encodeURIComponent(pageUrl);
    const proxyUrl = proxy.includes("{url}") || proxy.includes("%7Burl%7D")
      ? proxy.replace("{url}", target).replace("%7Burl%7D", target)
      : `${proxy}${target}`;
    const proxied = await fetchWithTimeout(fetchImpl, proxyUrl);
    if (proxied.ok) return (await proxied.text()).slice(0, PREVIEW_MAX_BYTES);
  } catch {
    // Proxy down/blocked: the basic card covers it.
  }
  return null;
}

interface DomNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  data?: string;
  children?: DomNode[];
}

function lowerAttrs(node: DomNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attribs ?? {})) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function metaContent(metas: Array<Record<string, string>>, selector: {
  property?: string;
  name?: string;
}): string | undefined {
  for (const attrs of metas) {
    if (selector.property !== undefined && attrs["property"] !== selector.property) continue;
    if (selector.name !== undefined && attrs["name"] !== selector.name) continue;
    const content = (attrs["content"] ?? "").trim();
    if (content) return content;
  }
  return undefined;
}

/** Best-effort OpenGraph preview from a page's HTML. Pure: title, meta
 * og:/description tags, and icon link hrefs only — scripts, bodies, and
 * event attributes are never read. */
export function extractLinkPreview(html: string, pageUrl: string): LinkPreview | null {
  let doc: { children?: DomNode[] };
  try {
    doc = parseDocument(html) as unknown as { children?: DomNode[] };
  } catch {
    return null;
  }
  const metas: Array<Record<string, string>> = [];
  const icons: string[] = [];
  let title = "";
  const walk = (nodes: readonly DomNode[], inTitle: boolean): void => {
    for (const node of nodes) {
      if (node.type === "text" || node.type === "cdata") {
        if (inTitle) title += node.data ?? "";
        continue;
      }
      if (node.type !== "tag") continue;
      const tag = (node.name ?? "").toLowerCase();
      if (tag === "script" || tag === "style") continue;
      if (tag === "meta") {
        metas.push(lowerAttrs(node));
        continue;
      }
      if (tag === "link") {
        const attrs = lowerAttrs(node);
        if (attrs["rel"] === "icon" || attrs["rel"] === "shortcut icon") {
          if (attrs["href"]) icons.push(attrs["href"]);
        }
        continue;
      }
      walk(node.children ?? [], inTitle || tag === "title");
    }
  };
  walk(doc.children ?? [], false);

  const cleanTitle = title.trim() || undefined;
  const resolvedTitle =
    metaContent(metas, { property: "og:title" }) ?? (cleanTitle ? cleanTitle : undefined);
  const description =
    metaContent(metas, { property: "og:description" }) ??
    metaContent(metas, { name: "description" });
  const siteName = metaContent(metas, { property: "og:site_name" });
  const image = resolveAsset(metaContent(metas, { property: "og:image" }), pageUrl);
  const icon = resolveAsset(icons[0]?.trim() || undefined, pageUrl);
  if (resolvedTitle || description || image) {
    return { title: resolvedTitle, description, siteName, image, icon };
  }
  return null;
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
export async function fetchLinkPreview(
  pageUrl: string,
  opts: PreviewOptions = {},
): Promise<LinkPreview | null> {
  const cached = previewCache.get(pageUrl);
  if (cached !== undefined) return cached;
  let preview: LinkPreview | null = null;
  try {
    if (!isHttpUrl(pageUrl)) return null;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const proxy = opts.proxy === undefined ? runtimeConfig().linkPreviewProxy : opts.proxy;
    const html = await fetchHeadHtml(fetchImpl, pageUrl, proxy);
    if (html) preview = extractLinkPreview(html, pageUrl);
  } catch {
    preview = null;
  }
  previewCache.set(pageUrl, preview);
  return preview;
}

/** Clear the in-memory preview cache (tests). */
export function clearPreviewCache(): void {
  previewCache.clear();
}

/** Host display for the basic card ("example.com", no scheme/path). */
export function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return pageUrl;
  }
}
