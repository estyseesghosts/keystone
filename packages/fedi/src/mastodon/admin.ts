// Read-only server insight (Wave 3 slice 3.1 — NO mutations in this module).
//
// Two halves, matching clickstone §3.1:
// - measures/dimensions (`POST /api/v1/admin/measures|dimensions`,
//   `admin:read` + a staff role): the admin dashboard numbers. A 403
//   surfaces as the typed permission error — the caller disables the
//   section with a reason, never clears the session. A 404 is the honest
//   unsupported state (Akkoma/Pleroma serve no `/api/v1/admin/*`).
// - public fallbacks (`GET /api/v1/instance/peers|extended_description|
//   activity`): no scope needed, the only thing a non-staff viewer — or a
//   fork without the admin routes — ever sees. (Rules already live on
//   `Backend.instanceRules`.)
//
// Every failure runs through the `toApiError` boundary (the backend's
// guarded client adapts transport errors the same way, so this is
// idempotent there and real for direct callers). Nothing here touches a
// session: a 403 is data ("not allowed"), never a credential problem.

import type { Account } from "../core/models";
import type {
  AdminDimension,
  AdminDimensionRow,
  AdminMeasure,
  InstanceActivityWeek,
  InstanceExtendedDescription,
} from "../core/backend";
import type {
  AdminDimension as WireAdminDimension,
  AdminMeasure as WireAdminMeasure,
  InstanceActivityWeek as WireActivityWeek,
  InstanceExtendedDescription as WireExtendedDescription,
} from "./wire";
import { toApiError, type MastoClient } from "./client";

/** Measure keys the insight screen requests (upstream
 * `Admin::Metrics::Measure::MEASURES` — requesting an unknown key answers
 * nothing for it, so only verified keys are listed). */
export const ADMIN_INSIGHT_MEASURE_KEYS: readonly string[] = [
  "active_users",
  "new_users",
  "instance_accounts",
  "instance_statuses",
  "opened_reports",
  "resolved_reports",
];

/** Dimension keys the insight screen requests (upstream
 * `app/lib/admin/metrics/dimension/*` — same verified-only rule). */
export const ADMIN_INSIGHT_DIMENSION_KEYS: readonly string[] = ["sources"];

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Server-stringified numbers stay strings (never parsed into floats the
 * UI would reformat into a lie); a missing total reads "" — the
 * serializer always sends one, so this is unreachable-but-safe. */
function numToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function adaptMeasure(row: WireAdminMeasure): AdminMeasure {
  const raw = Array.isArray(row.data) ? row.data : [];
  return {
    key: typeof row.key === "string" ? row.key : "",
    unit: strOrNull(row.unit),
    total: numToString(row.total),
    humanValue: strOrNull(row.human_value),
    previousTotal: row.previous_total == null ? null : numToString(row.previous_total),
    data: raw
      .filter((p): p is NonNullable<typeof p> => !!p && typeof p === "object")
      .map((p) => ({
        date: strOrNull(p.date),
        value: numToString(p.value),
      })),
  };
}

function adaptDimension(row: WireAdminDimension): AdminDimension {
  const raw = Array.isArray(row.data) ? row.data : [];
  const rows: AdminDimensionRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof entry.key === "string" ? entry.key : "";
    if (!key) continue;
    rows.push({
      key,
      label: strOrNull(entry.human_key),
      value: numToString(entry.value),
    });
  }
  return { key: typeof row.key === "string" ? row.key : "", rows };
}

/**
 * `POST /api/v1/admin/measures {keys}` — admin:read + a staff role.
 * 403 = the token/role may not read admin metrics (typed permission
 * error); 404 = no such routes here (honest unsupported).
 */
export async function fetchAdminMeasures(
  client: MastoClient,
  keys: readonly string[],
): Promise<AdminMeasure[]> {
  try {
    const res = await client.post<unknown>("/api/v1/admin/measures", { keys: [...keys] });
    const items = Array.isArray(res.data) ? res.data : [];
    return items
      .filter((r): r is WireAdminMeasure => !!r && typeof r === "object")
      .map(adaptMeasure);
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * `POST /api/v1/admin/dimensions {keys}` — same auth/absence contract as
 * measures.
 */
export async function fetchAdminDimensions(
  client: MastoClient,
  keys: readonly string[],
): Promise<AdminDimension[]> {
  try {
    const res = await client.post<unknown>("/api/v1/admin/dimensions", { keys: [...keys] });
    const items = Array.isArray(res.data) ? res.data : [];
    return items
      .filter((r): r is WireAdminDimension => !!r && typeof r === "object")
      .map(adaptDimension);
  } catch (err) {
    throw toApiError(err);
  }
}

/** `GET /api/v1/instance/peers` — public; the peered domains. A 404 (the
 * admin disabled the endpoint, or limited federation mode) reads as the
 * honest unsupported state, never an empty-list lie. */
export async function fetchInstancePeers(client: MastoClient): Promise<string[]> {
  try {
    const res = await client.get<unknown>("/api/v1/instance/peers");
    const items = Array.isArray(res.data) ? res.data : [];
    return items.filter(
      (d): d is string => typeof d === "string" && d.length > 0,
    );
  } catch (err) {
    throw toApiError(err);
  }
}

/** `GET /api/v1/instance/extended_description` — public. `content` is the
 * server-rendered Markdown HTML (the domain model keeps it as source for
 * the one allow-listed AST, never raw markup). */
export async function fetchInstanceExtendedDescription(
  client: MastoClient,
): Promise<InstanceExtendedDescription> {
  try {
    const res = await client.get<WireExtendedDescription | null>(
      "/api/v1/instance/extended_description",
    );
    const body = res.data ?? {};
    return {
      updatedAt: strOrNull(body.updated_at),
      html: typeof body.content === "string" ? body.content : "",
    };
  } catch (err) {
    throw toApiError(err);
  }
}

/** `GET /api/v1/instance/activity` — public weekly counters. */
export async function fetchInstanceActivity(
  client: MastoClient,
): Promise<InstanceActivityWeek[]> {
  try {
    const res = await client.get<unknown>("/api/v1/instance/activity");
    const items = Array.isArray(res.data) ? res.data : [];
    const out: InstanceActivityWeek[] = [];
    for (const row of items) {
      if (!row || typeof row !== "object") continue;
      const week = (row as WireActivityWeek).week;
      if (typeof week !== "string" || !week) continue;
      const r = row as Record<string, unknown>;
      const count = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;
      out.push({
        week,
        statuses: count(r.statuses),
        logins: count(r.logins),
        registrations: count(r.registrations),
      });
    }
    return out;
  } catch (err) {
    throw toApiError(err);
  }
}

/** The viewer's staff role, from verify_credentials at the backend/session
 * layer — Mastodon packs `role` ("admin"/"moderator"/"user"), Akkoma and
 * Pleroma pack `pleroma.is_admin`/`is_moderator` (both carried verbatim on
 * `account.ext.mastodon` by the adapter). Null (signed out, or a server
 * that reported no role) is never guessed into a role. */
export function adminRoleOf(account: Account | null): "admin" | "moderator" | null {
  const bag = account?.ext?.mastodon;
  if (!bag || typeof bag !== "object") return null;
  const record = bag as Record<string, unknown>;
  if (record.role === "admin") return "admin";
  if (record.role === "moderator") return "moderator";
  const pleroma = record.pleroma;
  if (pleroma && typeof pleroma === "object") {
    const flags = pleroma as Record<string, unknown>;
    if (flags.is_admin === true) return "admin";
    if (flags.is_moderator === true) return "moderator";
  }
  return null;
}
