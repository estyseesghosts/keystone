// Read-only server insight (Wave 3 slice 3.1 — NO mutations in this module).
//
// The four Misskey-family admin reads (clickstone §3.1), verified against
// the local Misskey + Sharkey + Catodon checkouts (endpoint files, not
// prose — source paths are recorded in the session log, not here):
// - `admin/server-info` — moderator role + `read:admin:server-info`;
//   hardware snapshot (machine/os/node/psql, cpu, mem/fs bytes).
// - `admin/meta` — ADMIN role + `read:admin:meta`; the full instance
//   settings object (133 properties upstream, including server secrets).
//   The adapter keeps ONLY the display/policy subset — secrets can never
//   cross into the UI.
// - `admin/queue/stats` — moderator role + `read:admin:queue`; per-queue
//   BullMQ job counts. Count reads only — the queue-job mutation endpoints
//   (clear/pause/promote/remove-job/…) are an explicit non-goal and stay
//   uncalled.
// - `get-online-users-count` — public, no credential; `{count}`.
//
// Every call posts `{}` (the three admin endpoints take no params, and
// Sharkey 400s on unknown fields) through the session-bound `WireCall`, so
// a token only ever reaches its own origin, `i`-precedence holds, and a
// 403 flows through the existing `isPermissionError` path — the 0.8 global
// re-auth prompt fires and the section disables with a reason. The module
// itself never touches a session: a 403 is data ("not allowed"), never a
// credential problem, and nothing here clears anything.

import type {
  MisskeyInstanceMeta,
  MisskeyQueueCounts,
  MisskeyQueueStats,
  MisskeyServerInfo,
  QueuedReport,
  ReportResolution,
  ReportResolveOpts,
  ReportsQueueListOpts,
} from "../core/backend";
import type { Account } from "../core/models";
import type { WireCall } from "./client";
import { adaptAccount } from "./adapt";
import type {
  AbuseUserReport,
  AdminMeta,
  AdminQueueStats,
  AdminServerInfo,
  OnlineUsersCount,
  UserLite,
} from "./wire";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `admin/server-info` — the hardware snapshot. Required-by-schema
 * strings fall back to "" (unreachable-but-safe); byte counts stay
 * numbers, never formatted strings the UI would reformat into a lie. */
export async function fetchServerInfo(call: WireCall): Promise<MisskeyServerInfo> {
  const raw = await call<AdminServerInfo>("admin/server-info", {});
  const cpu = recordOf(raw.cpu);
  const mem = recordOf(raw.mem);
  const fs = recordOf(raw.fs);
  const cores = numOrNull(cpu.cores);
  const memTotal = numOrNull(mem.total);
  const fsTotal = numOrNull(fs.total);
  const fsUsed = numOrNull(fs.used);
  return {
    machine: str(raw.machine),
    os: str(raw.os),
    node: str(raw.node),
    psql: str(raw.psql),
    cpu: { model: str(cpu.model), cores: cores ?? 0 },
    memTotal: memTotal ?? 0,
    fsTotal: fsTotal ?? 0,
    fsUsed: fsUsed ?? 0,
  };
}

/** `admin/meta` — the instance display/policy subset. Everything else the
 * server sends (SMTP secrets, private keys, captcha secrets, …) is
 * dropped, never adapted. */
export async function fetchInstanceMeta(call: WireCall): Promise<MisskeyInstanceMeta> {
  const raw = await call<AdminMeta>("admin/meta", {});
  return {
    name: strOrNull(raw.name),
    shortName: strOrNull(raw.shortName),
    description: strOrNull(raw.description),
    maintainerName: strOrNull(raw.maintainerName),
    maintainerEmail: strOrNull(raw.maintainerEmail),
    version: str(raw.version),
    uri: str(raw.uri),
    disableRegistration: raw.disableRegistration === true,
    emailRequiredForSignup: raw.emailRequiredForSignup === true,
  };
}

function adaptQueueCounts(value: unknown): MisskeyQueueCounts {
  const raw = recordOf(value);
  return {
    waiting: numOrNull(raw.waiting),
    active: numOrNull(raw.active),
    delayed: numOrNull(raw.delayed),
    completed: numOrNull(raw.completed),
    failed: numOrNull(raw.failed),
    paused: numOrNull(raw.paused),
  };
}

/** `admin/queue/stats` — the four queue count objects. Missing counters
 * read null ("not reported"), never zero — zero is a real measurement. */
export async function fetchQueueStats(call: WireCall): Promise<MisskeyQueueStats> {
  const raw = await call<AdminQueueStats>("admin/queue/stats", {});
  return {
    deliver: adaptQueueCounts(raw.deliver),
    inbox: adaptQueueCounts(raw.inbox),
    db: adaptQueueCounts(raw.db),
    objectStorage: adaptQueueCounts(raw.objectStorage),
  };
}

/** `get-online-users-count` — public; the viewer count. A non-number
 * answers 0 rather than inventing activity. */
export async function fetchOnlineUsersCount(call: WireCall): Promise<number> {
  const raw = await call<OnlineUsersCount>("get-online-users-count", {});
  return numOrNull(raw?.count) ?? 0;
}

/** The viewer's staff role from the self `i` pack (`ext.me.isAdmin` /
 * `isModerator`, packed only for the viewer — `UserEntityService` sends
 * them `isMe && isDetailed`). Null (signed out, or a server that did not
 * report the flags) is never guessed into a role. */
export function misskeyAdminRoleOf(account: Account | null): "admin" | "moderator" | null {
  const bag = account?.ext?.me;
  if (!bag || typeof bag !== "object") return null;
  const flags = bag as Record<string, unknown>;
  if (flags.isAdmin === true) return "admin";
  if (flags.isModerator === true) return "moderator";
  return null;
}

// --- Reports queue (Wave 3 slice 3.2 — list + confirm-gated mutations) --------
//
// Endpoints (verified in the local Misskey + Sharkey + Catodon checkouts —
// endpoint files, not prose):
// - `admin/abuse-user-reports` — moderator role +
//   `read:admin:abuse-user-reports`; params `limit`/`sinceId`/`untilId`
//   (cursor paging both ways) + `state: resolved|unresolved` (+
//   reporter/target origin filters, which the queue does not offer).
// - `admin/resolve-abuse-user-report {reportId, resolvedAs?}` —
//   `resolvedAs: accept|reject|null` (omitted/null resolves without a
//   verdict); kind `write:admin:resolve-abuse-user-report`.
// - `admin/update-abuse-user-report {reportId, moderationNote}` — the SAME
//   kind (exact-match on `token.permission`, so one grant covers all three
//   mutations); `moderationNote` is sent verbatim (an empty string clears
//   the note server-side).
// - `admin/forward-abuse-user-report {reportId}` — same kind again;
//   forwards to the target's home server (409/400 when already forwarded
//   or the target is local — those propagate, never masked).
//
// Deliberately ABSENT (no such endpoints upstream): a show-one route
// (detail renders the list row), unresolve/reopen (a resolved report
// stays resolved), assignment (resolve assigns the moderator), and
// categories/rules/statuses (Misskey files comment-only reports).
//
// Like the insight reads: every call posts through the session-bound
// `WireCall` (caller-`i` precedence, per-origin token), so a 403 flows
// through the existing `isPermissionError` path — the section disables
// with a reason, never a session clear.

/** `admin/abuse-user-reports` listing options (cursor paging both ways). */
export interface AbuseUserReportsPageOptions {
  state?: ReportsQueueListOpts["state"];
  limit?: number;
  sinceId?: string;
  untilId?: string;
}

/** One packed user row (or null when the server sent none/invalid). */
function packedAccount(value: unknown): Account | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.username !== "string") return null;
  return adaptAccount(value as UserLite);
}

function knownResolution(value: unknown): ReportResolution | null {
  return value === "accept" || value === "reject" ? value : null;
}

/** `AbuseUserReport` pack → core `QueuedReport`. Misskey files no
 * statuses, rules or categories — those stay empty/null (the queue never
 * files reports, so there is no unsupported noise to report). */
export function adaptAbuseUserReport(raw: AbuseUserReport): QueuedReport {
  const resolved = raw.resolved === true;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    comment: typeof raw.comment === "string" ? raw.comment : "",
    reporter: packedAccount(raw.reporter),
    target: packedAccount(raw.targetUser),
    statusIds: [],
    ruleIds: [],
    category: null,
    forwarded: raw.forwarded === true,
    state: resolved ? "resolved" : "open",
    assignee: packedAccount(raw.assignee),
    resolution: knownResolution(raw.resolvedAs),
    actionTakenAt: null,
    actionTakenBy: null,
    moderationNote:
      typeof raw.moderationNote === "string" ? raw.moderationNote : null,
  };
}

/** `admin/abuse-user-reports` — the queue page (`state` maps to the
 * upstream `state: resolved|unresolved` filter; omitted lists all). */
export async function fetchAbuseUserReports(
  call: WireCall,
  opts: AbuseUserReportsPageOptions = {},
): Promise<QueuedReport[]> {
  const params: Record<string, unknown> = { limit: opts.limit ?? 20 };
  if (opts.state === "resolved") params.state = "resolved";
  else if (opts.state === "open") params.state = "unresolved";
  if (opts.sinceId) params.sinceId = opts.sinceId;
  if (opts.untilId) params.untilId = opts.untilId;
  const rows = await call<AbuseUserReport[]>("admin/abuse-user-reports", params);
  return (rows ?? [])
    .filter((r): r is AbuseUserReport => !!r && typeof r === "object")
    .map(adaptAbuseUserReport);
}

/** `admin/resolve-abuse-user-report` — resolve, with or without a verdict
 * (`resolvedAs: accept|reject`; omitted/null resolves plainly). */
export async function resolveAbuseUserReport(
  call: WireCall,
  reportId: string,
  opts?: ReportResolveOpts,
): Promise<void> {
  await call<undefined>("admin/resolve-abuse-user-report", {
    reportId,
    resolvedAs: opts?.decision ?? null,
  });
}

/** `admin/update-abuse-user-report` — set the moderator note, verbatim
 * (empty clears it server-side). */
export async function updateAbuseUserReportNote(
  call: WireCall,
  reportId: string,
  note: string,
): Promise<void> {
  await call<undefined>("admin/update-abuse-user-report", {
    reportId,
    moderationNote: note,
  });
}

/** `admin/forward-abuse-user-report` — forward to the target's home
 * server (remote targets only; the server refuses the rest). */
export async function forwardAbuseUserReport(call: WireCall, reportId: string): Promise<void> {
  await call<undefined>("admin/forward-abuse-user-report", { reportId });
}
