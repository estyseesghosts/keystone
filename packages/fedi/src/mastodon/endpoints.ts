// Typed endpoint methods (keystodon.md §3): components never build URLs
// or know query rules — they call these. Everything runs on the Phase 1
// transport (`client.ts`) and pagination (`pagination.ts`).
//
// Error contract: these functions throw the RAW `MastoHttpError` — the
// backend's guarded client adapts it to the shared `ApiError` at the
// boundary (so `isUnsupportedError`/`isPermissionError` work identically
// on both families). DIRECT callers (tests, scripts, future services)
// must run failures through `client.toApiError` themselves before
// probing support — an unadapted `MastoHttpError` is invisible to the
// shared predicates (MD12).
//
// Phase 2 surface: home/local/public timelines + account + relationship
// reads (keystodon.md §12). Phase 3 additions (handoff §2.3/§2.4): tag
// timeline, v2 search, status detail + context, account statuses,
// followers/following. Writes (create/favourite/reblog/follow) are
// Phase 4 and deliberately absent — no endpoint functions that don't
// exist yet.
//
// Query rules (contract §5): cursors are `max_id`/`since_id`/`min_id` +
// `limit`; `local=true` rides the public timeline query; array params use
// the transport's repeated `key[]` encoding. A page's `Link rel="next"`
// is preferred and origin-checked before use (cross-origin links fall
// back to cursor carryover — `nextContinuation`).

import { createClient, MastoHttpError } from "./client";
import { ApiError, FediError } from "../core/errors";
import type { MastoClient, QueryValue } from "./client";
import { adaptAccount, adaptRelationship, adaptStatus } from "./adapt";
import type { StatusBody } from "./compose";
import type { Account, Post, Relationship } from "../core/models";
import type {
  InstanceRule,
  ReportCategory,
  ReportOptions,
  ReportResult,
  TimelineKind,
} from "../core/backend";
import { normalizeReportOptions } from "../core/backend";
import { getActiveSessionId, loadSessions, type KeyValueStore } from "../core/sessions";
import { nextContinuation, prevContinuation, withCursors } from "./pagination";
import type { Continuation } from "./pagination";
import { pickQuotedStatus } from "./quoteMarker";
import type {
  Account as WireAccount,
  MediaAttachment,
  Notification as WireNotification,
  Relationship as WireRelationship,
  Rule as WireRule,
  ScheduledStatus as WireScheduledStatus,
  Status,
} from "./wire";

const PAGE_LIMIT = 20; // server default; hard max 40 on both backends

/**
 * Client for the ACTIVE Mastodon-family session from the unified store
 * (`core/sessions`): the token is only ever paired with its own origin.
 * When signed out, falls back to the page's own origin with NO token so
 * public/local timelines stay browsable — servers that restrict them
 * answer 401/403, which callers surface honestly (never as "endpoint
 * missing").
 */
export function feedClient(store: KeyValueStore, fallbackOrigin: string): MastoClient {
  const activeId = getActiveSessionId(store);
  const session =
    (activeId
      ? loadSessions(store).find((s) => s.id === activeId)
      : undefined) ?? null;
  if (session && session.family === "mastodon") {
    return createClient(session.origin, session.token);
  }
  return createClient(fallbackOrigin, null);
}

/** One raw page of a Link-paged listing, before the core `Cursor` encodes
 * the continuation (that happens at the backend boundary — `adapt.pageOf`).
 * `end` follows contract §5: no next continuation OR an empty page, NEVER
 * `items.length < limit`. */
export interface ContinuationPage<T> {
  items: T[];
  /** How to fetch the NEXT page (Link URL on-origin, cursor carryover
   * off-origin), or null when the server offered no next link. */
  continuation: Continuation | null;
  end: boolean;
}

export type TimelinePage = ContinuationPage<Post>;

function timelinePath(kind: TimelineKind): string {
  switch (kind) {
    case "home":
      return "/api/v1/timelines/home";
    case "social":
      // No MastoAPI equivalent (the backend rejects social before this is
      // reached) — throw rather than silently serving public as social.
      throw new FediError("The social timeline is not available on this server.", "errors.unsupported.social");
    case "local":
    case "global":
      // `local: true` below narrows the public timeline to local posts.
      return "/api/v1/timelines/public";
  }
}

export interface TimelinePageOptions {
  /** Page size for a first/refresh fetch (server clamps to 40). Ignored
   * when a continuation supplies its own `limit`. */
  limit?: number;
  /** Continue from a previous page's `TimelinePage.continuation`. Null/
   * undefined = fresh first page. */
  continuation?: Continuation | null;
}

/**
 * One page of a home/local/public timeline, adapted to `Post`s.
 *
 * - First/refresh pages: `{limit}` only.
 * - Older pages: pass the previous page's continuation — the server's
 *   exact next URL when it stays on the session origin, otherwise the
 *   cursor params carried over (Akkoma advertises Link URLs on its
 *   configured base_url, which is cross-origin behind a proxy).
 * - `end` follows contract §5: no next continuation OR empty page —
 *   never `length < limit`.
 */
export async function fetchTimelinePage(
  client: MastoClient,
  kind: TimelineKind,
  opts: TimelinePageOptions = {},
): Promise<TimelinePage> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : timelinePath(kind);
  // The server's next URL already carries every param (local, cursors,
  // limit) — never append a second copy of them.
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url"
      ? {}
      : kind === "local"
        ? { local: true }
        : {};
  if (opts.continuation?.kind === "cursors") {
    Object.assign(query, withCursors({}, opts.continuation.cursors));
  } else if (!opts.continuation) {
    Object.assign(query, withCursors({}, { limit: opts.limit ?? PAGE_LIMIT }));
  }

  const res = await client.get<Status[]>(path, query);
  if (!Array.isArray(res.data)) {
    // 2xx with a non-array body: a malformed answer, NOT an empty feed.
    throw new FediError(`Timeline ${kind} returned an unexpected response shape (HTTP ${res.status}).`, "errors.shape.timeline", { kind, status: res.status });
  }
  const items = res.data.map(adaptStatus);
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items,
    continuation,
    // Same rule as pagination.isEndOfFeed (no next link OR empty page);
    // a cross-origin next link still counts as a next link because its
    // cursors were carried over above.
    end: continuation === null || items.length === 0,
  };
}

/** `GET /api/v1/accounts/:id` → adapted account (contract §4). `:id` may
 * be a nickname on Akkoma; it is URL-encoded either way. */
export async function getAccount(
  client: MastoClient,
  id: string,
): Promise<Account> {
  const res = await client.get<WireAccount>(`/api/v1/accounts/${encodeURIComponent(id)}`);
  if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
    throw new FediError(`Account ${id} returned an unexpected response shape.`, "errors.shape.account", { id });
  }
  return adaptAccount(res.data);
}

function isAbsentEndpoint(err: unknown): boolean {
  // The backend's guarded client adapts MastoHttpError → ApiError BEFORE
  // endpoint code runs, so absence arrives as EITHER class (raw for
  // direct endpoint callers, adapted behind the backend). Both read the
  // same 404/405 rule — anything else rethrows, never falls back.
  const status =
    err instanceof MastoHttpError || err instanceof ApiError ? err.status : null;
  return status === 404 || status === 405;
}

/**
 * Handle → account with older-server fallbacks (contract §4 `lookup`).
 *
 * 1. `GET /api/v1/accounts/lookup?acct=` (exact, the modern path);
 * 2. on 404/405 ONLY (older servers without `lookup`): `GET
 *    /api/v1/accounts/search?q=&limit=5`, first EXACT `acct` match
 *    (case-insensitive — a near miss is never returned as the account);
 * 3. on 404/405 there too: `GET /api/v2/search` with `resolve=true`,
 *    same exact-match rule.
 *
 * Anything else (401/403 auth, timeout, 5xx) rethrows — a refused lookup
 * is never masked as "not found". No match anywhere reads 404 (the
 * profile renders unavailable, never a wrong account). `read:search` is
 * the scope the fallbacks need (already in `oauth.SCOPES_NOW`); a
 * strict server 403s there and the caller surfaces it honestly.
 */
export async function resolveAccountByHandle(
  client: MastoClient,
  acct: string,
): Promise<Account> {
  try {
    const res = await client.get<WireAccount>("/api/v1/accounts/lookup", { acct });
    if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
      throw new FediError(
        `No account found for ${acct}.`,
        "errors.shape.noAccountFound",
        { acct },
      );
    }
    return adaptAccount(res.data);
  } catch (err) {
    if (!isAbsentEndpoint(err)) throw err;
  }
  const exact = (a: WireAccount): boolean =>
    typeof a.acct === "string" && a.acct.toLowerCase() === acct.toLowerCase();
  try {
    const res = await client.get<WireAccount[]>("/api/v1/accounts/search", {
      q: acct,
      limit: 5,
    });
    const hit = Array.isArray(res.data) ? res.data.find(exact) : undefined;
    if (hit) return adaptAccount(hit);
  } catch (err) {
    if (!isAbsentEndpoint(err)) throw err;
  }
  try {
    const res = await client.get<{ accounts?: WireAccount[] }>("/api/v2/search", {
      q: acct,
      resolve: true,
      type: "accounts",
      limit: 5,
    });
    const hit = Array.isArray(res.data?.accounts) ? res.data.accounts.find(exact) : undefined;
    if (hit) return adaptAccount(hit);
  } catch (err) {
    if (!isAbsentEndpoint(err)) throw err;
  }
  // No match anywhere: 404 (the profile renders unavailable, never a
  // wrong account) — same status the direct /lookup path always read.
  throw new ApiError(
    `No account found for ${acct}.`,
    404,
    "errors.shape.noAccountFound",
    undefined,
    { acct },
  );
}

/** How a profile lookup failure reads on screen (phase3-handoff §2.6):
 * 404/410 → the profile is unavailable; 401/403 → sign in to see it;
 * anything else (timeout, network, 5xx) → a retryable error. Pure. */
export type AccountLookupFailure = "gone" | "auth" | "error";

export function accountLookupFailure(err: unknown): AccountLookupFailure {
  if (err instanceof MastoHttpError) {
    if (err.status === 404 || err.status === 410) return "gone";
    if (err.status === 401 || err.status === 403) return "auth";
  }
  return "error";
}

/**
 * `GET /api/v1/accounts/relationships?id[]=…` → one Relationship per
 * requested id, in server order (contract §4). Ids are echoed through
 * the repeated `id[]` array encoding — never interpolated into the path.
 */
export async function getRelationships(
  client: MastoClient,
  ids: string[],
): Promise<Relationship[]> {
  if (ids.length === 0) return [];
  const res = await client.get<WireRelationship[]>("/api/v1/accounts/relationships", {
    id: ids,
  });
  if (!Array.isArray(res.data)) {
    throw new FediError("Relationships returned an unexpected response shape.", "errors.shape.relationships");
  }
  return res.data.map(adaptRelationship);
}

/** Shared page-shape handling for every Status[]-returning GET (the
 * timeline/tag/statuses family): array validation + adapt + Link
 * continuation + contract §5 end rule. */
function statusPage(
  client: MastoClient,
  res: { data: unknown; status: number; headers: Headers },
): TimelinePage {
  if (!Array.isArray(res.data)) {
    throw new FediError(`Expected a status list (HTTP ${res.status}).`, "errors.shape.expectedList", { kind: "status", status: res.status });
  }
  const items = (res.data as Status[]).map(adaptStatus);
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items,
    continuation,
    end: continuation === null || items.length === 0,
  };
}

function pageQuery(opts: TimelinePageOptions): Record<string, QueryValue> {
  if (opts.continuation?.kind === "url") return {};
  const query: Record<string, QueryValue> = {};
  if (opts.continuation?.kind === "cursors") {
    Object.assign(query, withCursors({}, opts.continuation.cursors));
  } else {
    Object.assign(query, withCursors({}, { limit: opts.limit ?? PAGE_LIMIT }));
  }
  return query;
}

/**
 * `GET /api/v1/timelines/tag/:id` — the tag timeline both backends
 * serve (contract §4). Same paging/continuation rules as the main
 * timelines; `:id` is URL-encoded (tags may be non-ASCII).
 */
export async function fetchTagTimelinePage(
  client: MastoClient,
  tag: string,
  opts: TimelinePageOptions = {},
): Promise<TimelinePage> {
  const base = `/api/v1/timelines/tag/${encodeURIComponent(tag)}`;
  const path = opts.continuation?.kind === "url" ? opts.continuation.url : base;
  const res = await client.get<Status[]>(path, pageQuery(opts));
  return statusPage(client, res);
}

/**
 * `GET /api/v1/statuses/:id` → one adapted status (contract §4). 404/
 * 410 means deleted/inaccessible — callers render the honest
 * unavailable state, never a crash.
 */
export async function getStatus(
  client: MastoClient,
  id: string,
): Promise<Post> {
  const res = await client.get<Status>(`/api/v1/statuses/${encodeURIComponent(id)}`);
  if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
    throw new FediError(`Status ${id} returned an unexpected response shape.`, "errors.shape.status", { id });
  }
  return adaptStatus(res.data);
}

export interface StatusContext {
  /** Flat server order (contract §4: M caps 40/60/depth20 unauth vs
   * 4096 auth) — the tree is rebuilt client-side by `rebuildThread`. */
  ancestors: Post[];
  descendants: Post[];
}

/**
 * `GET /api/v1/statuses/:id/context` → the flat ancestor/descendant
 * lists (contract §4). A malformed body degrades to EMPTY lists (the
 * post still renders); a non-object body is an error.
 */
export async function getStatusContext(
  client: MastoClient,
  id: string,
): Promise<StatusContext> {
  const res = await client.get<{ ancestors?: Status[]; descendants?: Status[] }>(
    `/api/v1/statuses/${encodeURIComponent(id)}/context`,
  );
  const data = res.data;
  if (data === undefined || data === null || typeof data !== "object") {
    throw new FediError("Status context returned an unexpected response shape.", "errors.shape.statusContext");
  }
  return {
    ancestors: Array.isArray(data.ancestors) ? data.ancestors.map(adaptStatus) : [],
    descendants: Array.isArray(data.descendants) ? data.descendants.map(adaptStatus) : [],
  };
}

/** One `GET /api/v2/search` answer, adapted (contract §4). Both backends
 * serve it; Mastodon needs search-read auth for resolution, Akkoma may
 * answer 403 when instance search is restricted — callers surface that
 * honestly, never as "missing". Hashtags carry `{name,url}` only (no
 * history on Akkoma).
 *
 * Paging: the Link header decides, exactly like every other listing
 * (contract §5). Mastodon pages `/api/v2/search` by `offset` (+`limit`)
 * and only when `type` is set (the combined, type-less search pins
 * offset to 0 upstream), so paged calls always pass a type. `statuses`
 * additionally accept `max_id`/`min_id`; both directions are carried
 * over from the Link (`continuation`/`prev`) — never invented. A page
 * with no Link next is the end: no cursor is fabricated. */
export interface SearchResult {
  accounts: Account[];
  statuses: Post[];
  hashtags: Array<{ name: string; url: string }>;
  /** How to fetch the NEXT page (server URL on-origin, cursor carryover
   * off-origin), or null when the server offered no next link. */
  continuation: Continuation | null;
  /** How to fetch the PREVIOUS page, or null when the server offered no
   * prev link. Search v2 supports back-paging by `offset`. */
  prev: Continuation | null;
}

export type SearchV2Type = "accounts" | "hashtags" | "statuses";

export interface SearchV2Options {
  type?: SearchV2Type;
  limit?: number;
  /** Continue from a page's Link-derived plan (`SearchResult.continuation`
   * or `.prev`). `null`/undefined = fresh first page. */
  continuation?: Continuation | null;
  /** Explicit page number (v2 offset paging) for a fresh request. Ignored
   * when `continuation` replays the server's exact URL. */
  offset?: number;
  /** Statuses-only id cursors (older / newer) for a fresh request. */
  maxId?: string;
  minId?: string;
}

export async function searchV2(
  client: MastoClient,
  query: string,
  opts: SearchV2Options = {},
): Promise<SearchResult> {
  const trimmed = query.trim();
  const continuation = opts.continuation ?? null;
  if (trimmed.length === 0 && continuation === null) {
    return { accounts: [], statuses: [], hashtags: [], continuation: null, prev: null };
  }
  // Same request rules as every other Link-paged listing: a same-origin
  // server next/prev URL already carries every param (q, type, offset,
  // limit) — replay it verbatim; a cross-origin one only contributes its
  // cursor PARAMS, rebuilt on the session origin.
  const path = continuation?.kind === "url" ? continuation.url : "/api/v2/search";
  const params: Record<string, QueryValue> = {};
  if (continuation?.kind !== "url") {
    params.q = trimmed;
    if (opts.type) params.type = opts.type;
    if (continuation?.kind === "cursors") {
      Object.assign(params, withCursors({}, continuation.cursors));
    } else {
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.offset !== undefined) params.offset = opts.offset;
      if (opts.maxId !== undefined) params.max_id = opts.maxId;
      if (opts.minId !== undefined) params.min_id = opts.minId;
    }
  }
  const res = await client.get<{
    accounts?: WireAccount[];
    statuses?: Status[];
    hashtags?: Array<{ name?: string; url?: string }>;
  }>(path, params);
  const data = res.data ?? {};
  return {
    accounts: (data.accounts ?? []).map(adaptAccount),
    statuses: (data.statuses ?? []).map(adaptStatus),
    hashtags: (data.hashtags ?? [])
      .filter((t) => typeof t.name === "string" && t.name.length > 0)
      .map((t) => ({ name: t.name as string, url: typeof t.url === "string" ? t.url : "" })),
    continuation: nextContinuation(res.headers, client.origin),
    prev: prevContinuation(res.headers, client.origin),
  };
}

// --- Explore: trending + suggestions (contract §4 trends methods) ---------
//
// `trends/tags|statuses|links` are public on vanilla Mastodon. Akkoma
// answers the v1 alias with `[]` and has no v2 trends; Pleroma has neither
// — callers treat 404/empty as "not on this server", never an error.

/** Weekly-use sum over a trend history. Tolerant: Mastodon sends numeric
 * strings, other servers numbers — non-finite entries count as zero. Pure. */
export function historySum(
  history: Array<{ uses?: unknown; accounts?: unknown }> | null | undefined,
  key: "uses" | "accounts",
): number {
  if (!Array.isArray(history)) return 0;
  let total = 0;
  for (const entry of history) {
    const raw = (entry as Record<string, unknown>)[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export interface TrendingTagResult {
  name: string;
  uses: number;
  accounts: number;
}

/** `GET /api/v1/trends/tags` → weekly-use sums per tag (docs: public,
 * default 10, max 20). */
export async function fetchTrendingTags(
  client: MastoClient,
  limit = 10,
): Promise<TrendingTagResult[]> {
  const res = await client.get<
    Array<{ name?: string; history?: Array<{ uses?: unknown; accounts?: unknown }> }>
  >("/api/v1/trends/tags", { limit });
  if (!Array.isArray(res.data)) {
    throw new FediError("Trending tags returned an unexpected response shape.", "errors.shape.trendingTags", { status: res.status });
  }
  return res.data
    .filter((t) => typeof t.name === "string" && t.name.length > 0)
    .map((t) => ({
      name: t.name as string,
      uses: historySum(t.history, "uses"),
      accounts: historySum(t.history, "accounts"),
    }));
}

/** `GET /api/v1/trends/statuses` → one offset page of trending statuses
 * (docs: public, default 20, max 40). No Link headers — offset paging with
 * an empty page as the end. */
export async function fetchTrendingStatuses(
  client: MastoClient,
  limit = 20,
  offset = 0,
): Promise<{ items: Post[]; end: boolean }> {
  const res = await client.get<Status[]>("/api/v1/trends/statuses", { limit, offset });
  if (!Array.isArray(res.data)) {
    throw new FediError("Trending posts returned an unexpected response shape.", "errors.shape.trendingStatuses", { status: res.status });
  }
  const items = res.data.map(adaptStatus);
  return { items, end: items.length === 0 };
}

export interface TrendingLinkResult {
  url: string;
  title: string;
  description: string;
  providerName: string | null;
  image: string | null;
  uses: number;
  accounts: number;
}

/** `GET /api/v1/trends/links` → one offset page of trending links
 * (docs: public, default 10, max 20). Vanilla Mastodon ONLY — other
 * flavors 404 (or answer `[]`), which callers read as absent. */
export async function fetchTrendingLinks(
  client: MastoClient,
  limit = 10,
  offset = 0,
): Promise<{ items: TrendingLinkResult[]; end: boolean }> {
  const res = await client.get<
    Array<{
      url?: string;
      title?: string;
      description?: string;
      provider_name?: string | null;
      image?: string | null;
      history?: Array<{ uses?: unknown; accounts?: unknown }>;
    }>
  >("/api/v1/trends/links", { limit, offset });
  if (!Array.isArray(res.data)) {
    throw new FediError("Trending links returned an unexpected response shape.", "errors.shape.trendingLinks", { status: res.status });
  }
  const items = res.data
    .filter((l) => typeof l.url === "string" && l.url.length > 0)
    .map((l) => ({
      url: l.url as string,
      title: typeof l.title === "string" && l.title.length > 0 ? l.title : (l.url as string),
      description: typeof l.description === "string" ? l.description : "",
      providerName: typeof l.provider_name === "string" ? l.provider_name : null,
      image: typeof l.image === "string" ? l.image : null,
      uses: historySum(l.history, "uses"),
      accounts: historySum(l.history, "accounts"),
    }));
  return { items, end: items.length === 0 };
}

/** `GET /api/v2/suggestions` → follow suggestions (docs: auth-required).
 * Signed out (or a flavor without it) 401/403/404s — callers surface that
 * honestly, never as an empty suggestion list. */
export async function fetchSuggestions(
  client: MastoClient,
  limit = 10,
): Promise<Account[]> {
  const res = await client.get<Array<{ account?: WireAccount }>>("/api/v2/suggestions", {
    limit,
  });
  if (!Array.isArray(res.data)) {
    throw new FediError("Suggestions returned an unexpected response shape.", "errors.shape.suggestions", { status: res.status });
  }
  const out: Account[] = [];
  for (const row of res.data) {
    if (row && row.account && typeof row.account === "object" && "id" in row.account) {
      out.push(adaptAccount(row.account));
    }
  }
  return out;
}

/** A textual `RE:` target that did not resolve is retried after this long
 * (docs/quote-posts.md: never cache a transient 429/403 forever). */
const QUOTE_MISS_TTL_MS = 90_000;

interface QuoteLookup {
  promise: Promise<Post | null>;
  /** Epoch ms of a miss; null while in flight or after a hit. */
  missedAt: number | null;
}

const quoteLookups = new Map<string, QuoteLookup>();

/**
 * Resolve a textual `RE:` URL to the post it names (quote-posts.md: "must
 * resolve to a Note before rendering a full card"). `GET /api/v2/search` with
 * `resolve=true`, matched strictly by URI/URL (`pickQuotedStatus`). Every
 * failure — 401/403 (search restricted), 429, network, no exact match —
 * resolves to null, so the caller keeps the raw `RE:` text. Keyed per origin
 * and token, so one account's answer never serves another.
 */
export function resolveTextualQuote(client: MastoClient, uri: string): Promise<Post | null> {
  const key = `${client.origin}\n${client.token ?? ""}\n${uri}`;
  const cached = quoteLookups.get(key);
  if (cached && (cached.missedAt === null || Date.now() - cached.missedAt < QUOTE_MISS_TTL_MS)) {
    return cached.promise;
  }
  const entry: QuoteLookup = { promise: Promise.resolve(null), missedAt: null };
  entry.promise = searchQuotedStatus(client, uri).then((found) => {
    if (found === null) entry.missedAt = Date.now();
    return found;
  });
  quoteLookups.set(key, entry);
  return entry.promise;
}

async function searchQuotedStatus(client: MastoClient, uri: string): Promise<Post | null> {
  try {
    const res = await client.get<{ statuses?: Status[] }>("/api/v2/search", {
      q: uri,
      resolve: true,
      type: "statuses",
      limit: 1,
    });
    const statuses = Array.isArray(res.data?.statuses) ? res.data.statuses.map(adaptStatus) : [];
    return pickQuotedStatus(statuses, uri);
  } catch {
    return null;
  }
}

/** Profile tabs (phase3-handoff §2.6). Posts = top-level posts (no replies,
 * no boosts); All = replies and boosts too; Media = posts with attachments.
 * Featured is not offered: Mastodon's pinned-post list is a separate read
 * this slice does not port. */
export type ProfileStatusTab = "posts" | "all" | "media";

/** Explicit account-status filters (contract §4 params) — what the unified
 * `accountPosts` maps its core options onto. `pinned` is Akkoma-only. */
export interface StatusFilterOpts {
  exclude_replies?: boolean;
  exclude_reblogs?: boolean;
  only_media?: boolean;
  pinned?: boolean;
}

function profileStatusFilter(tab: ProfileStatusTab): Record<string, QueryValue> {
  switch (tab) {
    case "posts":
      return { exclude_replies: true, exclude_reblogs: true };
    case "all":
      return {};
    case "media":
      return { only_media: true };
  }
}

function resolveStatusFilters(
  tab: ProfileStatusTab | StatusFilterOpts,
): Record<string, QueryValue> {
  if (typeof tab === "string") return profileStatusFilter(tab);
  const query: Record<string, QueryValue> = {};
  if (tab.exclude_replies) query.exclude_replies = true;
  if (tab.exclude_reblogs) query.exclude_reblogs = true;
  if (tab.only_media) query.only_media = true;
  if (tab.pinned) query.pinned = true;
  return query;
}

/**
 * `GET /api/v1/accounts/:id/statuses` — one page of an account's posts for
 * one profile tab (contract §4). The tab's filter rides the FIRST page and
 * any cross-origin cursor carry-over; a same-origin next link already has
 * it baked in, so it is never appended twice.
 */
export async function fetchAccountStatusesPage(
  client: MastoClient,
  accountId: string,
  tab: ProfileStatusTab | StatusFilterOpts,
  opts: TimelinePageOptions = {},
): Promise<TimelinePage> {
  const base = `/api/v1/accounts/${encodeURIComponent(accountId)}/statuses`;
  const path = opts.continuation?.kind === "url" ? opts.continuation.url : base;
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url" ? {} : { ...resolveStatusFilters(tab) };
  Object.assign(query, pageQuery(opts));
  const res = await client.get<Status[]>(path, query);
  return statusPage(client, res);
}

/** Followers or following, the two Link-paged account lists (contract §4);
 * `mutes`/`blocks` are the same listing shape on `/api/v1/mutes` and
 * `/api/v1/blocks` (contract §4). */
export type AccountListKind = "followers" | "following" | "mutes" | "blocks";
export interface AccountPage {
  items: Account[];
  continuation: Continuation | null;
  /** Contract §5: no next link OR an empty page — never `length < limit`. */
  end: boolean;
}

/**
 * `GET /api/v1/accounts/:id/followers|following` (or `/api/v1/mutes` /
 * `/api/v1/blocks`) — one Link-paged page of accounts. A hidden list is
 * answered as an empty page by the server; a refused one as 401/403
 * (callers surface that honestly).
 */
export async function fetchAccountListPage(
  client: MastoClient,
  accountId: string,
  kind: AccountListKind,
  opts: TimelinePageOptions = {},
): Promise<AccountPage> {
  const base =
    kind === "mutes" || kind === "blocks"
      ? `/api/v1/${kind}`
      : `/api/v1/accounts/${encodeURIComponent(accountId)}/${kind}`;
  return accountListPage(client, base, opts);
}

/**
 * `GET /api/v1/follow_requests` — one Link-paged page of accounts waiting on
 * the signed-in user (read:follows). Accept/reject are writes and are not
 * wired here (Phase 4 gate).
 */
export async function fetchFollowRequestsPage(
  client: MastoClient,
  opts: TimelinePageOptions = {},
): Promise<AccountPage> {
  return accountListPage(client, "/api/v1/follow_requests", opts);
}

/**
 * `GET /api/v1/statuses/:id/reblogged_by` — one Link-paged page of the
 * accounts that boosted a status (the detail "Reposts" tab on this
 * family). Same listing shape and end rule as the account lists above.
 */
export async function fetchStatusAccountPage(
  client: MastoClient,
  statusId: string,
  rel: "reblogged_by" | "favourited_by",
  opts: TimelinePageOptions = {},
): Promise<AccountPage> {
  return accountListPage(
    client,
    `/api/v1/statuses/${encodeURIComponent(statusId)}/${rel}`,
    opts
  );
}

async function accountListPage(
  client: MastoClient,
  base: string,
  opts: TimelinePageOptions,
): Promise<AccountPage> {
  const path = opts.continuation?.kind === "url" ? opts.continuation.url : base;
  const res = await client.get<WireAccount[]>(path, pageQuery(opts));
  if (!Array.isArray(res.data)) {
    throw new FediError(`Expected a account list (HTTP ${res.status}).`, "errors.shape.expectedList", { kind: "account", status: res.status });
  }
  const items = res.data.map(adaptAccount);
  const continuation = nextContinuation(res.headers, client.origin);
  return { items, continuation, end: continuation === null || items.length === 0 };
}

// --- Status writes (Phase 3: the MastodonBackend's write surface) ----------
//
// One place per endpoint (the Misskey adapter's discipline); the backend
// adapts at its boundary. Bodies are built from core `PostDraft` in
// `compose.ts` / `backend.ts`, never here.

export async function deleteStatus(client: MastoClient, id: string): Promise<void> {
  await client.delete(`/api/v1/statuses/${encodeURIComponent(id)}`);
}

/** `PUT /api/v1/statuses/:id` (contract §4). The answer is the edited
 * status; an empty body is read back. */
export async function editStatus(
  client: MastoClient,
  id: string,
  body: StatusBody,
): Promise<Post> {
  const res = await client.put<Status>(`/api/v1/statuses/${encodeURIComponent(id)}`, body);
  if (res.data && typeof res.data === "object" && "id" in res.data) {
    return adaptStatus(res.data);
  }
  return getStatus(client, id);
}

/** `POST /api/v1/statuses/:id/pin|/unpin` (contract §4). The answer is the
 * status; an empty body is read back. */
export async function setStatusPinned(
  client: MastoClient,
  id: string,
  pinned: boolean,
): Promise<Post> {
  const verb = pinned ? "pin" : "unpin";
  const res = await client.post<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/${verb}`);
  if (res.data && typeof res.data === "object" && "id" in res.data) {
    return adaptStatus(res.data);
  }
  return getStatus(client, id);
}

/**
 * `POST /api/v1/polls/:id/votes` (contract §4). The endpoint takes the
 * POLL id, not the status id — the poll is read off the status first
 * (core `Poll` carries no id; nothing is guessed). `choices` are option
 * indices (the wire's integer array).
 */
export async function voteInPoll(
  client: MastoClient,
  statusId: string,
  choices: number[],
): Promise<void> {
  const res = await client.get<Status>(`/api/v1/statuses/${encodeURIComponent(statusId)}`);
  const pollId = res.data?.poll?.id;
  if (!pollId) {
    throw new FediError("This post has no poll to vote in.", "errors.shape.noPoll");
  }
  await client.post(`/api/v1/polls/${encodeURIComponent(pollId)}/votes`, { choices });
}

// --- Account actions (contract §4) ----------------------------------------

export async function setFollowing(
  client: MastoClient,
  id: string,
  following: boolean,
): Promise<void> {
  const verb = following ? "follow" : "unfollow";
  await client.post(`/api/v1/accounts/${encodeURIComponent(id)}/${verb}`);
}

/** `POST /api/v1/accounts/:id/mute` with the boost-only variant carried as
 * `showing_reblogs` via follow params — `mute` covers the account,
 * `muteBoosts` only hides its reposts (contract §4 `follow` params). */
export async function setMuted(
  client: MastoClient,
  id: string,
  muted: boolean,
): Promise<void> {
  const verb = muted ? "mute" : "unmute";
  await client.post(`/api/v1/accounts/${encodeURIComponent(id)}/${verb}`);
}

/** Boost-visibility toggle (the "mute boosts" control). Mastodon keeps it
 * on the relationship (`showing_reblogs`), updated through the follow
 * endpoint (contract §4 follow params `reblogs`). */
export async function setShowingReblogs(
  client: MastoClient,
  id: string,
  showing: boolean,
): Promise<void> {
  await client.post(`/api/v1/accounts/${encodeURIComponent(id)}/follow`, {
    reblogs: showing,
  });
}

export async function setBlocked(
  client: MastoClient,
  id: string,
  blocked: boolean,
): Promise<void> {
  const verb = blocked ? "block" : "unblock";
  await client.post(`/api/v1/accounts/${encodeURIComponent(id)}/${verb}`);
}

/** `POST /api/v1/statuses/:id/mute` — disable notifications for one
 * thread (the note-menu "mute thread" row). */
export async function muteStatusThread(client: MastoClient, id: string): Promise<void> {
  await client.post(`/api/v1/statuses/${encodeURIComponent(id)}/mute`);
}

/** `POST /api/v1/reports` (contract §4 family; the report flow the post
 * menu opens).
 *
 * Body is composed from the report CHOOSER (clickstone §1.5) and only
 * carries the fields the reporter actually chose — the handler permits
 * `account_id, comment, status_ids[], category, forward, rule_ids[]`
 * (`Api::V1::ReportsController#report_params`) and `ReportService` fills
 * every absent field with the same default we would otherwise send:
 * `comment: ""`, `status_ids: []`, `category: "other"`, no forwarding.
 * So omitting an unset field is never a behavior change, and sending
 * `[]`/`false` would only add noise.
 *
 * Server-side rule (verified in `ReportService#call`): when `rule_ids` is
 * present the category is FORCED to `violation` regardless of what was
 * sent. The body therefore carries `category: "violation"` alongside the
 * rule ids (never a contradictory value the server would silently
 * override); with no rule ids the reporter's category is sent as chosen.
 * `write:reports` (or the `write` umbrella) authorizes this call. */
export function buildReportBody(
  accountId: string,
  options: ReportOptions | string = {},
): Record<string, unknown> {
  const normalized = normalizeReportOptions(options);
  const body: Record<string, unknown> = { account_id: accountId };
  if (normalized.comment) body.comment = normalized.comment;
  if (normalized.statusIds?.length) body.status_ids = [...normalized.statusIds];
  if (normalized.ruleIds?.length) {
    body.rule_ids = [...normalized.ruleIds];
    body.category = "violation";
  } else if (normalized.category) {
    body.category = normalized.category;
  }
  if (normalized.forward === true) body.forward = true;
  return body;
}

export async function reportAccount(
  client: MastoClient,
  accountId: string,
  options: ReportOptions | string = {},
): Promise<ReportResult> {
  const normalized = normalizeReportOptions(options);
  const body = buildReportBody(accountId, normalized);
  await client.post("/api/v1/reports", body);
  return {
    comment: normalized.comment ?? "",
    statusIds: [...(normalized.statusIds ?? [])],
    category: (body.category as ReportCategory | undefined) ?? null,
    ruleIds: [...(normalized.ruleIds ?? [])],
    forward: body.forward === true,
    unsupported: [],
  };
}

/** `GET /api/v1/instance/rules` — the server's published rules, for the
 * report chooser (`Api::V1::Instances::RulesController`, unauthenticated
 * unless the server runs limited federation). There is no v2 equivalent
 * (`/api/v2/instance` embeds rules inside the instance body instead); the
 * dedicated v1 path is what Mastodon's own web client reads
 * (`actions/server.js`). Akkoma/Pleroma serve NO such endpoint — the 404
 * is the honest "no rule list" signal the caller renders as a reason. */
export async function fetchInstanceRules(client: MastoClient): Promise<InstanceRule[]> {
  const res = await client.get<unknown>("/api/v1/instance/rules");
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a rule list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "instanceRule", status: res.status },
    );
  }
  const rules: InstanceRule[] = [];
  for (const row of res.data) {
    if (!row || typeof row !== "object") continue;
    const rule = row as WireRule;
    const id = rule.id != null ? String(rule.id) : "";
    const text = typeof rule.text === "string" ? rule.text.trim() : "";
    if (id && text) rules.push({ id, text });
  }
  return rules;
}

/**
 * `GET /api/v1/scheduled_statuses` — one Link-paged page of the viewer's
 * scheduled posts (contract §4). Same continuation/end rules as every
 * other listing (contract §5). Rows carry `params` + `media_attachments`
 * where the server packs them (the backend adapts those into the
 * `ScheduledNote` draft preview); rows with neither still list honestly
 * with `post: null, draft: null`.
 */
export async function fetchScheduledStatusesPage(
  client: MastoClient,
  opts: TimelinePageOptions = {},
): Promise<ContinuationPage<WireScheduledStatus>> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/scheduled_statuses";
  const res = await client.get<WireScheduledStatus[]>(path, pageQuery(opts));
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a scheduled-status list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "scheduled", status: res.status },
    );
  }
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items: res.data,
    continuation,
    end: continuation === null || res.data.length === 0,
  };
}

// --- Follow requests (contract §4) ----------------------------------------

/** `POST /api/v1/follow_requests/:id/authorize|/reject` — the row id is
 * the ACCOUNT id (the wire list is accounts, not wrapper rows). */
export async function answerFollowRequest(
  client: MastoClient,
  accountId: string,
  accept: boolean,
): Promise<void> {
  const verb = accept ? "authorize" : "reject";
  await client.post(`/api/v1/follow_requests/${encodeURIComponent(accountId)}/${verb}`);
}

// --- Notifications (contract §4: v1 flat; v2 grouped is later) -------------

/** `GET /api/v1/notifications` — one flat page. `types`/`excludeTypes`
 * are WIRE type strings (already translated from the core filter tokens
 * by the backend); array params ride the repeated `types[]` encoding. */
export async function fetchNotificationsPage(
  client: MastoClient,
  opts: TimelinePageOptions & { types?: string[]; excludeTypes?: string[] } = {},
): Promise<ContinuationPage<WireNotification>> {
  const path = opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/notifications";
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url" ? {} : pageQuery(opts);
  if (opts.types && opts.types.length > 0 && opts.continuation?.kind !== "url") {
    query.types = opts.types;
  }
  if (opts.excludeTypes && opts.excludeTypes.length > 0 && opts.continuation?.kind !== "url") {
    query.exclude_types = opts.excludeTypes;
  }
  const res = await client.get<WireNotification[]>(path, query);
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a notification list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "notification", status: res.status },
    );
  }
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items: res.data,
    continuation,
    end: continuation === null || res.data.length === 0,
  };
}

/** One raw page of the grouped v2 notifications endpoint, plus the
 * accounts and statuses the adapter resolves grouped rows against.
 *
 * `GET /api/v2/notifications` accepts the same `types[]`/
 * `exclude_types[]` filters as v1 (verified in Mastodon 4.8's
 * `V2::NotificationsController#browserable_params`) and pages on the
 * same `max_id`/`since_id`/`min_id` Link scheme — hence the shared
 * continuation plumbing and the contract §5 end rule.
 *
 * Two envelopes are read: the expanded flat shape (`notifications` plus
 * a separate `accounts` array — rows name their actor via `account_id`)
 * and the real grouped shape (`notification_groups` plus separate
 * `accounts`/`statuses` arrays — groups name sampled actors via
 * `sample_account_ids` and their post via `status_id`). Anything else
 * (array bodies, empty objects) resolves `null` so the caller falls back
 * to flat v1 rows. A missing ENDPOINT (404/405) throws and is handled by
 * the caller.
 */
export interface V2NotificationRows {
  rows: Array<Record<string, unknown>>;
  accounts: Map<string, Record<string, unknown>>;
  statuses: Map<string, Record<string, unknown>>;
  continuation: Continuation | null;
  /** Contract §5: no next link OR an empty page — never `length < limit`. */
  end: boolean;
}

export async function fetchV2NotificationRows(
  client: MastoClient,
  opts: TimelinePageOptions & { types?: string[]; excludeTypes?: string[] } = {},
): Promise<V2NotificationRows | null> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v2/notifications";
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url" ? {} : pageQuery(opts);
  if (opts.continuation?.kind !== "url") {
    if (opts.types && opts.types.length > 0) query.types = opts.types;
    if (opts.excludeTypes && opts.excludeTypes.length > 0) {
      query.exclude_types = opts.excludeTypes;
    }
  }
  const res = await client.get<{
    accounts?: Array<Record<string, unknown>>;
    notifications?: Array<Record<string, unknown>>;
    notification_groups?: Array<Record<string, unknown>>;
    statuses?: Array<Record<string, unknown>>;
  }>(path, query);
  const data = (res.data ?? {}) as {
    accounts?: unknown;
    notifications?: unknown;
    notification_groups?: unknown;
    statuses?: unknown;
  };
  const rows = Array.isArray(data.notifications) ? data.notifications : null;
  const groups = Array.isArray(data.notification_groups) ? data.notification_groups : null;
  // Neither envelope: not a shape the adapter reads (array-bodied stubs
  // send a bare list). The caller falls back to v1 — never an error here.
  if (rows === null && groups === null) return null;
  const accounts = new Map<string, Record<string, unknown>>();
  if (Array.isArray(data.accounts)) {
    for (const a of data.accounts) {
      if (a && typeof a === "object" && typeof (a as { id?: unknown }).id !== "undefined") {
        accounts.set(String((a as { id: unknown }).id), a as Record<string, unknown>);
      }
    }
  }
  const statuses = new Map<string, Record<string, unknown>>();
  if (Array.isArray(data.statuses)) {
    for (const s of data.statuses) {
      if (s && typeof s === "object" && typeof (s as { id?: unknown }).id !== "undefined") {
        statuses.set(String((s as { id: unknown }).id), s as Record<string, unknown>);
      }
    }
  }
  const items = rows ?? groups ?? [];
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    rows: items,
    accounts,
    statuses,
    continuation,
    end: continuation === null || items.length === 0,
  };
}

/** `POST /api/v1/markers` — there is NO v1 mark-as-read endpoint on
 * either backend (contract §4); the notifications marker is the read
 * position. `lastReadId` is the newest notification id. */
export async function markNotificationsRead(
  client: MastoClient,
  lastReadId: string,
): Promise<void> {
  await client.post("/api/v1/markers", {
    notifications: { last_read_id: lastReadId },
  });
}

// --- Server services (contract §4) ----------------------------------------

export interface WireCustomEmoji {
  shortcode: string;
  url: string;
  static_url?: string;
  visible_in_picker?: boolean;
  category?: string | null;
}

/** `GET /api/v1/custom_emojis` (contract §4) — public, no auth. */
export async function fetchCustomEmojis(client: MastoClient): Promise<WireCustomEmoji[]> {
  const res = await client.get<WireCustomEmoji[]>("/api/v1/custom_emojis");
  return Array.isArray(res.data) ? res.data : [];
}

/** `GET /api/v1/media/:id` — the async-upload poll (contract §4: Mastodon
 * answers 202 while processing; `url` is null until done). */
export async function getMedia(
  client: MastoClient,
  id: string,
): Promise<MediaAttachment> {
  const res = await client.get<MediaAttachment>(`/api/v1/media/${encodeURIComponent(id)}`);
  if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
    throw new FediError("Media lookup returned an unexpected response shape.", "errors.shape.mediaLookup");
  }
  return res.data;
}

/** `POST /api/v1/statuses/:id/translate` (contract §4, §9 gating is the
 * caller's job). The response shape varies by server (Mastodon renders
 * status fields; older/other servers nest `translation`) — the adapter
 * reads both and never invents text. */
export async function translateStatus(
  client: MastoClient,
  id: string,
  targetLang: string,
): Promise<{ sourceLang: string | null; text: string | null; raw: unknown }> {
  const res = await client.post<Record<string, unknown>>(
    `/api/v1/statuses/${encodeURIComponent(id)}/translate`,
    { lang: targetLang },
  );
  const data = res.data ?? {};
  const sourceLang =
    typeof data.detected_source_language === "string" ? data.detected_source_language : null;
  const nested = data.translation as Record<string, unknown> | string | undefined;
  const htmlish =
    typeof data.content === "string"
      ? data.content
      : typeof nested === "string"
        ? nested
        : nested && typeof nested === "object" && typeof nested.content === "string"
          ? nested.content
          : null;
  return { sourceLang, text: htmlish, raw: data };
}
