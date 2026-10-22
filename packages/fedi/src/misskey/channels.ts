// Channels (Misskey-family): server-run group timelines. A channel is a
// `Channel` row packed by `ChannelEntityService`; when the caller is signed
// in the pack also carries the viewer's `isFollowing`/`isFavorited`.
//
// Endpoints (verified against the local Misskey backend
// `server/api/endpoints/channels/*.ts`, 2026-10-22):
//   channels/search    query/type/limit/sinceId/untilId  (public, paged)
//   channels/show      channelId                         (public)
//   channels/timeline  channelId/limit/sinceId/untilId   (public, paged)
//   channels/followed  limit/sinceId/untilId             (auth, read:channels)
//   channels/follow    channelId                         (auth, write:channels)
//   channels/unfollow  channelId                         (auth, write:channels)
//
// There is no `channels/list`: the directory the official client renders is
// `channels/search` with an empty query (the server skips the LIKE filter
// when `query === ''`), which is also the paged one — `channels/featured`
// is a fixed top-10 with no cursor. Using search keeps both directions of
// paging exact.

import type { Channel } from "../core/backend";
import type { WireCall } from "./client";

/** Packed `Channel` as the API answers it. Fields we do not surface stay
 * off the domain model. */
export interface PackedChannel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  bannerUrl?: unknown;
  isFollowing?: unknown;
  isArchived?: unknown;
  usersCount?: unknown;
  notesCount?: unknown;
}

/** Adapt one packed channel. Missing strings become empty/absent values,
 * never placeholder text; `isFollowing` stays `null` when the server did
 * not report it (signed out) so the UI can tell "known off" from "unknown". */
export function adaptChannel(raw: PackedChannel): Channel {
  const out: Channel = {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
  };
  if (typeof raw.description === "string" || raw.description === null) {
    out.description = raw.description;
  }
  if (typeof raw.bannerUrl === "string" || raw.bannerUrl === null) {
    out.bannerUrl = raw.bannerUrl;
  }
  if (typeof raw.isFollowing === "boolean") out.isFollowing = raw.isFollowing;
  else if (raw.isFollowing === null) out.isFollowing = null;
  if (typeof raw.isArchived === "boolean") out.isArchived = raw.isArchived;
  if (typeof raw.usersCount === "number") out.usersCount = raw.usersCount;
  if (typeof raw.notesCount === "number") out.notesCount = raw.notesCount;
  return out;
}

export async function searchChannels(
  call: WireCall,
  params: Record<string, unknown>,
): Promise<PackedChannel[]> {
  return (await call<PackedChannel[]>("channels/search", params)) ?? [];
}

export async function showChannel(
  call: WireCall,
  channelId: string,
): Promise<Channel> {
  return adaptChannel(await call<PackedChannel>("channels/show", { channelId }));
}

export async function listFollowedChannels(
  call: WireCall,
  params: Record<string, unknown>,
): Promise<PackedChannel[]> {
  return (await call<PackedChannel[]>("channels/followed", params)) ?? [];
}

export async function followChannel(
  call: WireCall,
  channelId: string,
): Promise<void> {
  await call<undefined>("channels/follow", { channelId });
}

export async function unfollowChannel(
  call: WireCall,
  channelId: string,
): Promise<void> {
  await call<undefined>("channels/unfollow", { channelId });
}
