// Incoming follow-request queue (§0 + §2). Misskey-family:
// `following/requests/list` → FollowRequest[]; accept/reject take
// `{userId}`. 404-gated: unsupported backends hide the route/nav entry.

import type { WireCall } from "./client";
import type { FollowRequest } from "./wire";

export async function listFollowRequests(
  call: WireCall,
): Promise<FollowRequest[]> {
  return call<FollowRequest[]>("following/requests/list", {});
}

export async function acceptFollowRequest(
  call: WireCall,
  userId: string,
): Promise<void> {
  await call<undefined>("following/requests/accept", { userId });
}

export async function rejectFollowRequest(
  call: WireCall,
  userId: string,
): Promise<void> {
  await call<undefined>("following/requests/reject", { userId });
}

export async function cancelFollowRequest(
  call: WireCall,
  userId: string,
): Promise<void> {
  await call<undefined>("following/requests/cancel", { userId });
}
