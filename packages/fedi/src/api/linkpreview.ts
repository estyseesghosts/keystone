// Client-side link previews (no server support needed).
//
// Neither Sharkey (verified 404 on `url-preview`) nor Pinetree offers a
// preview endpoint, so Keystone fetches the page itself: direct first
// (works for CORS-open sites), then — only if `linkPreviewProxy` is set in
// the runtime config — that CORS proxy, timed out. Proxy-leg tradeoff
// worth knowing: the proxy operator sees which URLs users preview (hence
// opt-in, off by default) — either leg failing just degrades to the
// basic domain card, never an error. Results are cached in memory per URL
// for the session, and concurrent fetches for one URL share a single
// in-flight request (E9 honest unfurl: tap-to-unfurl per card, never a
// fetch storm).
//
// Outbound policy (repair X2.4): the page URL and every preview asset URL
// must pass `isPublicHttpsUrl` — private/loopback hosts in any encoding,
// local names, and non-https schemes never leave the device. Redirects are
// followed manually (never by the transport) up to PREVIEW_MAX_REDIRECTS
// hops, re-checking the policy on every hop. The body is stream-limited to
// PREVIEW_MAX_BYTES (streamed where the platform offers a reader, sliced
// otherwise) and the timeout covers the whole fetch including the body.
//
// A first-party endpoint (Pinetree `url-preview`, or Misskey's where it
// exists) should replace this: same card UI, `LinkCard` keeps its shape
// and just swaps this fetcher for an `apiCall`. See the state log.

import { parseDocument } from "htmlparser2";
import { runtimeConfig } from "../core/config";
import { defaultFetchImpl } from "../core/http";
import { isPublicHttpsUrl } from "../core/urlPolicy";

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

/** In-flight fetches by URL: concurrent callers share one promise, so N
 * mounted cards for the same URL cost one fetch (E9: tap-to-unfurl per
 * card, never a fetch storm). Entries are deleted on settle; the settled
 * value lives in `previewCache` (hit or negative). */
const inflight = new Map<string, Promise<LinkPreview | null>>();

/** Injectable fetch (tests pass a stub; production flows from the
 * core/http seam edge). */
export type PreviewFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PreviewOptions {
  fetchImpl?: PreviewFetch;
  /** CORS-proxy template override. `undefined` reads the runtime config. */
  proxy?: string | null;
  /** Per-hop deadline in ms (covers headers AND the capped body read). */
  timeoutMs?: number;
  /** Permit `http:` page/asset URLs (dev rigs only). Host rules still apply. */
  allowHttp?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Redirect hops followed per leg before giving up (policy re-checked each). */
const PREVIEW_MAX_REDIRECTS = 3;

/** Minimal structural reader: avoids naming platform stream types. */
interface BodyReader {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel?: () => Promise<void> | void;
  releaseLock?: () => void;
}

function bodyReaderOf(res: Response): BodyReader | null {
  const body = (res as unknown as { body?: unknown }).body as
    | { getReader?: unknown }
    | null
    | undefined;
  if (!body || typeof body.getReader !== "function") return null;
  try {
    const reader = (body.getReader as () => unknown)();
    if (reader && typeof (reader as BodyReader).read === "function") {
      return reader as BodyReader;
    }
    return null;
  } catch {
    return null;
  }
}

function chunkBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
    const view = value as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/** Reject `promise` when `ms` elapses; the timer is always cleared. */
function readWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error("preview body timeout"));
  let id: ReturnType<typeof setTimeout>;
  const gate = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error("preview body timeout")), ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(id));
}

/**
 * Read at most PREVIEW_MAX_BYTES of the body for og:/title parsing.
 * Streams through the platform reader where one exists (native fetch
 * bodies are not guaranteed streams — then `text()` plus a slice), and
 * races every wait against the remaining deadline so a stalled body
 * cannot outlive the timeout. The caller owns the abort timer.
 */
async function readCappedBody(res: Response, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  const remaining = (): number => timeoutMs - (Date.now() - startedAt);
  if (typeof TextDecoder === "undefined") {
    const text = await readWithTimeout(res.text(), remaining());
    return text.slice(0, PREVIEW_MAX_BYTES);
  }
  const reader = bodyReaderOf(res);
  if (!reader) {
    const text = await readWithTimeout(res.text(), remaining());
    return text.slice(0, PREVIEW_MAX_BYTES);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (total >= PREVIEW_MAX_BYTES) break;
      const next = await readWithTimeout(reader.read(), remaining());
      if (next.done) break;
      const bytes = chunkBytes(next.value);
      if (!bytes) break;
      if (bytes.byteLength === 0) continue;
      const room = PREVIEW_MAX_BYTES - total;
      chunks.push(bytes.byteLength > room ? bytes.subarray(0, room) : bytes);
      total += Math.min(bytes.byteLength, room);
    }
  } finally {
    // Free the socket even when the cap cut the stream short.
    // Best-effort and NEVER awaited: awaiting cleanup here would let a
    // hung stream defeat the read deadline (some platforms leave
    // `cancel()` pending forever), so release-and-continue instead.
    try {
      const cleanup = reader.cancel?.();
      if (cleanup && typeof (cleanup as Promise<unknown>).catch === "function") {
        (cleanup as Promise<unknown>).catch(() => {});
      }
    } catch {
      // Cleanup only: the bytes already read still parse.
    }
    try {
      reader.releaseLock?.();
    } catch {
      // Locks may already be released by cancel.
    }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    merged.set(chunk, off);
    off += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function isRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

/** Best-effort socket release for bodies that are never read. Never
 * awaited, for the same reason as the read-path cleanup above. */
async function dropBody(res: Response): Promise<void> {
  try {
    const reader = bodyReaderOf(res);
    if (reader) {
      const cleanup = reader.cancel?.();
      if (cleanup && typeof (cleanup as Promise<unknown>).catch === "function") {
        (cleanup as Promise<unknown>).catch(() => {});
      }
    }
  } catch {
    // Cleanup only.
  }
}

/**
 * Fetch one leg (direct page or proxy) with manual redirect handling:
 * the transport never follows on its own (`redirect: 'manual'`), every
 * 3xx target is resolved against the current URL and re-checked against
 * the outbound policy, and non-OK statuses are misses. The per-hop timer
 * covers headers and the capped body read together.
 */
async function fetchPageHtml(
  fetchImpl: PreviewFetch,
  startUrl: string,
  opts: { timeoutMs: number; gate: (url: string) => boolean },
): Promise<string | null> {
  let current = startUrl;
  for (let hop = 0; hop <= PREVIEW_MAX_REDIRECTS; hop++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(current, {
          signal: controller.signal,
          redirect: "manual",
          credentials: "omit",
        });
      } catch {
        // CORS refusal, offline, DNS: the next leg (or basic card) covers it.
        return null;
      }
      if (isRedirect(res.status)) {
        // In browsers a manual redirect surfaces as `opaqueredirect` with
        // no visible Location — that degrades to the basic card by design.
        const location = res.headers.get("location");
        await dropBody(res);
        if (!location || hop === PREVIEW_MAX_REDIRECTS) return null;
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          return null;
        }
        if (!opts.gate(next)) return null;
        current = next;
        continue;
      }
      if (!res.ok) return null;
      const remaining = opts.timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) return null;
      return await readCappedBody(res, remaining);
    } catch {
      // Body stall past the deadline, or a bad chunk: miss, not an error.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Fetch at most `PREVIEW_MAX_BYTES` of a page's HTML: direct first (works
 * for CORS-open sites), then the OPT-IN configured CORS proxy (if any).
 * Either leg failing just moves to the next; all failing yields null
 * (basic card). */
async function fetchHeadHtml(
  fetchImpl: PreviewFetch,
  pageUrl: string,
  proxy: string | null,
  opts: { timeoutMs: number; allowHttp: boolean },
): Promise<string | null> {
  const gate = (url: string): boolean => isPublicHttpsUrl(url, { allowHttp: opts.allowHttp });
  const direct = await fetchPageHtml(fetchImpl, pageUrl, { timeoutMs: opts.timeoutMs, gate });
  if (direct !== null) return direct;
  // The CORS proxy is OPT-IN: sending every previewed URL to a third party
  // is never the default. `{url}` in the template is replaced by the
  // encoded page URL; otherwise the encoded URL is appended. The proxy URL
  // itself is operator-configured and trusted as configured, but every
  // hop after it is re-checked against the outbound policy.
  if (!proxy) return null;
  const target = encodeURIComponent(pageUrl);
  const proxyUrl = proxy.includes("{url}") || proxy.includes("%7Burl%7D")
    ? proxy.replace("{url}", target).replace("%7Burl%7D", target)
    : `${proxy}${target}`;
  return fetchPageHtml(fetchImpl, proxyUrl, { timeoutMs: opts.timeoutMs, gate });
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
 * event attributes are never read. Asset URLs must pass the outbound
 * policy (relative URLs resolve against the already-vetted page). */
export function extractLinkPreview(
  html: string,
  pageUrl: string,
  opts: { allowHttp?: boolean } = {},
): LinkPreview | null {
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
  const image = resolveAsset(metaContent(metas, { property: "og:image" }), pageUrl, opts);
  const icon = resolveAsset(icons[0]?.trim() || undefined, pageUrl, opts);
  if (resolvedTitle || description || image) {
    return { title: resolvedTitle, description, siteName, image, icon };
  }
  return null;
}

/** Resolve a possibly-relative asset URL against the page. Only URLs the
 * device may fetch (outbound policy) survive — a page pointing its preview
 * image at a LAN host degrades to no image, never a probe. */
function resolveAsset(
  raw: string | undefined,
  pageUrl: string,
  opts: { allowHttp?: boolean },
): string | null {
  if (!raw) return null;
  try {
    const resolved = new URL(raw, pageUrl).toString();
    return isPublicHttpsUrl(resolved, opts) ? resolved : null;
  } catch {
    return null;
  }
}

/** Best-effort OpenGraph preview for a page URL, or null when anything
 * fails (network, proxy, parse, no usable tags). Single-flight per URL:
 * concurrent calls share one fetch; settled results (hit or miss) come
 * from the memory cache. */
export function fetchLinkPreview(
  pageUrl: string,
  opts: PreviewOptions = {},
): Promise<LinkPreview | null> {
  const cached = previewCache.get(pageUrl);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = inflight.get(pageUrl);
  if (running !== undefined) return running;
  const task = loadPreview(pageUrl, opts).finally(() => {
    if (inflight.get(pageUrl) === task) inflight.delete(pageUrl);
  });
  inflight.set(pageUrl, task);
  return task;
}

async function loadPreview(
  pageUrl: string,
  opts: PreviewOptions,
): Promise<LinkPreview | null> {
  let preview: LinkPreview | null = null;
  try {
    const timeoutMs = opts.timeoutMs ?? PREVIEW_TIMEOUT_MS;
    const allowHttp = opts.allowHttp ?? false;
    // Outbound policy first: a private/loopback/non-https page is never
    // fetched — the miss is cached like any other, so it stays cheap.
    if (!isPublicHttpsUrl(pageUrl, { allowHttp })) return null;
    const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;
    const proxy = opts.proxy === undefined ? runtimeConfig().linkPreviewProxy : opts.proxy;
    const html = await fetchHeadHtml(fetchImpl, pageUrl, proxy, { timeoutMs, allowHttp });
    if (html) preview = extractLinkPreview(html, pageUrl, { allowHttp });
  } catch {
    preview = null;
  }
  previewCache.set(pageUrl, preview);
  return preview;
}

/** Clear the in-memory preview cache (tests). In-flight joins are dropped
 * too — a pending fetch still resolves for its holders, but the next call
 * starts a fresh fetch. */
export function clearPreviewCache(): void {
  previewCache.clear();
  inflight.clear();
}

/** Host display for the basic card ("example.com", no scheme/path). */
export function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return pageUrl;
  }
}
