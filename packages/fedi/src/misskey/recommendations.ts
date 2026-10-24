// Fork recommendation endpoints (dvd-sharkey `notes/recommendations*`,
// `i/recommendation-interests`, `i/update {recommendationSettings}`).
//
// One place for the endpoint calls so the backend stays thin and the
// support probe is testable. Support follows the `like.ts` pattern: NO
// static flavor seed (a flavor label cannot prove a backport absent), one
// cached verdict per origin from a real 404/405.
//
// Auth: every endpoint here requires credentials (the transport already
// binds the session token). All failures except the absence probe rethrow
// untouched (best-effort only applies to `dwell`, which swallows at the
// call site).

import { ApiError } from "../core/errors";
import type {
  RecommendationDwellItem,
  RecommendationFeedOpts,
  RecommendationInterests,
  RecommendationSettingsPatch,
} from "../core/backend";
import type { Account, Cursor, Page, Post } from "../core/models";
import { adaptMe, adaptNote } from "./adapt";
import { isUnsupportedError, type WireCall } from "./client";
import { decodeRecCursor, encodeRecCursor } from "../core/recommendations";
import type { MeDetailed, Note } from "./wire";

export const RECOMMENDATIONS_PAGE_LIMIT = 10;
const DWELL_CHUNK = 50;

const supportCache = new Map<string, boolean>();

/** Endpoint presence by origin: true/false, or null when unprobed. */
export function recommendationsSupportFor(origin: string): boolean | null {
  return supportCache.has(origin) ? (supportCache.get(origin) as boolean) : null;
}

/** Test hook: drop the per-origin support cache. */
export function resetRecommendationsSupportCache(): void {
  supportCache.clear();
}

/** Test hook: seed the per-origin support verdict. */
export function setRecommendationsSupportFor(origin: string, supported: boolean): void {
  supportCache.set(origin, supported);
}

function markUnsupported(origin: string | null, err: unknown): boolean {
  if (
    err instanceof ApiError &&
    (isUnsupportedError(err) || err.code === "UNKNOWN_API_ENDPOINT")
  ) {
    if (origin) supportCache.set(origin, false);
    return true;
  }
  return false;
}

type WireNoteWithFactors = Note & {
  _recommendationFactors_?: unknown;
};

function isBreakdown(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    (rec["type"] === "following" || rec["type"] === "score") &&
    typeof rec["score"] === "number" &&
    typeof rec["subtotal"] === "number" &&
    Array.isArray(rec["rows"])
  );
}

/**
 * Fetch one recommendation page. `cursor` is the opaque offset cursor
 * (null = first page); `opts.offset` wins when set explicitly (tests).
 * Throws the typed unsupported `ApiError` where the fork endpoints are
 * absent — the caller renders the honest unavailable state.
 */
export async function fetchRecommendationPage(
  call: WireCall,
  origin: string | null,
  cursor: Cursor | null,
  opts: RecommendationFeedOpts = {},
): Promise<Page<Post>> {
  const limit = opts.limit ?? RECOMMENDATIONS_PAGE_LIMIT;
  const offset = opts.offset ?? decodeRecCursor(cursor);
  const params: Record<string, unknown> = {
    limit,
    offset,
    ...(opts.refresh ? { refresh: true } : {}),
    ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
    ...(opts.withSensitive !== undefined ? { withSensitive: opts.withSensitive } : {}),
    ...(opts.withRenotes !== undefined ? { withRenotes: opts.withRenotes } : {}),
  };
  let notes: WireNoteWithFactors[];
  try {
    notes = await call<WireNoteWithFactors[]>("notes/recommendations", params);
  } catch (err) {
    if (markUnsupported(origin, err)) throw err;
    throw err;
  }
  if (origin) supportCache.set(origin, true);
  const items = (notes ?? []).map((wire) => {
    const post = adaptNote(wire);
    const factors = wire._recommendationFactors_;
    if (isBreakdown(factors)) {
      return {
        ...post,
        ext: {
          ...post.ext,
          recommendation: factors as import("../core/recommendations").RecommendationBreakdown,
        },
      };
    }
    return post;
  });
  const next = offset + items.length;
  return {
    items,
    cursor: items.length < limit ? null : encodeRecCursor(next),
    end: items.length < limit,
  };
}

/**
 * Probe endpoint presence without consuming the feed: one `limit: 1`
 * fetch. True on any 2xx (even empty), false on 404/405/unknown-endpoint,
 * rethrows anything else. Cached per origin.
 */
export async function probeRecommendations(
  call: WireCall,
  origin: string | null,
): Promise<boolean> {
  if (origin && supportCache.has(origin)) return supportCache.get(origin) as boolean;
  try {
    await call<WireNoteWithFactors[]>("notes/recommendations", { limit: 1, offset: 0 });
  } catch (err) {
    if (markUnsupported(origin, err)) return false;
    throw err;
  }
  if (origin) supportCache.set(origin, true);
  return true;
}

/** Best-effort dwell report, chunked to 50/call. Absence caches false; other errors swallow. */
export async function reportRecommendationDwell(
  call: WireCall,
  origin: string | null,
  items: RecommendationDwellItem[],
): Promise<void> {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += DWELL_CHUNK) {
    const chunk = items.slice(i, i + DWELL_CHUNK);
    try {
      await call<unknown>("notes/recommendations/dwell", { items: chunk });
    } catch (err) {
      if (markUnsupported(origin, err)) return;
      // Best-effort: swallow anything else (offline, 500).
      return;
    }
  }
  if (origin) supportCache.set(origin, true);
}

export async function markRecommendationNotInterested(
  call: WireCall,
  origin: string | null,
  noteId: string,
): Promise<void> {
  try {
    await call<unknown>("notes/recommendations/not-interested", { noteId });
  } catch (err) {
    if (markUnsupported(origin, err)) throw err;
    throw err;
  }
  if (origin) supportCache.set(origin, true);
}

export async function fetchRecommendationInterests(
  call: WireCall,
  origin: string | null,
): Promise<RecommendationInterests> {
  try {
    const res = await call<{ interested?: unknown; disinterested?: unknown }>(
      "i/recommendation-interests",
      {},
    );
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    if (origin) supportCache.set(origin, true);
    return { interested: pick(res?.interested), disinterested: pick(res?.disinterested) };
  } catch (err) {
    if (markUnsupported(origin, err)) throw err;
    throw err;
  }
}

export async function updateRecommendationSettings(
  call: WireCall,
  origin: string | null,
  patch: RecommendationSettingsPatch,
): Promise<Account> {
  try {
    const me = await call<MeDetailed>("i/update", { recommendationSettings: { ...patch } });
    if (origin) supportCache.set(origin, true);
    return adaptMe(me);
  } catch (err) {
    if (markUnsupported(origin, err)) throw err;
    throw err;
  }
}

/** pageOf-compatible note list adapter (tests): keeps `_recommendationFactors_` transient. */
export function adaptRecommendationNotes(wires: WireNoteWithFactors[]): Post[] {
  return wires.map((wire) => {
    const post = adaptNote(wire);
    const factors = wire._recommendationFactors_;
    if (isBreakdown(factors)) {
      return {
        ...post,
        ext: {
          ...post.ext,
          recommendation: factors as import("../core/recommendations").RecommendationBreakdown,
        },
      };
    }
    return post;
  });
}
