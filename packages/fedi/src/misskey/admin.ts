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
} from "../core/backend";
import type { Account } from "../core/models";
import type { WireCall } from "./client";
import type {
  AdminMeta,
  AdminQueueStats,
  AdminServerInfo,
  OnlineUsersCount,
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
