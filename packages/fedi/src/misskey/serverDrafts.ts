// Server drafts (§7). `notes/drafts/create|list|update|delete|count` mirror
// the `notes/create` body plus the draft id. The local store
// (`api/drafts.ts`) stays as the offline cache; the server is the source of
// truth once signed in. All calls 404-gate to local-only.

import type { ServerDraft, ServerDraftsApi } from "../core/backend";
import type { WireCall } from "./client";
import type { ServerDraft as WireServerDraft } from "./wire";
import { decodeCursor } from "./adapt";
import { createNoteBody } from "./noteBody";

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
  sinceId?: string,
): Promise<WireServerDraft[]> {
  return call<WireServerDraft[]>("notes/drafts/list", {
    limit,
    ...(untilId ? { untilId } : {}),
    ...(sinceId ? { sinceId } : {}),
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

function adaptServerDraft(raw: WireServerDraft): ServerDraft {
  return {
    id: raw.id,
    text: raw.text ?? null,
    cw: raw.cw ?? null,
    visibilityRaw: raw.visibility,
    visibleUserIds: raw.visibleUserIds,
    localOnly: raw.localOnly,
    mediaIds: raw.fileIds,
    replyId: raw.replyId ?? null,
    renoteId: raw.renoteId ?? null,
    scheduledAt: raw.scheduledAt ?? null,
    poll: raw.poll ?? undefined,
  };
}

export function createServerDraftsApi(call: WireCall): ServerDraftsApi {
  const DEFAULT_LIMIT = 20;
  return {
    async list(opts = {}) {
      const cursor = decodeCursor(opts.cursor ?? null);
      return (
        await listServerDrafts(
          call,
          opts.limit ?? DEFAULT_LIMIT,
          cursor.untilId,
          cursor.sinceId,
        )
      ).map(adaptServerDraft);
    },
    async create(draft) {
      return adaptServerDraft(
        await createServerDraft(
          call,
          {
            ...createNoteBody(draft),
            ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
          },
        ),
      );
    },
    async update(id, draft) {
      return adaptServerDraft(
        await updateServerDraft(
          call,
          id,
          {
            ...createNoteBody(draft),
            ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
          },
        ),
      );
    },
    async delete(id) {
      await deleteServerDraft(call, id);
    },
    async count() {
      return countServerDrafts(call);
    },
  };
}
