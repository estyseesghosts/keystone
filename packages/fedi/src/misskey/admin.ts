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
  AdminInsightApi,
  MisskeyInstanceMeta,
  MisskeyQueueCounts,
  MisskeyQueueStats,
  MisskeyServerInfo,
  QueuedReport,
  ReportResolution,
  ReportResolveOpts,
  ReportsQueueApi,
  ReportsQueueListOpts,
} from "../core/backend";
import { ApiError } from "../core/errors";
import type { Account } from "../core/models";
import type { WireCall } from "./client";
import { adaptAccount, decodeCursor, pageOf } from "./adapt";
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

/** `admin/server-info` — the hardware snapshot. Every field reads null
 * when the server did not report it ("not reported", never zero — zero
 * cores / zero bytes is a real measurement), matching `fetchQueueStats`.
 * Required-by-schema strings are still absent-safe via the same rule. */
export async function fetchServerInfo(call: WireCall): Promise<MisskeyServerInfo> {
  const raw = await call<AdminServerInfo>("admin/server-info", {});
  const cpu = recordOf(raw.cpu);
  const mem = recordOf(raw.mem);
  const fs = recordOf(raw.fs);
  return {
    machine: strOrNull(raw.machine),
    os: strOrNull(raw.os),
    node: strOrNull(raw.node),
    psql: strOrNull(raw.psql),
    cpu: { model: strOrNull(cpu.model), cores: numOrNull(cpu.cores) },
    memTotal: numOrNull(mem.total),
    fsTotal: numOrNull(fs.total),
    fsUsed: numOrNull(fs.used),
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

/** The honest answer for an insight section this family cannot serve
 * (the Mastodon-family methods on the Misskey backend — no such
 * endpoints here). Status 404 so the UI's "not on this server" states
 * trigger exactly as they do for a missing Misskey endpoint. */
function unsupportedAdminInsight(scope: string): never {
  throw new ApiError(
    `Server insight ${scope} is not available on this server.`,
    404,
    "errors.unsupported.adminInsight",
    undefined,
    { scope },
  );
}

// Read-only server insight (Wave 3 slice 3.1 — NO mutations here).
// Misskey/sharkey/catodon serve all four endpoints (verified in their
// checkouts); pinetree serves none, so it leaves the member off and the
// query gate renders the honest unavailable state. The five
// Mastodon-family methods throw the typed unsupported error — this
// family has no such endpoints, and the query layer never calls them on
// this family (family branch); a 404 maps to `absent` if one ever is.
export function createAdminInsightApi(call: WireCall): AdminInsightApi {
  return {
    measures() {
      return unsupportedAdminInsight("measures");
    },
    dimensions() {
      return unsupportedAdminInsight("dimensions");
    },
    peers() {
      return unsupportedAdminInsight("peers");
    },
    extendedDescription() {
      return unsupportedAdminInsight("extended description");
    },
    activity() {
      return unsupportedAdminInsight("activity");
    },
    serverInfo() {
      return fetchServerInfo(call);
    },
    instanceMeta() {
      return fetchInstanceMeta(call);
    },
    queueStats() {
      return fetchQueueStats(call);
    },
    onlineUsersCount() {
      return fetchOnlineUsersCount(call);
    },
  };
}

// Reports queue (Wave 3 slice 3.2). Misskey/sharkey/catodon serve all
// four endpoints with identical kinds (verified in their checkouts);
// pinetree serves none, so it leaves the member off and the queue gate
// renders the honest unavailable state. The Mastodon-family members
// (get/assign/unassign/reopen/recategorize) have no Misskey equivalent
// and stay undefined — the UI hides those actions, never fakes them.
// Mutations return void: the UI confirms first, then refetches.
export function createReportsQueueApi(call: WireCall): ReportsQueueApi {
  const DEFAULT_LIMIT = 20;
  return {
    async list(opts: ReportsQueueListOpts = {}) {
      const cursor = decodeCursor(opts.cursor ?? null);
      const items = await fetchAbuseUserReports(call, {
        state: opts.state,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...(cursor.sinceId ? { sinceId: cursor.sinceId } : {}),
        ...(cursor.untilId ? { untilId: cursor.untilId } : {}),
      });
      return pageOf(items, opts.limit ?? DEFAULT_LIMIT, (item) => item);
    },
    async resolve(id: string, opts?: ReportResolveOpts) {
      await resolveAbuseUserReport(call, id, opts);
    },
    async updateNote(id: string, note: string) {
      await updateAbuseUserReportNote(call, id, note);
    },
    async forward(id: string) {
      await forwardAbuseUserReport(call, id);
    },
  };
}
