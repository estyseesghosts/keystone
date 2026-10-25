// Composer domain logic (slice 4.3): pure helpers that turn the composer's
// editable state into a `PostDraft` for the active backend. Pure TS; the
// network calls stay in the backends (`createPost`, `uploadMedia`,
// `scheduled.create`). Nothing here sends a field a family does not take
// (Sharkey answers 400 to unknown fields), and every optional feature is
// gated on a capability or an optional backend sub-module.

import type { Backend, PostDraft, ReactionAcceptance } from "../core/backend";
import type { Capabilities, ServerFamily } from "../core/detect";
import type { Account, Post, VisibilityKind } from "../core/models";
import { FediError } from "../core/errors";
import { defaultFetchImpl, type FetchImpl } from "../core/http";
import { isUnsupportedError, request } from "../mastodon/client";
import type { InstanceV1, InstanceV2 } from "../mastodon/wire";

// --- Limits and counting -----------------------------------------------------

export interface ComposeLimits {
  maxChars: number;
  /** Separate content-warning cap (Misskey family, 100). Null when the CW
   * counts toward the body total instead (Mastodon family). */
  maxCwChars: number | null;
  maxMedia: number;
  /** Per-kind server upload caps in bytes (Mastodon
   * `configuration.media_attachments`). Null = the server did not report
   * one: the client heap bound applies, never a guessed server number. */
  maxImageBytes: number | null;
  maxVideoBytes: number | null;
  maxPollOptions: number;
  /** Max characters per poll option. Null = not reported, not enforced. */
  maxPollOptionChars: number | null;
  /** Poll lifetime bounds in seconds. Null = not reported, not enforced
   * (the Mastodon 300 s floor stays a silent clamp in `buildPostDraft`,
   * never a rejection — the composer UI validates with a message). */
  minPollSeconds: number | null;
  maxPollSeconds: number | null;
  /** Mastodon-family reserved length per URL (server
   * `characters_reserved_per_url`, default 23). */
  urlWeight: number;
  /** ISO 639-1 codes the server accepts on posts. Null = not reported
   * (the language picker stays hidden, never faked). */
  supportedLanguages: string[] | null;
  /** 'server' when the values above were read from the instance;
   * 'fallback' when every read failed. Fallback values NEVER hard-block
   * posting (F10): the composer warns instead of disabling. */
  source: "server" | "fallback";
}

export const MISSKEY_COMPOSE_DEFAULTS: ComposeLimits = {
  maxChars: 3000,
  maxCwChars: 100,
  maxMedia: 16,
  maxImageBytes: null,
  maxVideoBytes: null,
  maxPollOptions: 10,
  maxPollOptionChars: null,
  minPollSeconds: null,
  maxPollSeconds: null,
  urlWeight: 23,
  supportedLanguages: null,
  source: "fallback",
};
export const MASTODON_COMPOSE_DEFAULTS: ComposeLimits = {
  maxChars: 500,
  maxCwChars: null,
  maxMedia: 4,
  maxImageBytes: null,
  maxVideoBytes: null,
  maxPollOptions: 4,
  maxPollOptionChars: null,
  minPollSeconds: null,
  maxPollSeconds: null,
  urlWeight: 23,
  supportedLanguages: null,
  source: "fallback",
};

export function composeDefaultsFor(family: ServerFamily): ComposeLimits {
  return family === "mastodon" ? MASTODON_COMPOSE_DEFAULTS : MISSKEY_COMPOSE_DEFAULTS;
}

export const MASTODON_URL_WEIGHT = 23;
const URL_RE = /https?:\/\/[^\s<>]+/g;
const REMOTE_MENTION_RE = /(^|[^\w@/])@([\w.-]+)@[\w.-]+\.[A-Za-z]{2,}/g;
/** Trailing punctuation the Mastodon server does NOT count as part of a
 * URL: the reserved weight covers the URL itself, a trailing `.` / `,` /
 * `!` / … counts separately on top (fixture: `see https://x.y/a.` counts
 * 23 + the rest). Balanced closers stay inside the URL (a Wikipedia
 * `…_(film)` keeps its flat 23) — only unambiguous sentence punctuation
 * is split off. */
const URL_TRAIL_RE = /[.,;:!?'"`\u2019\u201d>\u2026]+$/;

/** Character count the server will enforce. Mastodon family: code points,
 * each URL weighs `urlWeight` (server `characters_reserved_per_url`,
 * default 23), a remote mention counts only `@user`. Misskey family:
 * UTF-16 length of the trimmed text (the conservative reading — we never
 * allow what the server may refuse). */
export function countComposeChars(
  family: ServerFamily,
  text: string,
  urlWeight: number = MASTODON_URL_WEIGHT,
): number {
  const t = text.trim();
  if (family !== "mastodon") return t.length;
  const folded = t
    .replace(URL_RE, (url) => {
      const trail = URL_TRAIL_RE.exec(url)?.[0].length ?? 0;
      return "x".repeat(urlWeight) + url.slice(url.length - trail);
    })
    .replace(REMOTE_MENTION_RE, (_m, pre: string, user: string) => `${pre}@${user}`);
  return Array.from(folded).length;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveOrNull(value: unknown): number | null {
  const n = numOrNull(value);
  return n != null && n > 0 ? n : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length > 0 ? out : null;
}

/** Misskey `/api/meta` `langs` is an array of codes on most forks, but
 * tolerate a `[[code, name], …]` shape without ever inventing entries. */
function misskeyLangsOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const row of value) {
    if (typeof row === "string" && row.length > 0) out.push(row);
    else if (Array.isArray(row) && typeof row[0] === "string" && row[0].length > 0) out.push(row[0]);
  }
  return out.length > 0 ? out : null;
}

export interface FetchLimitsOptions {
  /** Retries after the first attempt (default 2, i.e. 3 attempts total). */
  retries?: number;
  /** Base backoff step in ms, multiplied by the attempt number (default
   * 250). Zero disables sleeping (tests). */
  retryDelayMs?: number;
  /** Per-request timeout for the Mastodon instance reads (default 10 s). */
  timeoutMs?: number;
}

/** Instance limits for the session's server, with the source marked.
 * Succeeds with `source: 'server'` whenever the instance answered;
 * every failure (after retries with backoff) falls back to the family
 * defaults with `source: 'fallback'` — never throws, the composer must
 * still open. The Misskey `meta` call carries no token and an empty body.
 *
 * Mastodon family: one v2/v1 instance read (v2 first, v1 on 404/405 only —
 * the same order as `fetchInstanceCapabilities`, derived inline so this
 * stays one dance, not two) covers chars, media count, per-kind byte caps,
 * poll bounds, the URL weight, and accepted languages. */
export async function fetchComposeLimits(
  session: { origin: string; family: ServerFamily },
  fetchImpl: FetchImpl = defaultFetchImpl,
  opts: FetchLimitsOptions = {},
): Promise<ComposeLimits> {
  const retries = opts.retries ?? 2;
  const delay = opts.retryDelayMs ?? 250;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchComposeLimitsOnce(session, fetchImpl, opts);
    } catch {
      if (attempt >= retries) {
        return { ...composeDefaultsFor(session.family), source: "fallback" };
      }
      if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
}

async function fetchComposeLimitsOnce(
  session: { origin: string; family: ServerFamily },
  fetchImpl: FetchImpl,
  opts: FetchLimitsOptions,
): Promise<ComposeLimits> {
  const defaults = composeDefaultsFor(session.family);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (session.family === "mastodon") {
    let v2: InstanceV2 | null = null;
    let v1: InstanceV1 | null = null;
    try {
      v2 =
        (await request<InstanceV2>(session.origin, "/api/v2/instance", { timeoutMs, fetchImpl })).data ?? null;
    } catch (err) {
      if (!isUnsupportedError(err)) throw err; // never fall back on timeout/401/403/5xx
    }
    if (v2) {
      try {
        v1 =
          (await request<InstanceV1>(session.origin, "/api/v1/instance", { timeoutMs, fetchImpl })).data ?? null;
      } catch {
        // v1 enrichment is optional — v2 alone is authoritative.
      }
    } else {
      v1 = (await request<InstanceV1>(session.origin, "/api/v1/instance", { timeoutMs, fetchImpl })).data ?? null;
    }
    if (!v2 && !v1) {
      throw new FediError(
        "No instance document answered.",
        "errors.compose.limitsUnavailable",
      );
    }
    const statuses = v2?.configuration?.statuses ?? v1?.configuration?.statuses;
    const media = v2?.configuration?.media_attachments;
    const polls =
      (v2?.configuration?.polls as Record<string, unknown> | undefined) ??
      (v1?.poll_limits as Record<string, unknown> | undefined);
    // v1 `upload_limit` is the generic per-upload byte cap: it backs both
    // kinds only when the specific `media_attachments` caps are absent.
    const genericCap = positiveOrNull(v1?.upload_limit);
    return {
      ...defaults,
      maxChars: numOrNull(statuses?.max_characters) ?? numOrNull(v1?.max_toot_chars) ?? defaults.maxChars,
      maxMedia: numOrNull(statuses?.max_media_attachments) ?? defaults.maxMedia,
      maxImageBytes: positiveOrNull(media?.image_size_limit) ?? genericCap,
      maxVideoBytes: positiveOrNull(media?.video_size_limit) ?? genericCap,
      maxPollOptions: numOrNull(polls?.max_options) ?? defaults.maxPollOptions,
      maxPollOptionChars: positiveOrNull(polls?.max_characters_per_option),
      minPollSeconds: positiveOrNull(polls?.min_expiration),
      maxPollSeconds: positiveOrNull(polls?.max_expiration),
      urlWeight: positiveOrNull(statuses?.characters_reserved_per_url) ?? MASTODON_URL_WEIGHT,
      supportedLanguages: stringArrayOrNull((v2 as { languages?: unknown } | null)?.languages),
      source: "server",
    };
  }
  const res = await fetchImpl(`${session.origin}/api/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new FediError(
      `The instance metadata request failed (HTTP ${res.status}).`,
      "errors.compose.limitsUnavailable",
      { status: res.status },
    );
  }
  const body = (await res.json()) as { maxNoteTextLength?: unknown; langs?: unknown };
  return {
    ...defaults,
    maxChars: positiveOrNull(body?.maxNoteTextLength) ?? defaults.maxChars,
    supportedLanguages: misskeyLangsOrNull(body?.langs),
    source: "server",
  };
}

// --- Visibility ----------------------------------------------------------------

export interface VisibilityOption {
  /** Wire value, passed through verbatim (`raw` round-trips). */
  raw: string;
  kind: VisibilityKind;
  label: string;
}

const MISSKEY_VISIBILITIES: VisibilityOption[] = [
  { raw: "public", kind: "public", label: "Public" },
  { raw: "home", kind: "quiet", label: "Home" },
  { raw: "followers", kind: "followers", label: "Followers" },
  { raw: "specified", kind: "direct", label: "Specified users" },
];
const MASTODON_VISIBILITIES: VisibilityOption[] = [
  { raw: "public", kind: "public", label: "Public" },
  { raw: "unlisted", kind: "quiet", label: "Unlisted" },
  { raw: "private", kind: "followers", label: "Followers only" },
  { raw: "direct", kind: "direct", label: "Mentioned people" },
];

export function visibilityOptionsFor(family: ServerFamily): readonly VisibilityOption[] {
  return family === "mastodon" ? MASTODON_VISIBILITIES : MISSKEY_VISIBILITIES;
}

/** Initial audience. A reply never widens its parent's audience. A
 * provided-but-unknown `preferredRaw` falls to the narrowest known kind,
 * never `public` (privacy 4); an absent one keeps today's family default. */
export function defaultVisibilityFor(
  family: ServerFamily,
  replyTo?: Post | null,
  preferredRaw?: string,
): VisibilityOption {
  const options = visibilityOptionsFor(family);
  const pick = (kind: VisibilityKind) => options.find((o) => o.kind === kind) ?? options[0];
  if (replyTo) {
    const parent = replyTo.visibility;
    const exact = options.find((o) => o.raw === parent.raw);
    return exact ?? pick(parent.kind);
  }
  if (preferredRaw != null) {
    return options.find((o) => o.raw === preferredRaw) ?? pick("followers");
  }
  return options[0];
}

/** Server-side compose defaults from the viewer's own account (privacy 4).
 * Mastodon: `verify_credentials` `source.{privacy, sensitive, language}`
 * (carried in `ext.mastodon.source` by `adaptCredentialAccount`).
 * Misskey family: the `i`-bag extras (`defaultNoteVisibility`,
 * `defaultNoteLocalOnly` in `ext.me`). Unknown/absent stays null — never
 * guessed; the caller (`defaultVisibilityFor`) narrows unknowns. */
export interface ComposePrefs {
  visibilityRaw: string | null;
  localOnly: boolean;
  sensitive: boolean;
  language: string | null;
}

export function composePrefsOf(me: Account | null): ComposePrefs {
  const out: ComposePrefs = { visibilityRaw: null, localOnly: false, sensitive: false, language: null };
  if (!me) return out;
  const masto = (me.ext as { mastodon?: Record<string, unknown> } | undefined)?.mastodon;
  const source = (masto?.source ?? null) as Record<string, unknown> | null;
  if (source && typeof source === "object") {
    if (typeof source.privacy === "string" && source.privacy.length > 0) out.visibilityRaw = source.privacy;
    if (source.sensitive === true) out.sensitive = true;
    if (typeof source.language === "string" && source.language.length > 0) out.language = source.language;
  }
  const i = (me.ext as { me?: Record<string, unknown> } | undefined)?.me;
  if (i && typeof i === "object") {
    if (typeof i.defaultNoteVisibility === "string" && i.defaultNoteVisibility.length > 0) {
      out.visibilityRaw = i.defaultNoteVisibility;
    }
    if (i.defaultNoteLocalOnly === true) out.localOnly = true;
  }
  return out;
}

// --- Gating --------------------------------------------------------------------

export type ComposeGate = { enabled: true } | { enabled: false; reason: string };
const on: ComposeGate = { enabled: true };
const off = (reason: string): ComposeGate => ({ enabled: false, reason });

export interface ComposeGates {
  media: ComposeGate;
  poll: ComposeGate;
  pollMultiple: ComposeGate;
  /** Mastodon `poll[hide_totals]` (clickstone §1.6). */
  pollHideTotals: ComposeGate;
  schedule: ComposeGate;
  reactionAcceptance: ComposeGate;
  localOnly: ComposeGate;
  quote: ComposeGate;
  /** Per-note quote refusal (`noQuote` on the Misskey-family wire). */
  noQuote: ComposeGate;
  /** Per-attachment sensitive flag applied at upload time. */
  mediaSensitive: ComposeGate;
  /** Alt text / description edited AFTER upload (clickstone §1.7).
   * Enabled when the backend exposes `updateMedia` (both families do:
   * Mastodon `PUT /api/v1/media/:id`, Misskey `drive/files/update`
   * `comment`); an absent API means the field stays locked with a reason. */
  mediaDescription: ComposeGate;
}

export function composeGates(
  family: ServerFamily,
  caps: Capabilities | null | undefined,
  backend?: Pick<Backend, "scheduled" | "updateMedia"> | null,
): ComposeGates {
  if (!caps) {
    const none = off("Sign in to post.");
    return {
      media: none,
      poll: none,
      pollMultiple: none,
      pollHideTotals: none,
      schedule: none,
      reactionAcceptance: none,
      localOnly: none,
      quote: none,
      noQuote: none,
      mediaSensitive: none,
      mediaDescription: none,
    };
  }
  return {
    media: on,
    poll: on,
    pollMultiple:
      caps.polls_multi === "unsupported" ? off("This server allows single-choice polls only.") : on,
    // Never an inert control: unsupported (no such field) and not-reported
    // stay distinct. Only Mastodon stores `hide_totals`; Akkoma documents
    // it but never persists it, so it is unsupported there.
    pollHideTotals:
      caps.polls_hide_totals === "supported"
        ? on
        : caps.polls_hide_totals === "unsupported"
          ? off("This server does not support hiding poll totals.")
          : off("This server has not reported hiding poll totals."),
    schedule:
      caps.scheduled_posts === "supported" && backend?.scheduled
        ? on
        : off("This server does not support scheduled posts."),
    reactionAcceptance:
      caps.reaction_acceptance === "supported"
        ? on
        : off("This server does not support limiting reactions."),
    localOnly:
      family !== "mastodon" && caps.local_only === "supported"
        ? on
        : off("This server cannot restrict a post to the local instance."),
    quote:
      family !== "mastodon" || caps.quote_posting === "supported"
        ? on
        : off("This server does not support quote posts."),
    // Never an inert control: an unknown flag is disabled with a reason
    // that says the server has not reported the feature, not that it is
    // absent. `no_quote` is the per-note refusal only; the account-wide
    // Misskey `rejectQuotes` switch lives in Settings → Account.
    noQuote:
      caps.no_quote === "supported"
        ? on
        : caps.no_quote === "unsupported"
          ? off("Keystone cannot set quote refusal per post on this server yet.")
          : off("This server has not reported a per-post quote setting."),
    mediaSensitive:
      caps.media_sensitivity === "supported"
        ? on
        : caps.media_sensitivity === "unsupported"
          ? off("This server marks media sensitivity for the whole post, not per attachment.")
          : off("This server has not reported per-attachment sensitivity."),
    mediaDescription: backend?.updateMedia
      ? on
      : off("This server cannot change a description after upload."),
  };
}

// --- State to draft --------------------------------------------------------------

export interface ComposeMedia {
  /** Server id (drive file id / media attachment id) once uploaded. */
  id: string;
  alt: string;
  sensitive?: boolean;
  /** Description the server already holds (seeded edit/redraft rows). The
   * composer compares against it to decide whether a
   * `Backend.updateMedia` call is needed; uploads use the same field as
   * the alt sent WITH the file. */
  originalAlt?: string;
  /** Thumbnail for an existing attachment (seeded rows only). */
  previewUrl?: string | null;
}

export interface ComposePollState {
  choices: string[];
  multiple: boolean;
  /** Seconds the poll stays open. */
  durationSeconds: number;
  /** Hide the tallies until the poll closes (Mastodon `hide_totals`).
   * Optional so older drafts/seeds load unchanged. */
  hideTotals?: boolean;
}

export interface ComposeState {
  text: string;
  cw: string;
  cwEnabled: boolean;
  visibilityRaw: string;
  localOnly: boolean;
  replyTo: Post | null;
  quote: Post | null;
  media: ComposeMedia[];
  poll: ComposePollState | null;
  reactionAcceptance: ReactionAcceptance | string | null;
  /** Per-note quote refusal (Misskey family). Never the account-wide
   * `rejectQuotes` switch — that lives in Settings. */
  noQuote: boolean;
  /** Mastodon-family status-level sensitivity (repair X4.4 finding 11):
   * marks every attached medium sensitive. Set by the composer toggle
   * (X6.2 step 5); emitted only on the Mastodon family. */
  sensitive: boolean;
  /** Mastodon-family post language (repair X4.4 finding 11). Set by the
   * composer picker (X6.2 step 5); emitted only when non-empty and only
   * on the Mastodon family. */
  language: string | null;
  /** ISO timestamp, or null to post now. */
  scheduledAt: string | null;
  visibleUserIds: string[];
}

export function emptyComposeState(init: Partial<ComposeState> = {}): ComposeState {
  return {
    text: "",
    cw: "",
    cwEnabled: false,
    visibilityRaw: "public",
    localOnly: false,
    replyTo: null,
    quote: null,
    media: [],
    poll: null,
    reactionAcceptance: null,
    noQuote: false,
    sensitive: false,
    language: null,
    scheduledAt: null,
    visibleUserIds: [],
    ...init,
  };
}

export type BuildResult =
  | { ok: true; draft: PostDraft; scheduledAt: string | null }
  | { ok: false; reason: string };

export interface BuildContext {
  family: ServerFamily;
  gates: ComposeGates;
  limits: ComposeLimits;
  now?: number;
}

/** Validate and build. Disabled features are never emitted, even if the
 * state still carries them. */
export function buildPostDraft(state: ComposeState, ctx: BuildContext): BuildResult {
  const { family, gates, limits } = ctx;
  const text = state.text.trim();
  const mediaIds = state.media.map((m) => m.id);
  const choices = (state.poll?.choices ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  const hasPoll = !!state.poll && gates.poll.enabled;

  if (hasPoll && choices.length < 2) return { ok: false, reason: "A poll needs at least two choices." };
  if (hasPoll && choices.length > limits.maxPollOptions) {
    return { ok: false, reason: `A poll can have at most ${limits.maxPollOptions} choices.` };
  }
  if (hasPoll && state.poll) {
    // Option length: only when the server reported a bound (F11) — never
    // hard-block on a guessed number.
    if (limits.maxPollOptionChars != null) {
      for (const c of choices) {
        if (Array.from(c).length > limits.maxPollOptionChars) {
          return { ok: false, reason: `Poll choices can be at most ${limits.maxPollOptionChars} characters.` };
        }
      }
    }
    // Duplicates (after trimming) would split the vote and read as one
    // row twice — the server 422s some shapes, so refuse locally.
    if (new Set(choices).size !== choices.length) {
      return { ok: false, reason: "Poll choices must be different." };
    }
    const durationSeconds = Math.round(state.poll.durationSeconds);
    if (limits.minPollSeconds != null && durationSeconds < limits.minPollSeconds) {
      return { ok: false, reason: `Polls must stay open at least ${limits.minPollSeconds} seconds on this server.` };
    }
    if (limits.maxPollSeconds != null && durationSeconds > limits.maxPollSeconds) {
      return { ok: false, reason: `Polls can stay open at most ${limits.maxPollSeconds} seconds on this server.` };
    }
  }
  if (hasPoll && mediaIds.length > 0) {
    return { ok: false, reason: "A post cannot have both a poll and media." };
  }
  if (mediaIds.length > limits.maxMedia) {
    return { ok: false, reason: `At most ${limits.maxMedia} attachments.` };
  }
  if (state.quote && !gates.quote.enabled) return { ok: false, reason: gates.quote.reason };
  if (text.length === 0 && mediaIds.length === 0 && !hasPoll && !state.quote) {
    return { ok: false, reason: "Write something first." };
  }
  const count = countComposeChars(family, text, limits.urlWeight);
  if (count > limits.maxChars) {
    return { ok: false, reason: `Too long: ${count} of ${limits.maxChars} characters.` };
  }
  const cw = state.cwEnabled ? state.cw.trim() : "";
  if (state.cwEnabled && cw.length > 0) {
    // Misskey counts the CW separately (server cap 100); Mastodon counts it in the body total.
    if (family === "mastodon" && count + cw.length > limits.maxChars) {
      return { ok: false, reason: "Too long with the content warning." };
    }
    if (family !== "mastodon" && limits.maxCwChars != null && cw.length > limits.maxCwChars) {
      return { ok: false, reason: `The content warning can be at most ${limits.maxCwChars} characters.` };
    }
  }
  const option = visibilityOptionsFor(family).find((o) => o.raw === state.visibilityRaw);
  // Unknown raw values pass through verbatim (plan §2.1), kind reads as direct.
  const visibility = {
    kind: (option?.kind ?? "direct") as VisibilityKind,
    localOnly: gates.localOnly.enabled ? state.localOnly : false,
    raw: state.visibilityRaw,
  };
  if (
    family !== "mastodon" &&
    state.visibilityRaw === "specified" &&
    state.visibleUserIds.length === 0 &&
    !state.replyTo
  ) {
    // Gated on the picked recipient list, never on a text `@mention`
    // match (F11): an email fragment or a plain mention must not satisfy
    // a specified-audience post.
    return { ok: false, reason: "Add a recipient for a specified-users post." };
  }
  let scheduledAt: string | null = null;
  if (state.scheduledAt && gates.schedule.enabled) {
    const t = Date.parse(state.scheduledAt);
    const nowMs = ctx.now ?? Date.now();
    if (!Number.isFinite(t) || t <= nowMs) {
      return { ok: false, reason: "Pick a time in the future." };
    }
    // Mastodon requires scheduled posts >= 5 minutes ahead; anything
    // sooner 422s after the upload round trip (F11).
    if (family === "mastodon" && t < nowMs + 5 * 60_000) {
      return { ok: false, reason: "Scheduled posts must be at least 5 minutes ahead on this server." };
    }
    scheduledAt = new Date(t).toISOString();
  }

  const draft: PostDraft = { visibility };
  if (text) draft.text = text;
  if (cw) draft.cw = cw;
  if (family !== "mastodon" && state.visibilityRaw === "specified" && state.visibleUserIds.length > 0) {
    draft.visibleUserIds = state.visibleUserIds;
  }
  if (state.replyTo) draft.replyId = state.replyTo.id;
  // Misskey `renoteId` and Mastodon `quoted_status_id` both ride on `renoteId`
  // in the draft; the backend maps it to its own field.
  if (state.quote) draft.renoteId = state.quote.id;
  if (mediaIds.length > 0) draft.mediaIds = mediaIds;
  if (hasPoll && state.poll) {
    // Mastodon rejects `poll[expires_in]` below 300 s (finding 22): clamp
    // at the domain layer so no caller can send 0. The composer UI
    // validates with a translated message before this runs; this silent
    // floor is the backstop (fedi carries no Lingui catalog).
    const floor = family === "mastodon" ? 300 : 1;
    const seconds = Math.max(floor, Math.round(state.poll.durationSeconds));
    draft.poll = {
      choices,
      multiple: gates.pollMultiple.enabled ? state.poll.multiple : false,
      // Misskey `expiredAfter` is milliseconds; Mastodon `expires_in` seconds.
      expiredAfter: family === "mastodon" ? seconds : seconds * 1000,
      // `true` only, and only where the field exists: a disabled gate drops
      // it so an unsupported server never sees `hide_totals`.
      ...(gates.pollHideTotals.enabled && state.poll.hideTotals ? { hideTotals: true } : {}),
    };
  }
  if (gates.reactionAcceptance.enabled && state.reactionAcceptance) {
    draft.reactionAcceptance = state.reactionAcceptance as ReactionAcceptance;
  }
  // Status-level sensitivity/language ride only on the Mastodon family
  // (X4.4 `PostDraft` fields wired by the X6.2 composer UI): the
  // Misskey family has no such `notes/create` fields and Sharkey 400s on
  // unknown ones. `sensitive: false` and an empty language stay absent —
  // the server default wins unless the user opted in.
  if (family === "mastodon") {
    if (state.sensitive) draft.sensitive = true;
    if (state.language) draft.language = state.language;
  }
  // Per-note quote refusal: `true` only. On create the wire omits a false
  // value anyway; on edit, omitting the field leaves whatever the note
  // already carries (an edit can never silently lift a refusal the
  // composer did not show — the `Post` model has no `noQuote` to seed it).
  if (gates.noQuote.enabled && state.noQuote) draft.noQuote = true;
  return { ok: true, draft, scheduledAt };
}

// --- Delete-and-redraft (clickstone §1.7) ------------------------------------

/** Reply/quote targets a redraft re-attaches. Pass them when the caller
 * resolved the ids through its backend; the post's own packed copies are
 * the fallback, and an absent target is simply dropped (never invented). */
export interface RedraftTargets {
  replyTo?: Post | null;
  quote?: Post | null;
}

/** Composer seed from an existing post — the "redraft" half of
 * delete-and-redraft. Pure: no network, no clock.
 *
 * What is carried: MFM source when the server packed it (plain otherwise),
 * CW, the wire visibility VERBATIM (a `home` post redrafts as `home`),
 * local-only, the attachments with their current alt text (so the composer's
 * description editor starts from the truth) and reply/quote context.
 *
 * What is NOT carried, deliberately: the poll (a deleted post's votes are
 * gone; silently reopening an empty poll would fake a fresh one), and the
 * per-note `noQuote` flag (the model carries no such field — the composer
 * shows the toggle unset rather than guessing). */
export function redraftSeedOf(post: Post, targets: RedraftTargets = {}): Partial<ComposeState> {
  const cw = post.cw ?? "";
  return {
    text: post.content.mfm ?? post.content.plain,
    cw,
    cwEnabled: cw !== "",
    visibilityRaw: post.visibility.raw,
    localOnly: post.visibility.localOnly,
    replyTo: targets.replyTo ?? post.reply ?? null,
    quote: targets.quote ?? post.quote ?? null,
    media: post.media.map((m) => ({
      id: m.id,
      alt: m.description ?? "",
      originalAlt: m.description ?? "",
      previewUrl: m.previewUrl ?? m.url ?? null,
      sensitive: m.isSensitive,
    })),
  };
}

/** The description writes a composer submit owes the server: seeded
 * attachments whose alt text changed, and uploads whose text changed after
 * the file was sent. Pure so the composer's submit path and its tests share
 * one rule (unchanged rows never cause a request). */
export function pendingMediaUpdates(
  seeded: readonly ComposeMedia[],
  uploaded: readonly {mediaId?: string | null; alt: string; originalAlt?: string; status?: string}[],
): Array<{ id: string; description: string | null }> {
  const out: Array<{ id: string; description: string | null }> = [];
  for (const m of seeded) {
    const before = m.originalAlt ?? "";
    if (m.alt === before) continue;
    out.push({ id: m.id, description: m.alt.trim() === "" ? null : m.alt });
  }
  for (const u of uploaded) {
    if (!u.mediaId || u.status !== "done") continue;
    if (u.alt === (u.originalAlt ?? "")) continue;
    out.push({ id: u.mediaId, description: u.alt.trim() === "" ? null : u.alt });
  }
  return out;
}

// --- Autocomplete trigger parsing ---------------------------------------------------

export type AutocompleteTrigger =
  | { kind: "mention" | "hashtag" | "emoji"; query: string; start: number; end: number }
  | null;

/** The token under the caret that an autocomplete popup should complete.
 * The query class is unicode-aware (`#日本語`, `#café`, `@josé` trigger);
 * the replace range comes from the same pattern so completion leaves no
 * stray characters (F12). */
export function autocompleteTriggerAt(text: string, caret: number): AutocompleteTrigger {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])([@#:])([\p{L}\p{N}_.@-]*)$/u.exec(before);
  if (!m) return null;
  const sigil = m[2];
  const query = m[3];
  if (sigil === ":" && query.length < 2) return null;
  const start = caret - query.length - 1;
  const kind = sigil === "@" ? "mention" : sigil === "#" ? "hashtag" : "emoji";
  return { kind, query, start, end: caret };
}

/** Replace the trigger token with `insert` (+ trailing space). */
export function applyCompletion(
  text: string,
  trigger: NonNullable<AutocompleteTrigger>,
  insert: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${insert} ${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + insert.length + 1 };
}

// --- Attachment byte caps (F9) -----------------------------------------------

/** Kind of a staged attachment for cap purposes. Anything that is not an
 * image or a video (audio, files) takes the conservative heap bound —
 * never a guessed server number. */
export type AttachmentKind = "image" | "video" | "other";

export function kindOfMime(mime: string | null | undefined): AttachmentKind {
  if (mime) {
    const m = mime.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
  }
  return "other";
}

/** Per-kind server caps, or all null when the server did not report any
 * (the heap bound applies to every kind). */
export interface AttachmentCaps {
  imageBytes: number | null;
  videoBytes: number | null;
}

/** Client heap-protection bound (not a server limit): whole-file reads
 * (`fetch(uri) → blob → File`) materialize the asset in the JS heap, so
 * a known size above this is refused before the read unless the server
 * reported a higher per-kind cap. X7.4 removes the whole-file read on
 * native; until then this is the OOM guard. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** Effective byte cap for one attachment of `kind`. Unknown sizes are
 * decided by the server (never blocked here); known sizes compare
 * against the per-kind server cap, else the heap bound. */
export function attachmentCapFor(kind: AttachmentKind, caps?: AttachmentCaps | null): number {
  if (kind === "video") return caps?.videoBytes ?? MAX_MEDIA_BYTES;
  if (kind === "image") return caps?.imageBytes ?? MAX_MEDIA_BYTES;
  return MAX_MEDIA_BYTES;
}

/** Locale-aware byte count for limit messages (the X9.5 formatter owns
 * units eventually; until then `Intl.NumberFormat` — never a literal
 * "10 MB"). Pure, no catalog: the caller wraps it in `msg`. */
export function formatByteLimit(bytes: number): string {
  const nf = new Intl.NumberFormat();
  const MB = 1024 * 1024;
  const KB = 1024;
  if (Number.isFinite(bytes) && bytes >= MB) {
    const v = Math.round((bytes / MB) * 10) / 10;
    return `${nf.format(v)} MB`;
  }
  if (Number.isFinite(bytes) && bytes >= KB) {
    return `${nf.format(Math.round(bytes / KB))} KB`;
  }
  return `${nf.format(Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0)} B`;
}

/** Honest refusal text for an over-cap attachment, or null when it fits.
 * Unknown sizes (non-finite, zero) pass — the server stays the verdict.
 * The message carries the real number that applied, never a literal.
 * Pure. */
export function attachmentSizeError(
  name: string,
  size: number,
  caps?: AttachmentCaps | null,
  kind: AttachmentKind = "other",
): string | null {
  if (!Number.isFinite(size) || size <= 0) return null;
  const cap = attachmentCapFor(kind, caps);
  if (size <= cap) return null;
  return `"${name}" is too large to attach (limit ${formatByteLimit(cap)}).`;
}
