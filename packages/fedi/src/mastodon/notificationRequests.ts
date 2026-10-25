// Filtered notification requests + filter policy (Mastodon 4.3+,
// repair X4.5; audit `results/mastodon.md` finding 12).
//
// Mastodon 4.3+ files notifications from filtered accounts under
// "requests" instead of the main list; without support every filtered
// item stays in the main list, so nothing ever silently vanishes.
//
// Endpoints (all auth-required, same origin/token as every other call):
// - `GET /api/v1/notifications/requests` — Link-paged request rows.
// - `POST /api/v1/notifications/requests/:id/accept` — merge one request
//   into the main notifications.
// - `POST /api/v1/notifications/requests/:id/dismiss` — drop one request.
// - `GET /api/v2/notifications/policy` — the four filter switches plus
//   the pending counters the entry badge reads.
// - `PATCH /api/v2/notifications/policy` — save switches (only defined
//   fields are sent, never a guessed switch).
//
// Support is PROBED, never flavor-guessed: no flavor row seeds the
// `notification_requests` capability, so it reads "unknown" until a real
// call caches a per-origin verdict (the `misskey/like.ts` pattern — a
// flavor label cannot prove a backport absent or present). Only absence
// (404/405 via the shared `isAbsent`, either error class) caches false;
// auth, timeout and 5xx rethrow and cache nothing. One 404 per origin
// per launch at most.
//
// Error contract: these functions throw the RAW `MastoHttpError` — the
// backend's guarded client adapts it to the shared `ApiError` at the
// boundary (same rule as `endpoints.ts`). Direct callers (tests, scripts)
// must adapt before probing support.

import { FediError } from "../core/errors";
import type {
  NotificationPolicy as DomainPolicy,
  NotificationPolicyPatch,
  NotificationRequest as DomainRequest,
  NotificationRequestsApi,
  PageOpts,
  SignalOpts,
} from "../core/backend";
import type { Page } from "../core/models";
import { adaptAccount, decodeContinuation, encodeContinuation, isAccountRow, noteSkippedRow } from "./adapt";
import type { MastoClient, QueryValue } from "./client";
import { isAbsent } from "./endpoints";
import { nextContinuation, withCursors } from "./pagination";
import type { Continuation } from "./pagination";
import type {
  NotificationPolicy as WirePolicy,
  NotificationRequest as WireRequest,
} from "./wire";

const REQUESTS_LIMIT = 20;

// --- Support probe cache (per origin, `like.ts` pattern) --------------------

const supportCache = new Map<string, boolean>();

/** Endpoint presence by origin: true/false, or null when unprobed. */
export function notificationRequestsSupportFor(origin: string): boolean | null {
  return supportCache.has(origin) ? (supportCache.get(origin) as boolean) : null;
}

/** Test hook: drop the per-origin support cache. */
export function resetNotificationRequestsSupportCache(): void {
  supportCache.clear();
}

/** Test hook: seed the per-origin support verdict. */
export function setNotificationRequestsSupportFor(origin: string, supported: boolean): void {
  supportCache.set(origin, supported);
}

/** Cache a probed absence (404/405 only); anything else is not a verdict. */
function markUnsupported(origin: string | null, err: unknown): boolean {
  if (isAbsent(err)) {
    if (origin) supportCache.set(origin, false);
    return true;
  }
  return false;
}

function markSupported(origin: string | null): void {
  if (origin) supportCache.set(origin, true);
}

// --- Adaptation (tolerant: fork drift degrades, never throws the page) ------

/**
 * One request row → domain. Rows without a string id are unlistable and
 * read null (the caller skips and counts them, finding-17 discipline);
 * an unpacked/unusable account reads null, never an invented profile; a
 * missing timestamp reads null, never "now".
 */
export function adaptNotificationRequest(row: unknown): DomainRequest | null {
  if (typeof row !== "object" || row === null) return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  return {
    id: rec.id,
    createdAt: typeof rec.created_at === "string" ? rec.created_at : null,
    account: isAccountRow(rec.account) ? adaptAccount(rec.account) : null,
  };
}

function boolOf(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function countOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Policy body → domain. Absent switches/counters read null (the UI
 * disables those rows with a reason and `updatePolicy` never sends them
 * back). A non-object body is a malformed answer, not an empty policy.
 */
export function adaptNotificationPolicy(body: unknown): DomainPolicy {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new FediError(
      "The notification policy returned an unexpected response shape.",
      "errors.shape.notificationPolicy",
    );
  }
  const rec = body as Record<string, unknown>;
  const summary =
    rec.summary && typeof rec.summary === "object" && !Array.isArray(rec.summary)
      ? (rec.summary as Record<string, unknown>)
      : null;
  return {
    filterNotFollowing: boolOf(rec.filter_not_following),
    filterNotFollowers: boolOf(rec.filter_not_followers),
    filterNewAccounts: boolOf(rec.filter_new_accounts),
    filterPrivateMentions: boolOf(rec.filter_private_mentions),
    pendingRequestsCount: summary ? countOf(summary.pending_requests_count) : null,
    pendingNotificationsCount: summary ? countOf(summary.pending_notifications_count) : null,
  };
}

// --- Endpoints ----------------------------------------------------------------

/**
 * `GET /api/v1/notifications/requests` — one Link-paged inbox page.
 * First/refresh pages send `{limit}`; older pages replay the server's
 * exact next URL on-origin (cursor carryover off-origin). `end` follows
 * contract §5: no next link OR an empty page — never `length < limit`.
 */
export async function fetchNotificationRequestsPage(
  client: MastoClient,
  opts: { limit?: number; continuation?: Continuation | null; signal?: AbortSignal } = {},
): Promise<{ items: DomainRequest[]; continuation: Continuation | null; end: boolean }> {
  const path =
    opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/notifications/requests";
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url"
      ? {}
      : opts.continuation?.kind === "cursors"
        ? withCursors({}, opts.continuation.cursors)
        : { limit: opts.limit ?? REQUESTS_LIMIT };
  try {
    const res = await client.get<WireRequest[]>(path, query, { signal: opts.signal });
    if (!Array.isArray(res.data)) {
      throw new FediError(
        `Notification requests returned an unexpected response shape (HTTP ${res.status}).`,
        "errors.shape.notificationRequests",
        { status: res.status },
      );
    }
    const items: DomainRequest[] = [];
    for (const row of res.data) {
      const adapted = adaptNotificationRequest(row);
      if (!adapted) {
        noteSkippedRow("notification-requests");
        continue;
      }
      items.push(adapted);
    }
    const continuation = nextContinuation(res.headers, client.origin);
    markSupported(client.origin);
    return {
      items,
      continuation,
      end: continuation === null || items.length === 0,
    };
  } catch (err) {
    markUnsupported(client.origin, err);
    throw err;
  }
}

/** `POST /api/v1/notifications/requests/:id/accept` — the id is opaque. */
export async function acceptNotificationRequest(client: MastoClient, id: string): Promise<void> {
  try {
    await client.post(`/api/v1/notifications/requests/${encodeURIComponent(id)}/accept`);
  } catch (err) {
    markUnsupported(client.origin, err);
    throw err;
  }
  markSupported(client.origin);
}

/** `POST /api/v1/notifications/requests/:id/dismiss` — the id is opaque. */
export async function dismissNotificationRequest(client: MastoClient, id: string): Promise<void> {
  try {
    await client.post(`/api/v1/notifications/requests/${encodeURIComponent(id)}/dismiss`);
  } catch (err) {
    markUnsupported(client.origin, err);
    throw err;
  }
  markSupported(client.origin);
}

/** `GET /api/v2/notifications/policy` — the switches + badge counters. */
export async function fetchNotificationPolicy(
  client: MastoClient,
  opts: { signal?: AbortSignal } = {},
): Promise<DomainPolicy> {
  try {
    const res = await client.get<WirePolicy>("/api/v2/notifications/policy", undefined, {
      signal: opts.signal,
    });
    markSupported(client.origin);
    return adaptNotificationPolicy(res.data);
  } catch (err) {
    markUnsupported(client.origin, err);
    throw err;
  }
}

/**
 * `PATCH /api/v2/notifications/policy` — only defined patch fields are
 * sent (a null/unknown switch is never written back as false). Answers
 * the server's stored policy.
 */
export async function updateNotificationPolicy(
  client: MastoClient,
  patch: NotificationPolicyPatch,
): Promise<DomainPolicy> {
  const body: Record<string, boolean> = {};
  if (patch.filterNotFollowing !== undefined) body.filter_not_following = patch.filterNotFollowing;
  if (patch.filterNotFollowers !== undefined) body.filter_not_followers = patch.filterNotFollowers;
  if (patch.filterNewAccounts !== undefined) body.filter_new_accounts = patch.filterNewAccounts;
  if (patch.filterPrivateMentions !== undefined)
    body.filter_private_mentions = patch.filterPrivateMentions;
  try {
    const res = await client.patch<WirePolicy>("/api/v2/notifications/policy", body);
    markSupported(client.origin);
    return adaptNotificationPolicy(res.data);
  } catch (err) {
    markUnsupported(client.origin, err);
    throw err;
  }
}

/**
 * Probe endpoint presence without consuming the inbox: one `limit: 1`
 * fetch. True on any 2xx (even empty), false on 404/405, rethrows
 * anything else. Cached per origin.
 */
export async function probeNotificationRequests(client: MastoClient): Promise<boolean> {
  const origin = client.origin;
  if (origin && supportCache.has(origin)) return supportCache.get(origin) as boolean;
  try {
    await client.get<WireRequest[]>("/api/v1/notifications/requests", { limit: 1 });
  } catch (err) {
    if (markUnsupported(origin, err)) return false;
    throw err;
  }
  markSupported(origin);
  return true;
}

// --- Backend member ------------------------------------------------------------
//
// Present on every Mastodon-family flavor (the member exists so the UI can
// probe); a server without the 4.3+ routes 404s and the UI hides the entry
// with a reason. Support is probed lazily by the first list/policy/probe
// call and cached — never a static flavor seed.

/** Continuation plumbing for the inbox list (opaque core `Cursor` outside). */
function continuationOf(cursor: PageOpts["cursor"]): Continuation | null {
  return decodeContinuation(cursor ?? null);
}

export function createNotificationRequestsApi(client: MastoClient): NotificationRequestsApi {
  const origin = client.origin;
  return {
    async list(opts: PageOpts = {}): Promise<Page<DomainRequest>> {
      const page = await fetchNotificationRequestsPage(client, {
        limit: opts.limit,
        continuation: continuationOf(opts.cursor),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return {
        items: page.items,
        cursor: encodeContinuation(page.continuation),
        end: page.end,
      };
    },
    accept(id: string): Promise<void> {
      return acceptNotificationRequest(client, id);
    },
    dismiss(id: string): Promise<void> {
      return dismissNotificationRequest(client, id);
    },
    policy(opts: SignalOpts = {}): Promise<DomainPolicy> {
      return fetchNotificationPolicy(client, opts);
    },
    updatePolicy(patch: NotificationPolicyPatch): Promise<DomainPolicy> {
      return updateNotificationPolicy(client, patch);
    },
    isSupported(): boolean | null {
      return origin ? notificationRequestsSupportFor(origin) : null;
    },
  };
}
