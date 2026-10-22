// Composer domain logic (slice 4.3): pure helpers that turn the composer's
// editable state into a `PostDraft` for the active backend. Pure TS; the
// network calls stay in the backends (`createPost`, `uploadMedia`,
// `scheduled.create`). Nothing here sends a field a family does not take
// (Sharkey answers 400 to unknown fields), and every optional feature is
// gated on a capability or an optional backend sub-module.

import type { Backend, PostDraft, ReactionAcceptance } from "../core/backend";
import type { Capabilities, ServerFamily } from "../core/detect";
import type { Post, VisibilityKind } from "../core/models";
import { fetchInstanceCapabilities } from "../mastodon/instance";

// --- Limits and counting -----------------------------------------------------

export interface ComposeLimits {
  maxChars: number;
  maxMedia: number;
  maxPollOptions: number;
}

export const MISSKEY_COMPOSE_DEFAULTS: ComposeLimits = {
  maxChars: 3000,
  maxMedia: 16,
  maxPollOptions: 10,
};
export const MASTODON_COMPOSE_DEFAULTS: ComposeLimits = {
  maxChars: 500,
  maxMedia: 4,
  maxPollOptions: 4,
};

export function composeDefaultsFor(family: ServerFamily): ComposeLimits {
  return family === "mastodon" ? MASTODON_COMPOSE_DEFAULTS : MISSKEY_COMPOSE_DEFAULTS;
}

export const MASTODON_URL_WEIGHT = 23;
const URL_RE = /https?:\/\/[^\s<>]+/g;
const REMOTE_MENTION_RE = /(^|[^\w@/])@([\w.-]+)@[\w.-]+\.[A-Za-z]{2,}/g;

/** Character count the server will enforce. Mastodon family: code points,
 * each URL weighs 23, a remote mention counts only `@user`. Misskey family:
 * UTF-16 length of the trimmed text (the conservative reading — we never
 * allow what the server may refuse). */
export function countComposeChars(family: ServerFamily, text: string): number {
  const t = text.trim();
  if (family !== "mastodon") return t.length;
  const folded = t
    .replace(URL_RE, "x".repeat(MASTODON_URL_WEIGHT))
    .replace(REMOTE_MENTION_RE, (_m, pre: string, user: string) => `${pre}@${user}`);
  return Array.from(folded).length;
}

/** Instance limits for the session's server. Failures fall back to the
 * family defaults (never throw: the composer must still open). The Misskey
 * `meta` call carries no token and an empty body. */
export async function fetchComposeLimits(
  session: { origin: string; family: ServerFamily },
  fetchImpl: typeof fetch = fetch,
): Promise<ComposeLimits> {
  const defaults = composeDefaultsFor(session.family);
  try {
    if (session.family === "mastodon") {
      const caps = await fetchInstanceCapabilities(session.origin);
      return {
        ...defaults,
        maxChars: caps.maxStatusCharacters ?? defaults.maxChars,
        maxMedia: caps.maxMediaAttachments ?? defaults.maxMedia,
      };
    }
    const res = await fetchImpl(`${session.origin}/api/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return defaults;
    const body = (await res.json()) as { maxNoteTextLength?: unknown };
    const n = body?.maxNoteTextLength;
    return {
      ...defaults,
      maxChars: typeof n === "number" && n > 0 ? n : defaults.maxChars,
    };
  } catch {
    return defaults;
  }
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

/** Initial audience. A reply never widens its parent's audience. */
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
  return options.find((o) => o.raw === preferredRaw) ?? options[0];
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
  const count = countComposeChars(family, text);
  if (count > limits.maxChars) {
    return { ok: false, reason: `Too long: ${count} of ${limits.maxChars} characters.` };
  }
  const cw = state.cwEnabled ? state.cw.trim() : "";
  if (state.cwEnabled && cw.length > 0) {
    // Misskey counts the CW separately (limit 100); Mastodon counts it in the body total.
    if (family === "mastodon" && count + cw.length > limits.maxChars) {
      return { ok: false, reason: "Too long with the content warning." };
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
    !state.replyTo &&
    !/@\w/.test(text)
  ) {
    return { ok: false, reason: "Add a recipient for a specified-users post." };
  }
  let scheduledAt: string | null = null;
  if (state.scheduledAt && gates.schedule.enabled) {
    const t = Date.parse(state.scheduledAt);
    if (!Number.isFinite(t) || t <= (ctx.now ?? Date.now())) {
      return { ok: false, reason: "Pick a time in the future." };
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
    const seconds = Math.max(1, Math.round(state.poll.durationSeconds));
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

/** The token under the caret that an autocomplete popup should complete. */
export function autocompleteTriggerAt(text: string, caret: number): AutocompleteTrigger {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])([@#:])([\w.@-]*)$/.exec(before);
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
