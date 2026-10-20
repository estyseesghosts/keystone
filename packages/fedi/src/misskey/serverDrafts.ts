// Server drafts (§7). `notes/drafts/create|list|update|delete|count` mirror
// the `notes/create` body plus the draft id. The local store
// (`api/drafts.ts`) stays as the offline cache; the server is the source of
// truth once signed in. All calls 404-gate to local-only.

import type { WireCall } from "./client";
import type { ServerDraft as WireServerDraft } from "./wire";

/** Wire body + optional `scheduledAt` — the backend builds the body. */
export type ServerDraftParams = Record<string, unknown> & { scheduledAt?: string | null };

export async function createServerDraft(
  call: WireCall,
  params: ServerDraftParams,
): Promise<WireServerDraft> {
  return call<WireServerDraft>("notes/drafts/create", { ...params });
}

export async function listServerDrafts(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<WireServerDraft[]> {
  return call<WireServerDraft[]>("notes/drafts/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function updateServerDraft(
  call: WireCall,
  draftId: string,
  params: ServerDraftParams,
): Promise<WireServerDraft> {
  return call<WireServerDraft>("notes/drafts/update", { draftId, ...params });
}

export async function deleteServerDraft(
  call: WireCall,
  draftId: string,
): Promise<void> {
  await call<undefined>("notes/drafts/delete", { draftId });
}

export async function countServerDrafts(call: WireCall): Promise<number> {
  const res = await call<{ count: number }>("notes/drafts/count", {});
  return typeof res.count === "number" ? res.count : 0;
}
