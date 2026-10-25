// Read-only server insight (Wave 3, clickstone §3.1): Mastodon admin
// measures/dimensions plus public instance trio, and Misskey-family
// server-info/instance-meta/queue-stats behind `AdminInsightApi`.
//
// Split from `core/backend.ts` (repair D3.2) — behavior-preserving move.
// `backend.ts` re-exports everything here so no importer changes.
//
// Pure TS: no framework imports, no globals (enforced by `no-ui-in-fedi`).

import type { Content } from "./models";

// --- Server insight (Wave 3, clickstone §3.1 — read-only) -------------------

/**
 * One admin dashboard measure (`POST /api/v1/admin/measures` row,
 * `REST::Admin::MeasureSerializer`).
 *
 * Only the fields the insight screen renders: the server stringifies the
 * numbers (`total: "120"`), so they stay strings here — never parsed into
 * floats the UI would reformat into a lie. `data` points are `{date,
 * value}` pairs as the server sends them; a missing date reads null (some
 * measures answer totals only), never "now".
 */
export interface AdminMeasure {
  key: string;
  unit: string | null;
  total: string;
  humanValue: string | null;
  previousTotal: string | null;
  data: Array<{ date: string | null; value: string }>;
}

/** One admin dimension breakdown row (`REST::Admin::DimensionSerializer`
 * `data` entry: `{key, human_key?, value}`). */
export interface AdminDimensionRow {
  key: string;
  /** Human-readable label (`human_key`), or null when the server sent none. */
  label: string | null;
  /** The server stringifies the count — it stays a string here. */
  value: string;
}

/** One admin dashboard dimension (`POST /api/v1/admin/dimensions` row). */
export interface AdminDimension {
  key: string;
  rows: AdminDimensionRow[];
}

/**
 * The server's published long-form description (`GET
 * /api/v1/instance/extended_description`, `REST::ExtendedDescriptionSerializer`).
 * `html` is the family's SOURCE (server-rendered Markdown) — parsed through
 * the one allow-listed AST at render time, never raw markup in the UI.
 */
export interface InstanceExtendedDescription {
  updatedAt: string | null;
  html: string;
}

/** One weekly activity row (`GET /api/v1/instance/activity`). Counts are
 * server strings, kept as strings (or null when the server omits one). */
export interface InstanceActivityWeek {
  week: string;
  statuses: string | null;
  logins: string | null;
  registrations: string | null;
}

// --- Misskey-family server insight (Wave 3 slice 3.1 — read-only) ----------

/**
 * Misskey-family hardware snapshot (`admin/server-info`, moderator role +
 * `read:admin:server-info`). Byte counts stay raw numbers — the UI formats
 * them, so no precision is invented here. A null field means the server
 * did not report it — never zero, which is a real measurement (same rule
 * as `MisskeyQueueCounts`).
 */
export interface MisskeyServerInfo {
  machine: string | null;
  os: string | null;
  node: string | null;
  psql: string | null;
  cpu: { model: string | null; cores: number | null };
  /** Total RAM, bytes. */
  memTotal: number | null;
  /** Filesystem total / used, bytes. */
  fsTotal: number | null;
  fsUsed: number | null;
}

/**
 * Misskey-family instance display/policy subset (`admin/meta`, ADMIN role
 * + `read:admin:meta`). The server sends 133 properties including secrets;
 * only these renderable, non-secret fields cross into the UI.
 */
export interface MisskeyInstanceMeta {
  name: string | null;
  shortName: string | null;
  description: string | null;
  maintainerName: string | null;
  maintainerEmail: string | null;
  version: string;
  uri: string;
  disableRegistration: boolean;
  emailRequiredForSignup: boolean;
}

/** One BullMQ queue's job counters (`admin/queue/stats`). A null counter
 * means the server did not report it — never zero, which is a real
 * measurement. */
export interface MisskeyQueueCounts {
  waiting: number | null;
  active: number | null;
  delayed: number | null;
  completed: number | null;
  failed: number | null;
  paused: number | null;
}

/** Misskey-family queue counts (`admin/queue/stats`, moderator role +
 * `read:admin:queue`). Count reads only — the queue-job mutation endpoints
 * are an explicit non-goal and have no member here. */
export interface MisskeyQueueStats {
  deliver: MisskeyQueueCounts;
  inbox: MisskeyQueueCounts;
  db: MisskeyQueueCounts;
  objectStorage: MisskeyQueueCounts;
}

/**
 * Read-only server insight (Wave 3 slice 3.1 — NO mutations here at all).
 *
 * The Mastodon family serves `POST /api/v1/admin/measures|dimensions`
 * behind `admin:read` (plus a staff role — a 403 disables the section
 * with a reason, never clears the session); forks without the routes
 * (Akkoma/Pleroma) answer 404 and the UI renders the honest
 * unsupported state. The public trio (`peers`, `extendedDescription`,
 * `activity`) needs no admin scope at all — it is the non-admin
 * fallback (and the only thing a non-staff viewer ever sees), alongside
 * the existing `instanceRules` member. Each method degrades
 * independently: one section's 403/404 never blanks the others.
 *
 * Optional like every capability-gated member: a backend without these
 * endpoints leaves it undefined and the UI hides the surface.
 */
export interface AdminInsightApi {
  /** `POST /api/v1/admin/measures {keys}` — admin:read + staff role. */
  measures(keys: readonly string[]): Promise<AdminMeasure[]>;
  /** `POST /api/v1/admin/dimensions {keys}` — admin:read + staff role. */
  dimensions(keys: readonly string[]): Promise<AdminDimension[]>;
  /** `GET /api/v1/instance/peers` — public; the peered domains. */
  peers(): Promise<string[]>;
  /** `GET /api/v1/instance/extended_description` — public. */
  extendedDescription(): Promise<InstanceExtendedDescription>;
  /** `GET /api/v1/instance/activity` — public weekly counters. */
  activity(): Promise<InstanceActivityWeek[]>;
  /**
   * Misskey-family `admin/server-info` — hardware snapshot (moderator
   * role + `read:admin:server-info`). Undefined on the Mastodon family,
   * which has no such endpoint. A 403 disables the section with a reason
   * (never a session clear); a 404 is the honest absent state.
   */
  serverInfo?(): Promise<MisskeyServerInfo>;
  /**
   * Misskey-family `admin/meta` display/policy subset (ADMIN role +
   * `read:admin:meta`). Undefined on the Mastodon family. A moderator
   * without the admin role 403s here while the moderator-level sections
   * still render — each section degrades independently.
   */
  instanceMeta?(): Promise<MisskeyInstanceMeta>;
  /**
   * Misskey-family `admin/queue/stats` — per-queue job counts (moderator
   * role + `read:admin:queue`). Count reads only. Undefined on the
   * Mastodon family.
   */
  queueStats?(): Promise<MisskeyQueueStats>;
  /**
   * Misskey-family `get-online-users-count` — public, no permission
   * needed. Undefined on the Mastodon family.
   */
  onlineUsersCount?(): Promise<number>;
}
