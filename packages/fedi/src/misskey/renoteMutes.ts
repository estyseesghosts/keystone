// Renote-mute listing (C18-data), Misskey family. `renote-mute/list`
// answers packed RenoteMuting rows ({id, createdAt, muteeId, mutee}) —
// NOT bare users — so each row unwraps to its `mutee`. Rows without a
// string-id `mutee` (deleted/gone accounts) are skipped, never adapted
// from the muting row itself (it has no username). Paging is the
// standard `untilId` cursor via `pageOf` (the row id is the muting id,
// which is what `renote-mute/list` pages on).

import type { WireCall } from "./client";
import { adaptAccount, pageOf } from "./adapt";
import type { UserDetailed } from "./wire";
import type { Account, Page } from "../core/models";

interface RenoteMutingRow {
  id: string;
  mutee?: UserDetailed | null;
}

export async function listRenoteMutes(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<Page<Account>> {
  const rows = await call<RenoteMutingRow[]>("renote-mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  const valid = (rows ?? []).filter((row) => {
    const mutee = row?.mutee as { id?: unknown } | null | undefined;
    return !!mutee && typeof mutee.id === "string";
  });
  return pageOf(valid, limit, (row) =>
    adaptAccount(row.mutee as UserDetailed),
  );
}
