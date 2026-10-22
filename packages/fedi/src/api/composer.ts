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
  schedule: ComposeGate;
  reactionAcceptance: ComposeGate;
  localOnly: ComposeGate;
  quote: ComposeGate;
  /** Per-note quote refusal (`noQuote` on the Misskey-family wire). */
  noQuote: ComposeGate;
  /** Per-attachment sensitive flag applied at upload time. */
  mediaSensitive: ComposeGate;
}

export function composeGates(
  family: ServerFamily,
  caps: Capabilities | null | undefined,
  backend?: Pick<Backend, "scheduled"> | null,
): ComposeGates {
  if (!caps) {
    const none = off("Sign in to post.");
    return {
      media: none,
      poll: none,
      pollMultiple: none,
      schedule: none,
      reactionAcceptance: none,
      localOnly: none,
      quote: none,
      noQuote: none,
      mediaSensitive: none,
    };
  }
  return {
    media: on,
    poll: on,
    pollMultiple:
      caps.polls_multi === "unsupported" ? off("This server allows single-choice polls only.") : on,
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
  };
}

// --- State to draft --------------------------------------------------------------

export interface ComposeMedia {
  /** Server id (drive file id / media attachment id) once uploaded. */
  id: string;
  alt: string;
  sensitive?: boolean;
}

export interface ComposePollState {
  choices: string[];
  multiple: boolean;
  /** Seconds the poll stays open. */
  durationSeconds: number;
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
