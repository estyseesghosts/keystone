// Mastodon-family list helpers (clickstone §1.6).
//
// Extracted verbatim from `backend.ts` (D3.3 decomposition —
// behavior-preserving move, no semantic change). `backend.ts` owns the
// `Backend.lists` method table; this module owns the policy whitelist,
// the wire-row adaptation, and the capability-gated create/update body.

import type { ListFields, ListRepliesPolicy, ListSummary } from "../core/backend";
import type { Capabilities } from "../core/detect";
import type { ListRow } from "./wire";

const LIST_REPLIES_POLICIES: readonly ListRepliesPolicy[] = ["none", "followed", "list"];

/** The three policy values are the `List` enum (`list`, `followed`,
 * `none`); anything else the server sends is not guessed at. */
export function knownRepliesPolicy(value: unknown): ListRepliesPolicy | undefined {
  return typeof value === "string" && (LIST_REPLIES_POLICIES as readonly string[]).includes(value)
    ? (value as ListRepliesPolicy)
    : undefined;
}

/** `ListRow` → core `ListSummary`. `title` is the name; the extras ride
 * only when the server reported a known value (the Misskey-backed and
 * Akkoma rows carry no policy at all). */
export function adaptListRow(row: ListRow, fallbackName?: string): ListSummary {
  const out: ListSummary = {
    id: row.id,
    name: typeof row.title === "string" ? row.title : (fallbackName ?? ""),
  };
  const policy = knownRepliesPolicy(row.replies_policy);
  if (policy !== undefined) out.repliesPolicy = policy;
  if (typeof row.exclusive === "boolean") out.exclusive = row.exclusive;
  return out;
}

/** Create/update body: `title` always, then each optional field ONLY when
 * the caller chose it and the server reports the capability as
 * `supported`. Unknown and unsupported both omit the field — a server that
 * rejects unknown params (Sharkey 400s; Akkoma's CastAndValidate) never
 * sees one. */
export function listFieldsBody(
  fields: ListFields,
  capabilities: Capabilities,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const policy = knownRepliesPolicy(fields.repliesPolicy);
  if (policy !== undefined && capabilities.lists_replies_policy === "supported") {
    out.replies_policy = policy;
  }
  if (typeof fields.exclusive === "boolean" && capabilities.lists_exclusive === "supported") {
    out.exclusive = fields.exclusive;
  }
  return out;
}
