// Incoming follow-request queue (§0 + §2). Misskey-family:
// `following/requests/list` → FollowRequest[]; accept/reject take
// `{userId}`. 404-gated: unsupported backends hide the route/nav entry.

import { apiCall } from "./client";
import type { FollowRequest } from "./types";

export async function listFollowRequests(): Promise<FollowRequest[]> {
  return apiCall<FollowRequest[]>("following/requests/list", {});
}

export async function acceptFollowRequest(userId: string): Promise<void> {
  await apiCall<undefined>("following/requests/accept", { userId });
}

export async function rejectFollowRequest(userId: string): Promise<void> {
  await apiCall<undefined>("following/requests/reject", { userId });
}
