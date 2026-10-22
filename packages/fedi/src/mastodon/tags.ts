// Hashtag curation (clickstone §1.4), Mastodon family: tag state, follow/
// unfollow, followed-tag listing, and profile "featured" tags.
//
// Endpoint contract (verified against the Mastodon checkout; paths are in
// the session log, not here):
// - `GET  /api/v1/tags/:id`              → Tag (following/featuring when authed)
// - `POST /api/v1/tags/:id/follow`       → Tag
// - `POST /api/v1/tags/:id/unfollow`     → Tag
// - `POST /api/v1/tags/:id/feature`      → Tag   (newer Mastodon)
// - `POST /api/v1/tags/:id/unfeature`    → Tag   (newer Mastodon)
// - `GET  /api/v1/followed_tags`         → Tag[] (Link-paged)
// - `GET  /api/v1/featured_tags`         → FeaturedTag[]
// - `POST /api/v1/featured_tags`         → FeaturedTag   (`{name}`)
// - `DELETE /api/v1/featured_tags/:id`   → 200/204
//
// Tokens: `write:follows` follows a tag (the same scope account-follows
// use); `write:accounts` features it.
//
// Fork reality: Akkoma serves show/follow/unfollow/followed_tags but has
// NO tag `feature`/`unfeature` and no `/featured_tags` at all, so the
// backend leaves those methods undefined for that flavor. `show` also
// 404s for a tag the fork has never indexed (vanilla Mastodon synthesizes
// an empty Tag instead) — the caller reads that as "state unknown", never
// as a crash.
//
// There is NO tag-mute endpoint on either server. Nothing here invents
// one.

import { ApiError, FediError } from "../core/errors";
import type { QueryValue } from "./client";
import type { MastoClient } from "./client";
import type { Continuation } from "./pagination";
import { nextContinuation, withCursors } from "./pagination";
import type { FeaturedTag as WireFeaturedTag, Tag as WireTag } from "./wire";
import type { FeaturedTag, TagInfo } from "../core/backend";

/** Server-side cap on both tag listings (`TagsController`/`FeaturedTags`
 * defaults sit well below it; 80 keeps pages small but not chatty). */
const TAGS_PAGE_LIMIT = 80;

export interface TagPageOptions {
  limit?: number;
  continuation?: Continuation | null;
}

export interface TagPage<T> {
  items: T[];
  continuation: Continuation | null;
  /** Contract §5: no next link OR an empty page — never a length guess. */
  end: boolean;
}

/** 404/405 only: "this server has no such endpoint" (contract §3). Every
 * other failure — auth, rate limit, network — is a real error and is never
 * papered over as absence. */
function isAbsentEndpoint(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

function tagPath(name: string, action?: string): string {
  const base = `/api/v1/tags/${encodeURIComponent(name)}`;
  return action ? `${base}/${action}` : base;
}

/** Wire Tag → core `TagInfo`. Booleans the server did not report stay
 * null (unknown), never coerced to false. */
export function adaptTagInfo(raw: WireTag | null | undefined): TagInfo {
  const row = (raw ?? {}) as WireTag;
  const name = typeof row.name === "string" ? row.name.replace(/^#+/, "") : "";
  return {
    name,
    url: typeof row.url === "string" && row.url.length > 0 ? row.url : null,
    following: typeof row.following === "boolean" ? row.following : null,
    featuring: typeof row.featuring === "boolean" ? row.featuring : null,
  };
}

/** Wire FeaturedTag → core `FeaturedTag`. `statuses_count` is a numeric
 * STRING on Mastodon; non-finite/absent becomes null (never NaN). */
export function adaptFeaturedTag(raw: WireFeaturedTag): FeaturedTag {
  const count =
    typeof raw.statuses_count === "number"
      ? raw.statuses_count
      : typeof raw.statuses_count === "string"
        ? Number(raw.statuses_count)
        : NaN;
  return {
    id: String(raw.id ?? ""),
    name: typeof raw.name === "string" ? raw.name.replace(/^#+/, "") : "",
    statusesCount: Number.isFinite(count) ? count : null,
    lastStatusAt: typeof raw.last_status_at === "string" ? raw.last_status_at : null,
  };
}

/** `GET /api/v1/tags/:id`. A malformed body is an error (shape), a 404 is
 * the caller's "unknown state" signal. */
export async function getTag(client: MastoClient, name: string): Promise<TagInfo> {
  const res = await client.get<WireTag>(tagPath(name));
  if (!res.data || typeof res.data !== "object" || typeof res.data.name !== "string") {
    throw new FediError(
      `Tag ${name} returned an unexpected response shape.`,
      "errors.shape.tag",
      { name },
    );
  }
  return adaptTagInfo(res.data);
}

/** `POST /api/v1/tags/:id/follow` — the answer is the tag; the caller
 * re-reads state from it (or refreshes) rather than assuming. */
export async function followTag(client: MastoClient, name: string): Promise<void> {
  await client.post(tagPath(name, "follow"));
}

export async function unfollowTag(client: MastoClient, name: string): Promise<void> {
  await client.post(tagPath(name, "unfollow"));
}

/** Page query for the two tag listings: a same-origin next URL is followed
 * verbatim, a cross-origin one contributes only its cursor params. */
function tagPageQuery(opts: TagPageOptions): Record<string, QueryValue> {
  if (opts.continuation?.kind === "url") return {};
  if (opts.continuation?.kind === "cursors") {
    return withCursors({}, opts.continuation.cursors);
  }
  return { limit: opts.limit ?? TAGS_PAGE_LIMIT };
}

async function tagListPage(
  client: MastoClient,
  path: string,
  opts: TagPageOptions,
): Promise<TagPage<TagInfo>> {
  const url = opts.continuation?.kind === "url" ? opts.continuation.url : path;
  const res = await client.get<WireTag[]>(url, tagPageQuery(opts));
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a tag list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "tag", status: res.status },
    );
  }
  const items = res.data.map(adaptTagInfo);
  const continuation = nextContinuation(res.headers, client.origin);
  return {
    items,
    continuation,
    end: continuation === null || items.length === 0,
  };
}

/** `GET /api/v1/followed_tags` — the viewer's followed tags. */
export function fetchFollowedTagsPage(
  client: MastoClient,
  opts: TagPageOptions = {},
): Promise<TagPage<TagInfo>> {
  return tagListPage(client, "/api/v1/followed_tags", opts);
}

/** `GET /api/v1/featured_tags` — the profile-pinned tags (vanilla
 * Mastodon only). A non-array body is a shape error, never an empty list
 * pretending the account has no featured tags. */
export async function fetchFeaturedTags(client: MastoClient): Promise<FeaturedTag[]> {
  const res = await client.get<WireFeaturedTag[]>("/api/v1/featured_tags");
  if (!Array.isArray(res.data)) {
    throw new FediError(
      `Expected a featured-tag list (HTTP ${res.status}).`,
      "errors.shape.expectedList",
      { kind: "featuredTag", status: res.status },
    );
  }
  return res.data.map(adaptFeaturedTag);
}

/**
 * Feature a tag on the profile. Newer Mastodon has the tag-scoped action
 * (`POST /api/v1/tags/:id/feature`); older releases only have
 * `POST /api/v1/featured_tags` with `{name}`. The fallback runs on 404/405
 * ONLY (a refused feature is never retried through another endpoint).
 */
export async function featureTag(client: MastoClient, name: string): Promise<void> {
  try {
    await client.post(tagPath(name, "feature"));
    return;
  } catch (err) {
    if (!isAbsentEndpoint(err)) throw err;
  }
  await client.post("/api/v1/featured_tags", { name });
}

/**
 * Unfeature a tag. Same version split: `POST /api/v1/tags/:id/unfeature`
 * on newer Mastodon; on 404/405 the row is looked up by name in
 * `GET /api/v1/featured_tags` and removed by its id. A tag that is not in
 * that list is already unfeatured — the server's own remove-service
 * no-ops there, and so do we (never a silent success on a write that the
 * server refused).
 */
export async function unfeatureTag(client: MastoClient, name: string): Promise<void> {
  try {
    await client.post(tagPath(name, "unfeature"));
    return;
  } catch (err) {
    if (!isAbsentEndpoint(err)) throw err;
  }
  const rows = await fetchFeaturedTags(client);
  const wanted = name.replace(/^#+/, "").toLowerCase();
  const hit = rows.find((row) => row.name.toLowerCase() === wanted);
  if (!hit) return;
  await client.delete(`/api/v1/featured_tags/${encodeURIComponent(hit.id)}`);
}

/** `DELETE /api/v1/featured_tags/:id` — the row-id form (what a listing
 * screen would use). */
export async function deleteFeaturedTag(client: MastoClient, id: string): Promise<void> {
  await client.delete(`/api/v1/featured_tags/${encodeURIComponent(id)}`);
}
