// Server drafts (§7). `notes/drafts/create|list|update|delete|count` mirror
// the `notes/create` body plus the draft id. The local store
// (`api/drafts.ts`) stays as the offline cache; the server is the source of
// truth once signed in. All calls 404-gate to local-only.

import { apiCall } from "./client";
import type { CreateNoteParams, ServerDraft } from "./types";

export interface ServerDraftParams extends CreateNoteParams {
  scheduledAt?: string | null;
}

export async function createServerDraft(params: ServerDraftParams): Promise<ServerDraft> {
  return apiCall<ServerDraft>("notes/drafts/create", { ...params });
}

export async function listServerDrafts(limit = 20, untilId?: string): Promise<ServerDraft[]> {
  return apiCall<ServerDraft[]>("notes/drafts/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function updateServerDraft(draftId: string, params: ServerDraftParams): Promise<ServerDraft> {
  return apiCall<ServerDraft>("notes/drafts/update", { draftId, ...params });
}

export async function deleteServerDraft(draftId: string): Promise<void> {
  await apiCall<undefined>("notes/drafts/delete", { draftId });
}

export async function countServerDrafts(): Promise<number> {
  const res = await apiCall<{ count: number }>("notes/drafts/count", {});
  return typeof res.count === "number" ? res.count : 0;
}
