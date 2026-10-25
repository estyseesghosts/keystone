// Moderation reports: filing vocabulary shared by both families
// (`ReportOptions`, `normalizeReportOptions`, `REPORT_CATEGORIES`) plus the
// Wave 3 slice 3.2 moderator queue surface (`QueuedReport`, `ReportsQueueApi`).
//
// Split from `core/backend.ts` (repair D3.2) — behavior-preserving move.
// `backend.ts` re-exports everything here so no importer changes.
//
// Pure TS: no framework imports, no globals (enforced by `no-ui-in-fedi`).

import type { Account, Page } from "./models";
import type { PageOpts } from "./backend";

// --- Reports queue (Wave 3 slice 3.2 — daily moderation surface) --------------

/**
 * Resolution verdict a moderator recorded on a queued report. Misskey packs
 * `resolvedAs` (`accept`/`reject`/null); the Mastodon family has no verdict
 * field at all (its API answers only the action outcome), so `resolution`
 * stays null there — never invented.
 */
export type ReportResolution = "accept" | "reject";

/**
 * One queued abuse/user report both families pack just enough to moderate
 * on — the ids the 1.5 user-report surface already sends (`status_ids`,
 * `rule_ids`, `category`, `forward`) plus the queue state the moderator
 * needs (reporter/target, assignee, action outcome).
 *
 * Per-family sources:
 * - Mastodon `REST::Admin::ReportSerializer`: id, comment, category
 *   (other/spam/legal/violation — unknown values read null), forwarded,
 *   created_at, the reporter/target/assignee/action-taker accounts (each
 *   an `Admin::AccountSerializer` wrapper nesting the plain account under
 *   `account`), `statuses[].id` (the `status_ids`), `rules[].id` (the
 *   `rule_ids`), `action_taken` (the open/resolved state) with
 *   `action_taken_at`/`action_taken_by_account`. No verdict, no
 *   moderator note, no notes/history: the `api/v1` namespace exposes
 *   neither `report.notes` nor `report.history` (web-admin-only), so they
 *   stay absent here rather than faked.
 * - Misskey `AbuseUserReport` pack: id, createdAt, comment, reporter/
 *   targetUser/assignee (+ their ids), forwarded, resolved (the
 *   open/resolved state), resolvedAs, moderationNote. No statuses, rules
 *   or categories exist on this family — those stay empty/null with no
 *   unsupported noise (the queue never files reports, it only lists them).
 *
 * `reporter`/`target`/`assignee`/`actionTakenBy` are null when the server
 * did not pack them — never an invented account.
 */
export interface QueuedReport {
  id: string;
  createdAt: string | null;
  /** The reporter's note (may be empty — some reports carry only ids). */
  comment: string;
  /** The reporting account; null when the server did not pack one. */
  reporter: Account | null;
  /** The reported account; null when the server did not pack one. */
  target: Account | null;
  /** Status/post ids backing the report (Mastodon `statuses[].id`;
   * always empty on Misskey, which files no statuses). */
  statusIds: string[];
  /** Server rule ids the report cites (Mastodon `rules[].id`; always
   * empty on Misskey). */
  ruleIds: string[];
  /** Reason category (Mastodon only; null on Misskey and on unknown
   * values, which are never forwarded blindly). */
  category: ReportCategory | null;
  /** Forwarded to the remote server (Mastodon `forwarded`, Misskey
   * `forwarded`). */
  forwarded: boolean;
  /** Open vs actioned (`action_taken` / `resolved`). */
  state: "open" | "resolved";
  /** The assigned moderator; null when unassigned or not reported. */
  assignee: Account | null;
  /** The recorded verdict (`resolvedAs`); null when none — always null
   * on the Mastodon family, which has no verdict field. */
  resolution: ReportResolution | null;
  /** When the action was taken; null when none was. */
  actionTakenAt: string | null;
  /** Who took the action; null when none was or the server did not say. */
  actionTakenBy: Account | null;
  /** The moderator's private note (Misskey `moderationNote`); null when
   * the family has none (Mastodon) or the report carries none. */
  moderationNote: string | null;
}

/** Queue listing options. `state` filters server-side where the family
 * supports it (Mastodon `resolved`/`unresolved`, Misskey
 * `state: resolved|unresolved`); omitted lists everything. */
export interface ReportsQueueListOpts extends PageOpts {
  state?: "open" | "resolved";
}

/** Resolve options. `decision` maps to Misskey `resolvedAs`
 * (accept/reject; omitted resolves without a verdict). The Mastodon
 * family has no verdict field — passing a decision there is refused with
 * the typed unsupported error, never silently dropped. */
export interface ReportResolveOpts {
  decision?: ReportResolution | null;
}

/** Mastodon report re-categorization (`PATCH /api/v1/admin/reports/:id`,
 * which permits `category` + `rule_ids` only). Each field is sent only
 * when set; the caller sends at least one. */
export interface ReportRecategorizePatch {
  category?: ReportCategory;
  ruleIds?: readonly string[];
}

/**
 * The moderation reports queue (Wave 3 slice 3.2).
 *
 * Both families serve `list` + `resolve`; the rest is per-family and
 * optional — an absent member means the family has no such endpoint, and
 * the UI hides (or disables-with-reason) the action instead of faking it:
 * - Mastodon: `get`, `assignToSelf`, `unassign`, `reopen`,
 *   `recategorize`. No `forward` (forwarding happens at report time) and
 *   no `updateNote` (no notes API exists in the `api/v1` namespace).
 * - Misskey: `updateNote` (`moderationNote`), `forward`. No `get` (no
 *   show endpoint — detail renders the list row), no `reopen`
 *   (no unresolve endpoint), no `assignToSelf`/`unassign` (assignment
 *   happens on resolve), no `recategorize` (no categories).
 *
 * Every mutation returns void: the UI confirms first, then refetches the
 * queue (optimistic updates are forbidden on this surface). A 403 is the
 * typed permission error — the caller disables the section with a reason,
 * never clears the session.
 *
 * Optional like every capability-gated member: a backend without these
 * endpoints leaves it undefined and the UI hides the surface.
 */
export interface ReportsQueueApi {
  /** The queue, newest first. Mastodon Link-pages; Misskey
   * `untilId`/`sinceId`-pages. */
  list(opts?: ReportsQueueListOpts): Promise<Page<QueuedReport>>;
  /** One report by id. Mastodon only (`GET /:id`). */
  get?(id: string): Promise<QueuedReport>;
  /** Claim the report for the viewer. Mastodon only. */
  assignToSelf?(id: string): Promise<void>;
  /** Release the claim. Mastodon only. */
  unassign?(id: string): Promise<void>;
  /** Re-open a resolved report. Mastodon only. */
  reopen?(id: string): Promise<void>;
  /** Resolve/close the report (Mastodon `POST :id/resolve`; Misskey
   * `admin/resolve-abuse-user-report`). */
  resolve(id: string, opts?: ReportResolveOpts): Promise<void>;
  /** Change category/rules. Mastodon only (`PATCH`, category + rule_ids). */
  recategorize?(id: string, patch: ReportRecategorizePatch): Promise<void>;
  /** Set the moderator note. Misskey only (`moderationNote`, verbatim —
   * an empty string clears the note). */
  updateNote?(id: string, note: string): Promise<void>;
  /** Forward the report to the target's home server. Misskey only. */
  forward?(id: string): Promise<void>;
}

// --- Reports (clickstone §1.5) ---------------------------------------------

/** The categories the Mastodon report chooser offers (`Report` enum:
 * `spam`/`legal`/`violation`/`other`). Mastodon's web client also shows a
 * "dislike" option, but it only thanks the reporter and files nothing —
 * never sent here. The wire values are strings; the server maps them to
 * integers. */
export type ReportCategory = "spam" | "legal" | "violation" | "other";

/** The chooser's payload: every field is optional because only what the
 * reporter actually chose is sent. An absent field means "server default",
 * never an empty array or a false flag. */
export interface ReportOptions {
  /** Reporter's note (Mastodon optional; Misskey REQUIRES it). */
  comment?: string;
  /** Posts backing the report (`status_ids[]`). */
  statusIds?: readonly string[];
  /** Reason category (Mastodon family only). */
  category?: ReportCategory;
  /** Server rules the report violates (`rule_ids[]`; Mastodon family only;
   * the server forces category `violation` when these are present). */
  ruleIds?: readonly string[];
  /** Forward a copy to the account's home server (Mastodon family only;
   * meaningful only for a REMOTE account). */
  forward?: boolean;
}

/** One chooser field a family cannot express, with the honest reason the
 * UI shows. Reporters are never told a field was used when it was not. */
export interface ReportUnsupportedField {
  field: "statusIds" | "category" | "ruleIds" | "forward";
  reason: string;
}

/** What the backend actually sent (normalized, so the caller can render an
 * honest confirmation instead of assuming the chooser was honoured). */
export interface ReportResult {
  comment: string;
  statusIds: string[];
  category: ReportCategory | null;
  ruleIds: string[];
  forward: boolean;
  unsupported: ReportUnsupportedField[];
}

/** One server rule (`GET /api/v1/instance/rules` row). */
export interface InstanceRule {
  id: string;
  text: string;
}

/** Stable order for the UI's category chooser (labels live in the app). */
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "spam",
  "legal",
  "violation",
  "other",
];

/**
 * Normalize caller input into the shape a backend reports back: trimmed
 * comment, deduped non-empty ids, known category only. Pure, shared by both
 * families so "what was sent" means the same thing everywhere.
 */
export function normalizeReportOptions(options: ReportOptions | string = {}): ReportOptions {
  const raw: ReportOptions = typeof options === "string" ? { comment: options } : options;
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  const ids = (values: readonly string[] | undefined): string[] => {
    const out: string[] = [];
    for (const value of values ?? []) {
      const id = typeof value === "string" ? value.trim() : "";
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  const statusIds = ids(raw.statusIds);
  const ruleIds = ids(raw.ruleIds);
  const category =
    raw.category && REPORT_CATEGORIES.includes(raw.category) ? raw.category : null;
  return {
    ...(comment ? { comment } : {}),
    ...(statusIds.length ? { statusIds } : {}),
    ...(ruleIds.length ? { ruleIds } : {}),
    ...(category ? { category } : {}),
    ...(raw.forward === true ? { forward: true } : {}),
  };
}

/** Outcome for a backend that cannot carry the fields it was given. */
export function reportUnsupported(field: ReportUnsupportedField["field"], reason: string): ReportUnsupportedField {
  return { field, reason };
}
