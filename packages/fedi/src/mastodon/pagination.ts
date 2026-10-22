// Link-header + cursor pagination (docs/mastoapi-contract.md §5).
//
// Rules:
// - Prefer `rel="next"`/`rel="prev"` URLs from the Link header (both
//   backends emit them, CORS-exposed). Fall back to cursor params only
//   when the header is absent.
// - Any absolute next-URL is validated to stay on the session origin
//   BEFORE a token could ever be attached (resolveSameOriginUrl).
// - IDs are opaque strings: never parsed, never numerically compared.
// - End-of-feed = no next link OR an empty page — NEVER `length < limit`
//   (filters/grouping make length misleading).

import { resolveSameOriginUrl } from "../core/http";
import type { QueryValue } from "./client";

/** Parsed `Link` header relations. */
export interface LinkRelations {
  next: string | null;
  prev: string | null;
}

/**
 * Parse a Link header value into next/prev hrefs (kept verbatim —
 * relative hrefs are allowed here; resolution happens against the
 * session origin in nextLink()/prevLink()).
 *
 * Format: `<https://host/api/...?max_id=1>; rel="next", <...>; rel="prev"`
 */
export function parseLinkHeader(value: string | null | undefined): LinkRelations {
  const out: LinkRelations = { next: null, prev: null };
  if (!value) return out;
  for (const part of value.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?([^";,]+)"?/i.exec(part.trim());
    if (!match) continue;
    const [, href, rel] = match;
    const rels = rel.toLowerCase().split(/\s+/);
    if (rels.includes("next") && !out.next) out.next = href;
    if (rels.includes("prev") && !out.prev) out.prev = href;
  }
  return out;
}

/**
 * The next-page URL, or null: absent Link, or the URL leaves the session
 * origin (a cross-origin next link is never followed with a token).
 */
export function nextLink(headers: Headers, origin: string): string | null {
  const href = parseLinkHeader(headers.get("Link")).next;
  if (!href) return null;
  return resolveSameOriginUrl(origin, href);
}

export function prevLink(headers: Headers, origin: string): string | null {
  const href = parseLinkHeader(headers.get("Link")).prev;
  if (!href) return null;
  return resolveSameOriginUrl(origin, href);
}

/** Cursor params understood by both backends (contract §5). `max_id` pages
 * older, `since_id` newer, `min_id` newer-where-supported. `offset` is
 * the page-number cursor of the endpoints that use one (`/api/v2/search`;
 * combined — type-less — search ignores it, so search pages by type). */
export interface Cursors {
  max_id?: string;
  since_id?: string;
  min_id?: string;
  /** Page number for offset-paged endpoints (v2 search). */
  offset?: number;
  limit?: number;
}

/** Attach cursors to a query object (undefined entries are skipped by the
 * transport). Never mutates the input. */
export function withCursors(
  query: Record<string, QueryValue> | undefined,
  cursors: Cursors,
): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = { ...(query ?? {}) };
  if (cursors.max_id !== undefined) out.max_id = cursors.max_id;
  if (cursors.since_id !== undefined) out.since_id = cursors.since_id;
  if (cursors.min_id !== undefined) out.min_id = cursors.min_id;
  if (cursors.offset !== undefined) out.offset = cursors.offset;
  if (cursors.limit !== undefined) out.limit = cursors.limit;
  return out;
}

/**
 * Cursor params embedded in an absolute next/prev URL — lets callers keep
 * using plain `max_id`/`since_id` params instead of absolute URLs when
 * they need to rebuild a request. Returns {} when absent.
 */
export function cursorsFromUrl(url: string): Cursors {
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    const get = (key: string): string | undefined => {
      const v = parsed.searchParams.get(key);
      return v === null ? undefined : v;
    };
    const out: Cursors = {};
    const maxId = get("max_id");
    const sinceId = get("since_id");
    const minId = get("min_id");
    const offset = get("offset");
    const limit = get("limit");
    if (maxId !== undefined) out.max_id = maxId;
    if (sinceId !== undefined) out.since_id = sinceId;
    if (minId !== undefined) out.min_id = minId;
    if (offset !== undefined) {
      const n = Number(offset);
      if (Number.isFinite(n)) out.offset = n;
    }
    if (limit !== undefined) {
      const n = Number(limit);
      if (Number.isFinite(n)) out.limit = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** Fallback cursor from the LAST item — only for endpoints that emit no
 * Link header. IDs stay strings; no numeric assumptions. */
export function fallbackMaxId(items: ReadonlyArray<{ id: string }> | undefined): string | undefined {
  if (!items || items.length === 0) return undefined;
  return items[items.length - 1].id;
}

/**
 * End-of-feed: true when the page carried no next link or was empty.
 * Deliberately NOT `items.length < limit` (contract §5).
 */
export function isEndOfFeed(next: string | null, items: ReadonlyArray<unknown>): boolean {
  return next === null || items.length === 0;
}

/** How to fetch the next page of a paginated endpoint. */
export type Continuation =
  | { kind: "url"; url: string } // server's exact URL, verified same-origin
  | { kind: "cursors"; cursors: Cursors }; // cursor params, rebuilt on origin

/**
 * Continuation plan for a page's Link header (contract §5):
 * - Prefers the server's exact `rel="next"` URL when it stays on the
 *   session origin.
 * - Otherwise — OBSERVED on Akkoma 3.20: servers advertise Link URLs on
 *   their CONFIGURED base_url (`Pleroma.Web.Endpoint :url`), which is a
 *   different origin whenever Keystodon talks to the instance through a
 *   proxy or a different host/port — only the cursor PARAMS are carried
 *   over and the request is rebuilt on the session origin, so the Bearer
 *   token never leaves it (the raw URL itself is never followed).
 * - Returns null for "no next link" and for a cross-origin link with no
 *   recognized cursor (end of feed — never a wrong request).
 *
 * `rel` selects the direction; `nextContinuation`/`prevContinuation` are
 * the only intended callers (`prev` is used where an endpoint offers
 * back-paging — search v2 carries `offset`, which `cursorsFromUrl`
 * recognizes).
 */
function linkContinuation(
  headers: Headers,
  origin: string,
  rel: "next" | "prev",
): Continuation | null {
  const raw = parseLinkHeader(headers.get("Link"))[rel];
  if (!raw) return null;
  const same = resolveSameOriginUrl(origin, raw);
  if (same) return { kind: "url", url: same };
  const cursors = cursorsFromUrl(raw);
  if (
    cursors.max_id !== undefined ||
    cursors.since_id !== undefined ||
    cursors.min_id !== undefined ||
    cursors.offset !== undefined
  ) {
    return { kind: "cursors", cursors };
  }
  return null;
}

/** Next-page plan for a page's Link header (see `linkContinuation`). */
export function nextContinuation(headers: Headers, origin: string): Continuation | null {
  return linkContinuation(headers, origin, "next");
}

/** Previous-page plan for a page's Link header. Same origin/cursor rules
 * as `nextContinuation`; `offset` is a recognized cursor here because
 * v2 search back-pages by page number. */
export function prevContinuation(headers: Headers, origin: string): Continuation | null {
  return linkContinuation(headers, origin, "prev");
}
