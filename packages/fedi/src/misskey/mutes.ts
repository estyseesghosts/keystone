// Block / mute / renote-mute list helpers + relation lookups (§0 groundwork).
// Every surface reuses these; callers 404-gate (unsupported backend hides
// the control, never an inert button). All wrappers take an explicit `WireCall` —
// no local state, no optimism: state re-derives from `users/relation` or
// `users/show` after every write.
//
// List-shape note (M1): `blocking/list`, `mute/list` and `renote-mute/list`
// answer WRAPPER rows (`{id, ..., blockee | mutee}`), not bare users — the
// same shape `users/followers` (`follower`) and `users/following`
// (`followee`) use. Every lister below unwraps its key, skips rows without
// a string-id user (deleted/gone accounts — never adapted from the wrapper
// row itself, which has no username), and pages on the ROW id (`untilId`
// pages on the row, so `pageOf` runs on rows and the map happens after). A
// row that already looks like a bare user (`username` + `id`, no wrapper
// key) is adapted as-is so a fork returning bare users keeps working.

import type { WireCall } from "./client";
import { adaptAccount, adaptUserRelation, pageOf } from "./adapt";
import type { UserDetailed, UserRelation } from "./wire";
import type { Account, Page, Relationship } from "../core/models";

export async function fetchRelations(call: WireCall, userIds: string[]): Promise<Relationship[]> {
  if (userIds.length === 0) return [];
  const rels = await call<UserRelation[]>("users/relation", { userId: userIds });
  return (rels ?? []).map(adaptUserRelation);
}

export async function fetchRelation(call: WireCall, userId: string): Promise<Relationship | null> {
  const list = await fetchRelations(call, [userId]);
  return list.find((r) => r.id === userId) ?? null;
}

export async function blockUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("blocking/create", { userId });
}

export async function unblockUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("blocking/delete", { userId });
}

export async function muteUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("mute/create", { userId });
}

export async function unmuteUser(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("mute/delete", { userId });
}

export async function muteRenotes(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("renote-mute/create", { userId });
}

export async function unmuteRenotes(call: WireCall, userId: string): Promise<void> {
  await call<undefined>("renote-mute/delete", { userId });
}

/** Wrapper key per account-list endpoint. */
export type AccountListWrapperKey = "follower" | "followee" | "mutee" | "blockee";

function isStringIdUser(value: unknown): value is UserDetailed {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/**
 * Unwrap one account-list row to its packed user (tolerant M1 helper).
 * Wrapper rows (`{id, follower}` etc.) unwrap to the inner user; rows that
 * already look like bare users (`username` + `id`, no wrapper key) pass
 * through for fork-compat. Anything else (null inner, missing/non-string
 * id, non-object rows) returns null so the caller skips it — the wrapper
 * row itself is never adapted (it has no username).
 */
export function unwrapAccountRow(
  row: unknown,
  key: AccountListWrapperKey,
): UserDetailed | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const inner = rec[key];
  if (isStringIdUser(inner)) return inner;
  if (
    typeof rec.username === "string" &&
    typeof rec.id === "string" &&
    !(key in rec)
  ) {
    return rec as unknown as UserDetailed;
  }
  return null;
}

/**
 * Page wrapper rows into core Accounts. `pageOf` runs on the ROWS (the
 * `untilId` cursor is the row id), the map to accounts happens after, and
 * malformed rows are dropped before either.
 */
export function pageOfAccountRows(
  rows: unknown[] | null | undefined,
  limit: number,
  key: AccountListWrapperKey,
): Page<Account> {
  const valid = (rows ?? []).filter((row): row is Record<string, unknown> => {
    return unwrapAccountRow(row, key) !== null;
  });
  return pageOf(valid, limit, (row) => {
    return adaptAccount(unwrapAccountRow(row, key) as UserDetailed);
  });
}

export async function listBlocks(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<Page<Account>> {
  const rows = await call<unknown[]>("blocking/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return pageOfAccountRows(rows, limit, "blockee");
}

export async function listMutes(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<Page<Account>> {
  const rows = await call<unknown[]>("mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return pageOfAccountRows(rows, limit, "mutee");
}

export async function listRenoteMutes(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<Page<Account>> {
  const rows = await call<unknown[]>("renote-mute/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
  return pageOfAccountRows(rows, limit, "mutee");
}
