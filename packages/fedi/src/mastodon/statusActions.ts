// Favourite and repost (reblog) toggles on the Mastodon transport (contract
// §4: `POST /api/v1/statuses/:id/favourite|unfavourite` and `reblog|unreblog`,
// both write:favourites / write:statuses). The pure parts (target path,
// optimistic patch) are exported for the offline smoke. The write reconciles
// to the server: its response is the new state. An empty or 204 body is
// reconciled by reading the original status back.
//
// Phase 3: typed over `core/models` (Post). The viewer's favourite state is
// `post.favourite.mine`, the boost state `post.ext.reblogged` (both
// auth-only; absent reads false exactly as the Keystodon model documented).
// Favourites are NEVER merged into `post.reactions` (keystodon.md §1.5).

import { adaptStatus } from "./adapt";
import type { MastoClient } from "./client";
import { FALLBACK_CHAR_LIMIT } from "./compose";
import { FediError } from "../core/errors";
import type { StatusBody } from "./compose";
import { getStatus } from "./endpoints";
import { fetchInstanceCapabilities } from "./instance";
import type { Post, ReactionEntry } from "../core/models";
import type { Status } from "./wire";

export type StatusToggle = "favourite" | "reblog";

/** The write path for a toggle. `on` picks the verb: `favourite` or
 * `unfavourite`, `reblog` or `unreblog`. `statusId` is the status being
 * acted on, which is the displayed original, never a boost wrapper. */
export function toggleEndpoint(toggle: StatusToggle, on: boolean, statusId: string): string {
  const verb = on ? toggle : `un${toggle}`;
  return `/api/v1/statuses/${encodeURIComponent(statusId)}/${verb}`;
}

/** The state a click asks for: the opposite of what is shown now. */
export function toggleIsOn(status: Post, toggle: StatusToggle): boolean {
  return toggle === "favourite"
    ? !(status.favourite?.mine ?? false)
    : !(status.ext.reblogged ?? false);
}

/** Optimistic patch for a displayed post: the flag and its count move
 * together, and a count never goes below zero. Returns a new object. */
export function optimisticToggle(status: Post, toggle: StatusToggle): Post {
  const on = toggleIsOn(status, toggle);
  const delta = on ? 1 : -1;
  if (toggle === "favourite") {
    const count = Math.max(0, (status.favourite?.count ?? status.counts.favourites) + delta);
    return {
      ...status,
      favourite: { count, mine: on },
      counts: { ...status.counts, favourites: count },
    };
  }
  return {
    ...status,
    ext: { ...status.ext, reblogged: on },
    counts: { ...status.counts, boosts: Math.max(0, status.counts.boosts + delta) },
  };
}

/** Send one toggle and return the server's state. A reblog answers with the
 * wrapper (the original sits in `.reblog` → core `renote`); callers display
 * `appearNoteOf` of the result, which covers both shapes. */
export async function setStatusToggle(
  client: MastoClient,
  statusId: string,
  toggle: StatusToggle,
  on: boolean,
): Promise<Post> {
  const res = await client.post<Status>(toggleEndpoint(toggle, on, statusId));
  if (res.data && typeof res.data === "object" && "id" in res.data) {
    return adaptStatus(res.data);
  }
  return getStatus(client, statusId);
}

/** Akkoma/Pleroma emoji reaction write (contract §9): `PUT` adds and `DELETE`
 * removes the caller's reaction on one status. The emoji is a path segment,
 * URL-encoded. Extension only: vanilla Mastodon never offers these controls. */
export function reactionEndpoint(statusId: string, emoji: string): string {
  return `/api/v1/pleroma/statuses/${encodeURIComponent(statusId)}/reactions/${encodeURIComponent(emoji)}`;
}

/** Optimistic reaction patch for a displayed post. The count moves with the
 * caller's flag, a count that reaches zero drops the key (as the server does),
 * and a no-op (already in the wanted state) returns the input. Pleroma allows
 * several reactions per account, so this adds/removes ONE key (unlike the
 * Misskey family's single-reaction `withReaction`). */
export function optimisticReaction(status: Post, emoji: string, on: boolean): Post {
  const summary = status.reactions;
  if (!summary) return status;
  if (summary.myReactions.includes(emoji) === on) return status;
  const entries: ReactionEntry[] = summary.entries.map((e) => ({ ...e }));
  const idx = entries.findIndex((e) => e.key === emoji);
  if (idx >= 0) {
    const next = Math.max(0, entries[idx].count + (on ? 1 : -1));
    if (next === 0) entries.splice(idx, 1);
    else entries[idx] = { ...entries[idx], count: next, mine: on || entries[idx].mine };
  } else if (on) {
    entries.push({ key: emoji, count: 1, mine: true, url: summary.urls[emoji] ?? null });
  }
  const myReactions = on
    ? [...summary.myReactions, emoji]
    : summary.myReactions.filter((e) => e !== emoji);
  return {
    ...status,
    reactions: {
      ...summary,
      entries,
      total: entries.reduce((sum, e) => sum + e.count, 0),
      mine: myReactions[0] ?? null,
      myReactions,
    },
  };
}

/** Add (`on`) or remove the caller's reaction. The answer is the status, so the
 * server's reaction list is the new state; an empty answer is read back. */
export async function setEmojiReaction(
  client: MastoClient,
  statusId: string,
  emoji: string,
  on: boolean,
): Promise<Post> {
  const path = reactionEndpoint(statusId, emoji);
  const res = on ? await client.put<Status>(path) : await client.delete<Status>(path);
  if (res.data && typeof res.data === "object" && "id" in res.data) {
    return adaptStatus(res.data);
  }
  return getStatus(client, statusId);
}

/** What the composer needs from the instance before it sends anything. */
export interface WriteCapabilities {
  maxChars: number;
  /** True only when the instance advertises quote posting (Akkoma
   * `quote_posting`). Vanilla Mastodon reports unknown here, so quotes stay
   * hidden there: a `quoted_status_id` is never sent blind. */
  quote: boolean;
}

const NO_WRITE_CAPS: WriteCapabilities = { maxChars: FALLBACK_CHAR_LIMIT, quote: false };
const capCache = new Map<string, Promise<WriteCapabilities>>();

/** Per-origin capabilities, fetched once. A failed fetch falls back to the
 * conservative answer (no quotes, default limit) and is not cached, so the next
 * call tries again. */
export function writeCapabilities(origin: string): Promise<WriteCapabilities> {
  const hit = capCache.get(origin);
  if (hit) return hit;
  const pending = fetchInstanceCapabilities(origin).then(
    (caps) => ({
      maxChars: caps.maxStatusCharacters ?? FALLBACK_CHAR_LIMIT,
      quote: caps.features.quote_posting === "supported",
    }),
    () => {
      capCache.delete(origin);
      return NO_WRITE_CAPS;
    },
  );
  capCache.set(origin, pending);
  return pending;
}

/** Create a status (`POST /api/v1/statuses`, JSON body, one Idempotency-Key per
 * logical attempt). The server's answer is the created status; a body with no
 * status in it is a failure, not a success. */
export async function createStatus(
  client: MastoClient,
  body: StatusBody,
  idempotencyKey: string,
): Promise<Post> {
  const res = await client.post<Status>("/api/v1/statuses", body, { idempotencyKey });
  if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
    throw new FediError(
      "The server did not return the created post.",
      "errors.shape.createdPost",
    );
  }
  return adaptStatus(res.data);
}
