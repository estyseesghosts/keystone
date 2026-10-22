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
  QueuedReport,
  ReportCategory,
  ReportRecategorizePatch,
  ReportResolveOpts,
  ReportsQueueListOpts,
} from "../core/backend";
import { REPORT_CATEGORIES } from "../core/backend";
import { FediError } from "../core/errors";
import type {
  AdminDimension as WireAdminDimension,
  AdminMeasure as WireAdminMeasure,
  AdminReport as WireAdminReport,
  InstanceActivityWeek as WireActivityWeek,
  InstanceExtendedDescription as WireExtendedDescription,
  Account as WireAccount,
} from "./wire";
import { toApiError, type MastoClient, type QueryValue } from "./client";
import { adaptAccount } from "./adapt";
import { nextContinuation, withCursors, type Continuation } from "./pagination";

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

// --- Reports queue (Wave 3 slice 3.2 — list + confirm-gated mutations) -------
//
// Endpoints (verified in the local Mastodon checkout — `api/v1/admin`
// namespace, not prose):
//   GET    /api/v1/admin/reports            Link-paged queue
//          (`FILTER_PARAMS`: resolved/unresolved/account_id/
//          target_account_id; `insert_pagination_headers`)
//   GET    /api/v1/admin/reports/:id        one row
//   PATCH  /api/v1/admin/reports/:id        `{category, rule_ids[]}` ONLY
//          (`report_params` permits nothing else)
//   POST   /api/v1/admin/reports/:id/assign_to_self|unassign|reopen|resolve
//
// Auth: index/show need `admin:read` (or granular `admin:read:reports`);
// every mutation needs `admin:write` (or `admin:write:reports`) —
// `authorize_if_got_token!` in `reports_controller.rb`, so the move of
// `admin:write` into `SCOPES_NOW` ships with this surface. A 403 is the
// typed permission error (the caller disables the section with a reason,
// never clears the session); a 404 is the honest unsupported state
// (Akkoma/Pleroma serve no `/api/v1/admin/*`).
//
// Deliberately ABSENT (no such API routes — verified in `routes/api.rb`):
// report notes (create/list) and the report history (`report.history` /
// `report.notes` are web-admin-only; the API serializer carries only the
// action outcome). This layer exposes no notes/history methods — the
// queue rows carry the action state, never faked entries.
//
// Error contract like the rest of this module: every failure runs through
// the `toApiError` boundary (idempotent under the backend's guarded
// client, real for direct callers).

const REPORTS_PAGE_LIMIT = 20;

/** One queue page: the adapted rows plus the Link continuation (contract
 * §5 — a missing next link OR an empty page ends the feed). */
export interface AdminReportsPage {
  items: QueuedReport[];
  continuation: Continuation | null;
  end: boolean;
}

export interface AdminReportsPageOptions {
  state?: ReportsQueueListOpts["state"];
  accountId?: string;
  targetAccountId?: string;
  limit?: number;
  continuation?: Continuation | null;
}

/** The admin wrapper nests the plain account under `account`
 * (`REST::Admin::ReportSerializer` `has_one :account`,
 * `Admin::AccountSerializer`). Prefer the nested row; fall back to the
 * wrapper itself when a fork packs the plain account directly. Anything
 * else (null, a bare id) reads null — never a fabricated account. */
function adminNestedAccount(value: unknown): WireAccount | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const nested = (rec as { account?: unknown }).account;
  const candidate = nested && typeof nested === "object" ? nested : value;
  const row = candidate as Record<string, unknown>;
  if (typeof row.id === "undefined" || typeof row.acct !== "string") return null;
  return candidate as WireAccount;
}

function knownReportCategory(value: unknown): ReportCategory | null {
  return typeof value === "string" &&
    (REPORT_CATEGORIES as readonly string[]).includes(value)
    ? (value as ReportCategory)
    : null;
}

/** `REST::Admin::ReportSerializer` → core `QueuedReport`. Statuses and
 * rules contribute only their ids (the `status_ids` / `rule_ids` the
 * queue displays); the action outcome (`action_taken*`) is the only
 * history the API exposes. Unknown categories read null. */
export function adaptAdminReport(raw: WireAdminReport): QueuedReport {
  const statuses = Array.isArray(raw.statuses) ? raw.statuses : [];
  const statusIds: string[] = [];
  for (const s of statuses) {
    if (s && typeof s === "object" && s.id != null) {
      const id = String(s.id);
      if (id && !statusIds.includes(id)) statusIds.push(id);
    }
  }
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  const ruleIds: string[] = [];
  for (const r of rules) {
    if (r && typeof r === "object" && r.id != null) {
      const id = String(r.id);
      if (id && !ruleIds.includes(id)) ruleIds.push(id);
    }
  }
  const reporter = adminNestedAccount(raw.account);
  const target = adminNestedAccount(raw.target_account);
  const assignee = adminNestedAccount(raw.assigned_account);
  const actionTakenBy = adminNestedAccount(raw.action_taken_by_account);
  const resolved = raw.action_taken === true;
  return {
    id: raw.id != null ? String(raw.id) : "",
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    comment: typeof raw.comment === "string" ? raw.comment : "",
    reporter: reporter ? adaptAccount(reporter) : null,
    target: target ? adaptAccount(target) : null,
    statusIds,
    ruleIds,
    category: knownReportCategory(raw.category),
    forwarded: raw.forwarded === true,
    state: resolved ? "resolved" : "open",
    assignee: assignee ? adaptAccount(assignee) : null,
    resolution: null,
    actionTakenAt: typeof raw.action_taken_at === "string" ? raw.action_taken_at : null,
    actionTakenBy: actionTakenBy ? adaptAccount(actionTakenBy) : null,
    moderationNote: null,
  };
}

function reportsQuery(opts: AdminReportsPageOptions): Record<string, QueryValue> {
  const query: Record<string, QueryValue> =
    opts.continuation?.kind === "url"
      ? {}
      : opts.continuation?.kind === "cursors"
        ? withCursors({}, opts.continuation.cursors)
        : withCursors({}, { limit: opts.limit ?? REPORTS_PAGE_LIMIT });
  if (opts.continuation?.kind !== "url") {
    if (opts.state === "resolved") query.resolved = true;
    else if (opts.state === "open") query.unresolved = true;
    if (opts.accountId) query.account_id = opts.accountId;
    if (opts.targetAccountId) query.target_account_id = opts.targetAccountId;
  }
  return query;
}

/** `GET /api/v1/admin/reports` — one Link-paged queue page. */
export async function fetchAdminReportsPage(
  client: MastoClient,
  opts: AdminReportsPageOptions = {},
): Promise<AdminReportsPage> {
  try {
    const path =
      opts.continuation?.kind === "url" ? opts.continuation.url : "/api/v1/admin/reports";
    const res = await client.get<unknown>(path, reportsQuery(opts));
    if (!Array.isArray(res.data)) {
      throw new FediError(
        `Admin reports returned an unexpected response shape (HTTP ${res.status}).`,
        "errors.shape.expectedList",
        { kind: "adminReport", status: res.status },
      );
    }
    const items = res.data
      .filter((r): r is WireAdminReport => !!r && typeof r === "object")
      .map(adaptAdminReport);
    const continuation = nextContinuation(res.headers, client.origin);
    return {
      items,
      continuation,
      end: continuation === null || items.length === 0,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

/** `GET /api/v1/admin/reports/:id` — one queued report. */
export async function fetchAdminReport(client: MastoClient, id: string): Promise<QueuedReport> {
  try {
    const res = await client.get<WireAdminReport>(`/api/v1/admin/reports/${encodeURIComponent(id)}`);
    if (!res.data || typeof res.data !== "object") {
      throw new FediError(
        `Admin report lookup returned an unexpected response shape (HTTP ${res.status}).`,
        "errors.shape.reportLookup",
      );
    }
    return adaptAdminReport(res.data);
  } catch (err) {
    throw toApiError(err);
  }
}

async function postReportAction(client: MastoClient, id: string, action: string): Promise<void> {
  try {
    await client.post(`/api/v1/admin/reports/${encodeURIComponent(id)}/${action}`);
  } catch (err) {
    throw toApiError(err);
  }
}

/** `POST /:id/assign_to_self` — claim the report for the viewer. */
export async function assignAdminReportToSelf(client: MastoClient, id: string): Promise<void> {
  await postReportAction(client, id, "assign_to_self");
}

/** `POST /:id/unassign` — release the claim. */
export async function unassignAdminReport(client: MastoClient, id: string): Promise<void> {
  await postReportAction(client, id, "unassign");
}

/** `POST /:id/reopen` — re-open a resolved report. */
export async function reopenAdminReport(client: MastoClient, id: string): Promise<void> {
  await postReportAction(client, id, "reopen");
}

/**
 * `POST /:id/resolve` — resolve the report (no params upstream). A
 * `decision` is refused with the typed unsupported error: the Mastodon
 * family has no verdict field, and a verdict the server never stores
 * must never read as used.
 */
export async function resolveAdminReport(
  client: MastoClient,
  id: string,
  opts?: ReportResolveOpts,
): Promise<void> {
  if (opts?.decision != null) {
    throw new FediError(
      "This server records no verdict on resolved reports.",
      "errors.unsupported.reportDecision",
    );
  }
  await postReportAction(client, id, "resolve");
}

/**
 * `PATCH /:id` — change category/rules (`report_params` permits ONLY
 * `category` + `rule_ids`). Each field rides only when set; unknown
 * categories never reach the wire.
 */
export async function updateAdminReport(
  client: MastoClient,
  id: string,
  patch: ReportRecategorizePatch,
): Promise<void> {
  const body: Record<string, unknown> = {};
  const category = patch.category;
  if (category !== undefined && (REPORT_CATEGORIES as readonly string[]).includes(category)) {
    body.category = category;
  }
  if (patch.ruleIds !== undefined) {
    body.rule_ids = [...patch.ruleIds];
  }
  try {
    await client.patch(`/api/v1/admin/reports/${encodeURIComponent(id)}`, body);
  } catch (err) {
    throw toApiError(err);
  }
}
