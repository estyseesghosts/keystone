// Server family/flavor detection (plan §2.1, Phase 1 item B).
//
// Generalises Keystodon's `detectFamily` (`api/mastodon/instance.ts`) so the
// Misskey family is detected too. Self-contained on purpose: `src/core/` is
// below both adapters and imports no wire module.
//
// Detection order (plan §2.1):
//   1. NodeInfo `software.name`;
//   2. the family probe — Misskey `POST /api/meta`, or Mastodon
//      `GET /api/v2/instance` with a v1 fallback;
//   3. the version-string and shape heuristics (the old `detectFamily`
//      shape: never parse one substring as the sole detector).
//
// Preserved gotcha from `mastodon/instance.ts`: the v2→v1 instance fallback
// happens on 404/405 ONLY — never on timeout/401/403/other 4xx/5xx, because
// Akkoma has NO v2 endpoint and a timeout is never evidence of absence.
// Akkoma's version marker changed across releases ("compatible; Pleroma" →
// "compatible; Akkoma"), so markers are combined with shape evidence
// (`pleroma.metadata`, `pleroma.features`) and NodeInfo, and detection
// stays unknown when the evidence is ambiguous.
//
// MD13 — classifier authority: THIS module (`detectServer` / `detectFlavor`)
// is the single authority for family/flavor. `mastodon/instance.ts`
// `detectFamily` is a transport-level fallback for the instance-probe path
// only: it sees version markers + pleroma shape + NodeInfo, never the
// Misskey-family probe or the `mastodonBody` shape flag, so on a vanilla
// Mastodon v2 body (version "4.4.3", no pleroma markers) it answers
// "unknown" where this module answers "mastodon" via probe-shape. Callers
// must treat a transport "unknown" as "defer to core", never as evidence
// of absence — and never branch UI on it. The agreement matrix is pinned
// in `packages/fedi/test/detect.test.ts` ("MD13 classifier authority").

export type ServerFamily = "misskey" | "mastodon";

export type ServerFlavor =
  | "misskey"
  | "sharkey"
  | "catodon"
  | "pinetree"
  | "mastodon"
  | "akkoma"
  | "pleroma"
  | "unknown";

export type FeatureSupport = "supported" | "unsupported" | "unknown";

export type FeatureKey =
  // Posting
  | "reactions"
  | "reaction_acceptance"
  | "like"
  | "mfm"
  | "quote_posting"
  | "status_editing"
  | "polls_multi"
  // Mastodon-family `poll[hide_totals]` (clickstone §1.6). Mastodon
  // persists it (`app/models/poll.rb`, `PostStatusService`); Akkoma/Pleroma
  // document it in the API spec but their poll builder never stores it
  // (`lib/pleroma/web/common_api/utils.ex` `make_poll_data/1`), so sending
  // it there would be a silent no-op — unsupported, never sent. The
  // Misskey family has no such poll field.
  | "polls_hide_totals"
  | "scheduled_posts"
  | "server_drafts"
  | "local_only"
  // Per-note publisher controls (clickstone §1.2). `no_quote` is the
  // per-note quote refusal v1 sent (`noQuote` on the Misskey-family
  // create/edit body). `media_sensitivity` is per-attachment sensitivity
  // applied AT UPLOAD (`drive/files/create` `isSensitive` on the Misskey
  // family); the Mastodon family only has status-level `sensitive`, so it
  // is unsupported there — never a per-media field.
  | "no_quote"
  | "media_sensitivity"
  // Misskey-family extras
  | "drive"
  | "antennas"
  | "clips"
  | "channels"
  // Server announcements (clickstone §1.12): read + per-row dismiss. The
  // Misskey family serves `announcements` + `i/read-announcement`; the
  // Mastodon family serves `/api/v1/announcements[/:id/dismiss]`.
  | "announcements"
  | "chats"
  // Messaging
  // `direct_messages` gates the DM/conversation inbox surface in the app.
  // It is a CLIENT gate, not a server fact: both families have DMs/chat
  // serverside. The Mastodon family ships the inbox in slice 2.1
  // (P6.2 — `/api/v1/conversations`, source-verified on mastodon +
  // akkoma), so those flavors read `supported`; pleroma is unverified and
  // stays gated. The Misskey family ships chat in slice 2.2 (P6.2 —
  // `chat/*`, verified on upstream develop + live Sharkey), so misskey +
  // sharkey read `supported` there while catodon (unverified) and
  // pinetree (no chat) stay gated. `chats` is the Misskey-family server
  // feature fact — do not overload it.
  | "direct_messages"
  // Organization
  | "lists"
  // Mastodon list row fields (clickstone §1.6). `lists_replies_policy` is
  // Mastodon `replies_policy` (`none|followed|list`, `List` enum +
  // `ListsController#list_params`); Akkoma/Pleroma accept `title`/
  // `exclusive` only and never expose a policy, and the Misskey family's
  // user lists have no reply filter at all. `lists_exclusive` is the
  // Mastodon `exclusive` boolean; Akkoma/Pleroma cast and render it too
  // (`Pleroma.List.update_changeset` + `ListView`), Misskey has none.
  | "lists_replies_policy"
  | "lists_exclusive"
  | "bookmarks"
  | "favourites_distinct_from_reactions"
  // Server services
  | "translation"
  | "streaming"
  // Auth
  | "password_grant"
  | "mfa_challenge"
  | "pkce"
  | "miauth";

export type Capabilities = Record<FeatureKey, FeatureSupport>;

export const FEATURE_KEYS: readonly FeatureKey[] = [
  "reactions",
  "reaction_acceptance",
  "like",
  "mfm",
  "quote_posting",
  "status_editing",
  "polls_multi",
  "polls_hide_totals",
  "scheduled_posts",
  "server_drafts",
  "local_only",
  "no_quote",
  "media_sensitivity",
  "drive",
  "antennas",
  "clips",
  "channels",
  "announcements",
  "chats",
  "direct_messages",
  "lists",
  "lists_replies_policy",
  "lists_exclusive",
  "bookmarks",
  "favourites_distinct_from_reactions",
  "translation",
  "streaming",
  "password_grant",
  "mfa_challenge",
  "pkce",
  "miauth",
];

export function familyOf(flavor: ServerFlavor): ServerFamily | null {
  switch (flavor) {
    case "misskey":
    case "sharkey":
    case "catodon":
    case "pinetree":
      return "misskey";
    case "mastodon":
    case "akkoma":
    case "pleroma":
      return "mastodon";
    default:
      return null;
  }
}

// --- Evidence --------------------------------------------------------------

export interface DetectionEvidence {
  /** NodeInfo 2.x `software.name` (lowercased compare), or null. */
  nodeinfoName?: string | null;
  /** NodeInfo `software.version`, or null. */
  nodeinfoVersion?: string | null;
  /** Version string from meta / instance probes, or null. */
  version?: string | null;
  /** True when a probed body carried `pleroma` (Akkoma/Pleroma shape). */
  pleromaBody?: boolean;
  /** `pleroma.metadata.features` entries (Akkoma/Pleroma feature flags). */
  pleromaFeatures?: readonly string[];
  /** True when a probed body is Misskey-shaped (meta). */
  misskeyBody?: boolean;
  /** True when a probed body is Mastodon-shaped (v1/v2 instance). */
  mastodonBody?: boolean;
  /** Misskey-family `meta.translatorAvailable`, when the probe saw it
   * (lets `buildCapabilities` set `translation` honestly). Ignored on a
   * Mastodon-family flavor — the two families' evidence never crosses. */
  translatorAvailable?: boolean | null;
  /** Mastodon-family `configuration.translation.enabled`, when a probed
   * instance body carried it (lets `buildCapabilities` set `translation`
   * honestly on servers the probe reached). Null/absent = not advertised.
   * Ignored on a Misskey-family flavor. */
  translationAdvertised?: boolean | null;
}

/** NodeInfo `software.name` → flavor. Exact names only; anything else falls
 * through to the probes/heuristics. */
export function flavorFromNodeInfoName(name: string | null | undefined): ServerFlavor {
  const soft = (name ?? "").trim().toLowerCase();
  if (soft === "misskey") return "misskey";
  if (soft === "sharkey") return "sharkey";
  if (soft === "catodon") return "catodon";
  if (soft === "pinetree") return "pinetree";
  if (soft === "mastodon" || soft === "glitch-soc" || soft === "hometown" || soft === "gotosocial") return "mastodon";
  if (soft === "akkoma") return "akkoma";
  if (soft === "pleroma") return "pleroma";
  return "unknown";
}

/** Version-string markers (substring, never a strict parse — Akkoma's
 * format changed across releases). */
export function flavorFromVersion(version: string | null | undefined): ServerFlavor {
  const v = (version ?? "").toLowerCase();
  if (v.includes("akkoma")) return "akkoma";
  if (v.includes("pleroma")) return "pleroma";
  if (v.includes("mastodon") || v.includes("glitch") || v.includes("hometown") || v.includes("gotosocial"))
    return "mastodon";
  if (v.includes("sharkey")) return "sharkey";
  if (v.includes("catodon")) return "catodon";
  if (v.includes("pinetree")) return "pinetree";
  if (v.includes("misskey")) return "misskey";
  return "unknown";
}

/**
 * Combined flavour decision — the generalized `detectFamily`. Priority is
 * the plan's detection order: NodeInfo name first, then response shape,
 * then version markers. Never one substring alone: shape evidence
 * (`pleromaBody`/`pleromaFeatures`) and NodeInfo back each other up, and
 * ambiguous evidence stays "unknown".
 */
export function detectFlavor(evidence: DetectionEvidence): ServerFlavor {
  const fromNodeinfo = flavorFromNodeInfoName(evidence.nodeinfoName);
  if (fromNodeinfo !== "unknown") return fromNodeinfo;

  const pleromaFeatures = evidence.pleromaFeatures ?? [];
  if (evidence.pleromaBody || pleromaFeatures.includes("akkoma_api") || pleromaFeatures.includes("pleroma_api")) {
    return pleromaFeatures.includes("akkoma_api") ? "akkoma" : "pleroma";
  }
  if (evidence.misskeyBody) {
    // Misskey-shaped but unmarked: the version string may still name the
    // fork (Sharkey/Catodon builds sometimes embed it).
    const byVersion = flavorFromVersion(evidence.version);
    return byVersion === "misskey" || byVersion === "sharkey" || byVersion === "catodon" || byVersion === "pinetree"
      ? byVersion
      : "misskey";
  }
  if (evidence.mastodonBody) return "mastodon";

  return flavorFromVersion(evidence.version);
}

// --- Capabilities (three-state, plan §2.1) ---------------------------------

const UNKNOWN_ALL = (): Capabilities => {
  const out = {} as Capabilities;
  for (const key of FEATURE_KEYS) out[key] = "unknown";
  return out;
};

/**
 * Flavor table defaults. Conservative on purpose: verified facts from
 * `docs/api-surface.md` / `docs/mastoapi-contract.md` are "supported" /
 * "unsupported"; anything not verified stays "unknown" — an unknown flag
 * must never unlock a UI affordance. Probe evidence can raise an "unknown"
 * (see `buildCapabilities`) but never silently downgrade a verified fact
 * except where the docs say the feature is absent.
 *
 * `direct_messages` is the one deliberately client-shaped flag: it reads
 * `supported` only on the flavors where Keystone ships the surface
 * (P6.2 slice 2.1: mastodon + akkoma, whose `/api/v1/conversations` is
 * source-verified; P6.2 slice 2.2: misskey + sharkey, whose `chat/*` is
 * verified on upstream develop + live Sharkey) — NOT because other
 * servers lack DMs/chat. Pleroma + catodon are unverified and pinetree
 * has no chat, so those stay `unsupported` with an honest reason; UI
 * reasons name the client gap where the server is not at fault — see
 * `src/lib/messaging.ts`. `chats` is the Misskey-family server-feature
 * fact (supported where the `chat/*` endpoints ship); old stock Misskey
 * releases without them degrade per screen via the 404→unsupported path.
 */
const FLAVOR_FEATURES: Record<ServerFlavor, Partial<Capabilities>> = {
  misskey: {
    mfm: "supported",
    reactions: "supported",
    reaction_acceptance: "supported",
    // Stock Misskey has no `POST notes/like` (unknown path 404s): heart
    // presses fall back to a plain ❤ reaction, never a doomed probe
    // (see `misskey/like.ts`; DECISIONS 2026-10-20 Sharkey line).
    like: "unsupported",
    quote_posting: "supported",
    // `notes/create` poll takes `multiple` (v1 `docs/api-surface.md:67`,
    // verified against Misskey/Sharkey/Pinetree backends).
    polls_multi: "supported",
    // Misskey polls take `multiple` but have no hide-totals switch, and
    // user lists have neither a reply policy nor an exclusive flag.
    polls_hide_totals: "unsupported",
    // v1 shipped `notes/edit` (`frontend/src/misskey/noteEdit.ts`); the
    // menu degrades honestly until the W3 editor connects `onEdit`.
    status_editing: "supported",
    // v1 shipped scheduling (`FloatingComposer` + `schedule.ts`) and the
    // v2 backend implements list/create/delete; the date-picker polish
    // is W3 (C8).
    scheduled_posts: "supported",
    // v1 shipped server drafts (`serverDrafts.ts`); the v2 backend
    // implements list/create/update/delete/count; the UI is W3 (C9).
    server_drafts: "supported",
    local_only: "supported",
    // v1 shipped the per-note control (`Composer.tsx:277,369`) and the wire
    // forwards it on both create (`notes/create`) and edit (`notes/edit`).
    no_quote: "supported",
    // `drive/files/create` takes `isSensitive` per file (Sharkey source:
    // `packages/backend/src/server/api/endpoints/drive/files/create.ts:83`).
    media_sensitivity: "supported",
    drive: "supported",
    antennas: "supported",
    lists: "supported",
    lists_replies_policy: "unsupported",
    lists_exclusive: "unsupported",
    clips: "supported",
    // `channels/*` exists in stock Misskey (verified against the local
    // backend: search/show/timeline/followed/follow/unfollow), and the
    // channel screen + live channel are implemented (clickstone §1.9).
    channels: "supported",
    // `announcements` (public, limit/sinceId/untilId) + `i/read-announcement`
    // are stock Misskey endpoints (verified in the local backend and the
    // reference client's announcements page) — clickstone §1.12.
    announcements: "supported",
    // Chat ships here (upstream `chat/*` on develop; old stock releases
    // without them 404 per screen via the unsupported path).
    chats: "supported",
    direct_messages: "supported",
    // v1 shipped `i/favorites` + `notes/favorites/create|delete`
    // (`frontend/src/misskey/favorites.ts`, `NoteMenu.tsx:490`).
    bookmarks: "supported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  sharkey: {
    mfm: "supported",
    reactions: "supported",
    reaction_acceptance: "supported",
    // Sharkey implements `POST notes/like` (toggle shortcut; kissme spec).
    like: "supported",
    quote_posting: "supported",
    // Same `notes/create` poll `multiple` support as Misskey (v1
    // `docs/api-surface.md:67`).
    polls_multi: "supported",
    // Same Misskey-family poll/list shapes: no `hide_totals`, no list
    // reply policy or exclusive flag.
    polls_hide_totals: "unsupported",
    // Sharkey-family `notes/edit` (same Misskey-family endpoint v1
    // shipped in `noteEdit.ts`).
    status_editing: "supported",
    // Same shipped scheduling + server-draft endpoints as Misskey.
    scheduled_posts: "supported",
    server_drafts: "supported",
    local_only: "supported",
    // Same Misskey-family per-note refusal + per-file Drive sensitivity
    // endpoints as Misskey (both `notes/create|edit` and
    // `drive/files/create` take the fields).
    no_quote: "supported",
    media_sensitivity: "supported",
    drive: "supported",
    antennas: "supported",
    lists: "supported",
    lists_replies_policy: "unsupported",
    lists_exclusive: "unsupported",
    clips: "supported",
    // Same Misskey-family `channels/*` endpoints (Sharkey inherits them).
    channels: "supported",
    // Same Misskey-family `announcements` + `i/read-announcement` endpoints
    // (verified in the local Sharkey checkout's endpoint list).
    announcements: "supported",
    // Same Misskey-family `chat/*` endpoints (live-verified on Sharkey).
    chats: "supported",
    direct_messages: "supported",
    // Same `i/favorites` + `notes/favorites/*` endpoints v1 shipped.
    bookmarks: "supported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  catodon: {
    mfm: "supported",
    reactions: "supported",
    quote_posting: "supported",
    local_only: "supported",
    drive: "supported",
    // Catodon keeps the Misskey-family `users/lists/*` endpoints; their
    // params carry `name` only (no reply policy or exclusive flag), and its
    // poll create has no hide-totals field either.
    lists_replies_policy: "unsupported",
    lists_exclusive: "unsupported",
    polls_hide_totals: "unsupported",
    // Catodon's endpoint list exports `announcements` and
    // `i/read-announcement` (same Misskey-family shapes).
    announcements: "supported",
    direct_messages: "unsupported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "supported",
  },
  // Pinetree gaps verified 404/reject (state/STATE.md "Decisions since
  // stonekey"): no drive/files listing, no antennas, polls rejected, and
  // no Miauth (it uses the native `signin`). `translation: unsupported`
  // is live-probed: `POST :3000/api/meta` answers
  // `translatorAvailable: false` (2026-10-20 session).
  pinetree: {
    mfm: "supported",
    reactions: "supported",
    quote_posting: "supported",
    polls_multi: "unsupported",
    // Polls are rejected outright on this backend (see above), so the
    // hide-totals field has no path either.
    polls_hide_totals: "unsupported",
    local_only: "supported",
    drive: "unsupported",
    antennas: "unsupported",
    // Pinetree's endpoint table has no `announcements` (and its account pack
    // hard-codes `hasUnreadAnnouncement: false`) — a verified absence.
    announcements: "unsupported",
    direct_messages: "unsupported",
    favourites_distinct_from_reactions: "unsupported",
    streaming: "unsupported",
    translation: "unsupported",
    password_grant: "supported",
    mfa_challenge: "unsupported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  mastodon: {
    mfm: "unsupported",
    reactions: "unsupported",
    like: "unsupported",
    polls_multi: "unsupported",
    // `poll[hide_totals]` is permitted and persisted by Mastodon
    // (`statuses_controller.rb` `status_params`, `PostStatusService`,
    // `poll.rb`); the web UI does not expose it, the API does.
    polls_hide_totals: "supported",
    status_editing: "supported",
    scheduled_posts: "supported",
    server_drafts: "unsupported",
    local_only: "unsupported",
    // MastoAPI has no per-note `noQuote` and no per-media sensitive field:
    // statuses take status-level `sensitive` only, and media upload/update
    // accept `description`/`focus` only (Mastodon source:
    // `app/controllers/api/v1/media_controller.rb:52`). Keystone does not
    // send unknown fields (Sharkey/Mastodon 400s).
    no_quote: "unsupported",
    media_sensitivity: "unsupported",
    drive: "unsupported",
    antennas: "unsupported",
    channels: "unsupported",
    // Vanilla Mastodon serves `GET /api/v1/announcements` and
    // `POST /api/v1/announcements/:id/dismiss` (both routes verified in the
    // local checkout); index requires a user, dismiss `write:accounts`.
    announcements: "supported",
    chats: "unsupported",
    lists: "supported",
    lists_replies_policy: "supported",
    lists_exclusive: "supported",
    bookmarks: "supported",
    clips: "unsupported",
    // P6.2 ships the DM inbox on vanilla Mastodon (`ConversationsController`
    // + `REST::ConversationSerializer`, verified in the local checkout).
    direct_messages: "supported",
    favourites_distinct_from_reactions: "supported",
    streaming: "supported",
    password_grant: "unsupported",
    mfa_challenge: "unsupported",
    pkce: "supported",
    miauth: "unsupported",
  },
  akkoma: {
    mfm: "supported",
    reactions: "supported",
    like: "unsupported",
    status_editing: "supported",
    local_only: "supported",
    // Same MastoAPI shapes as Mastodon: status-level quoted-status handling
    // only, and no per-media `sensitive` field.
    no_quote: "unsupported",
    media_sensitivity: "unsupported",
    lists: "supported",
    // Akkoma/Pleroma lists carry `exclusive` (`Pleroma.List`
    // `update_changeset` casts it, `ListView` renders it) but no reply
    // policy: the create/update request schema permits `title` + `exclusive`
    // only, and the changeset has no such field. Polls: `hide_totals` is in
    // the OpenAPI spec but `make_poll_data/1` never stores it — a no-op, so
    // the flag is unsupported and the field is never sent.
    lists_replies_policy: "unsupported",
    lists_exclusive: "supported",
    polls_hide_totals: "unsupported",
    // Pleroma/Akkoma both serve the Mastodon API announcement pair
    // (`MastodonAPI.AnnouncementController#index/#mark_read`).
    announcements: "supported",
    clips: "unsupported",
    // P6.2 ships the inbox on Akkoma too (`ConversationController` index/
    // read/delete on `/api/v1/conversations` + the Mastodon-shaped
    // `participation.json` view, verified in the local 3.20.1 checkout).
    direct_messages: "supported",
    favourites_distinct_from_reactions: "supported",
    // No static translation claim: Akkoma only translates when the admin
    // enables a machine-translation backend, advertised as the
    // `akkoma:machine_translation` feature flag (live 2026-10-21: the rig
    // Akkoma has no such flag and `POST .../translate` 403s "Translation
    // is not enabled"). An unknown flag unlocks nothing; the flag below
    // raises it where the server actually offers it.
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "supported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  pleroma: {
    status_editing: "supported",
    reactions: "supported",
    like: "unsupported",
    // Same Pleroma list/poll shapes as Akkoma (both live in the shared
    // `Pleroma.*` modules): `exclusive` only, no reply policy, and no
    // stored `hide_totals`.
    lists_exclusive: "supported",
    lists_replies_policy: "unsupported",
    polls_hide_totals: "unsupported",
    // Same Pleroma MastodonAPI announcement controller as Akkoma.
    announcements: "supported",
    no_quote: "unsupported",
    media_sensitivity: "unsupported",
    favourites_distinct_from_reactions: "supported",
    clips: "unsupported",
    // Pleroma proper is unverified for `/api/v1/conversations` (only
    // Akkoma's fork was checked) — stays gated, never unlocked on a guess.
    direct_messages: "unsupported",
    local_only: "supported",
    streaming: "supported",
    password_grant: "supported",
    mfa_challenge: "supported",
    pkce: "unsupported",
    miauth: "unsupported",
  },
  unknown: {},
};

/** Evidence-derived overrides (contract §9 for the Pleroma/Akkoma feature
 * flags). Evidence can only raise from "unknown" or contradict the table
 * where the server itself is authoritative. */
export function buildCapabilities(
  flavor: ServerFlavor,
  evidence: DetectionEvidence = {},
): Capabilities {
  const out: Capabilities = { ...UNKNOWN_ALL(), ...FLAVOR_FEATURES[flavor] };
  const has = (flag: string) => (evidence.pleromaFeatures ?? []).includes(flag);

  if (has("pleroma_emoji_reactions") || has("exposable_reactions")) {
    out.reactions = "supported";
  }
  if (has("quote_posting")) out.quote_posting = "supported";
  // Vanilla Mastodon gained quote posting in 4.5.
  if (flavor === "mastodon" && typeof evidence.version === "string") {
    const m = evidence.version.match(/^(\d+)\.(\d+)/);
    if (m && (Number(m[1]) > 4 || (Number(m[1]) === 4 && Number(m[2]) >= 5))) {
      out.quote_posting = "supported";
    }
  }
  if (has("editing")) out.status_editing = "supported";
  // Akkoma's machine-translation flag is Mastodon-family evidence too: it
  // arrives in `pleroma.metadata.features`, which only a Mastodon-family
  // instance body carries. Never let it raise a Misskey-family flavor.
  const family = familyOf(flavor);
  if (family === "mastodon" && has("akkoma:machine_translation")) {
    out.translation = "supported";
  }

  // Family-scoped evidence (clickstone §0.4). Each family's translation
  // fact lives on a different endpoint and the two must never cross:
  //   Mastodon family → `configuration.translation.enabled` (v1/v2
  //                     instance body, `translationAdvertised`);
  //   Misskey family  → `meta.translatorAvailable`.
  // A flag handed to the wrong family is ignored — never silently applied
  // — and an undetected flavor (`familyOf` null) ignores both, so unknown
  // stays unknown and unlocks nothing.
  //
  // Instance-level advertisement (Mastodon-family), when a probed body
  // carried it. Authoritative where present: an explicit false means the
  // server turned translation off, not that the probe missed it.
  if (family === "mastodon" && typeof evidence.translationAdvertised === "boolean") {
    out.translation = evidence.translationAdvertised ? "supported" : "unsupported";
  }

  // Meta-level hint (Misskey-family `translatorAvailable`, when present).
  if (family === "misskey" && typeof evidence.translatorAvailable === "boolean") {
    out.translation = evidence.translatorAvailable ? "supported" : "unsupported";
  }
  return out;
}

// --- Probing ---------------------------------------------------------------

export interface ProbeResponse {
  status: number;
  body: unknown;
}

export type Prober = (
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) => Promise<ProbeResponse>;

export interface DetectOptions {
  prober?: Prober;
  timeoutMs?: number;
}

export interface ServerDetection {
  /** null when no evidence placed the server in either family. */
  family: ServerFamily | null;
  flavor: ServerFlavor;
  /** Best-known version string (NodeInfo or probe), or null. */
  version: string | null;
  features: Capabilities;
  /** Which source decided the flavor (for diagnostics/tests). */
  decidedBy: "nodeinfo" | "probe-shape" | "version" | "none";
  /** The collected probe evidence (kept so sessions can recompute
   * capabilities from the current flavor table later). */
  evidence: DetectionEvidence;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Misskey-family `/api/meta` body markers (shape, not one field alone). */
export function looksMisskey(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return (
    typeof body.maxNoteTextLength === "number" ||
    typeof body.maintainerName === "string" ||
    ("name" in body && "uri" in body && !("domain" in body) && !("configuration" in body))
  );
}

/** Mastodon-family instance body markers (v1 or v2). */
export function looksMastodon(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return (
    "domain" in body ||
    "configuration" in body ||
    "pleroma" in body ||
    "max_toot_chars" in body
  );
}

export function pleromaFeaturesOf(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  const pleroma = body.pleroma;
  if (!isPlainObject(pleroma)) return [];
  const metadata = pleroma.metadata;
  if (!isPlainObject(metadata)) return [];
  const features = metadata.features;
  return Array.isArray(features)
    ? features.filter((f): f is string => typeof f === "string")
    : [];
}

function versionOf(body: unknown): string | null {
  if (!isPlainObject(body)) return null;
  return typeof body.version === "string" && body.version.length > 0 ? body.version : null;
}

/** Mastodon-family `configuration.translation.enabled` (v1 or v2 instance
 * body), or null when the body does not advertise it. Pure. */
export function translationEnabledOf(body: unknown): boolean | null {
  if (!isPlainObject(body)) return null;
  const configuration = body.configuration;
  if (!isPlainObject(configuration)) return null;
  const translation = configuration.translation;
  if (!isPlainObject(translation)) return null;
  return typeof translation.enabled === "boolean" ? translation.enabled : null;
}

/** Mastodon-family instance fetch: GET v2, fall back to v1 on 404/405
 * ONLY (never on timeout/401/403/5xx). Returns the first body that
 * arrives, or null. Pure probe plumbing. */
async function fetchInstance(prober: Prober, origin: string): Promise<unknown> {
  const v2 = await prober("GET", `${origin}/api/v2/instance`);
  if (v2.status === 200) return v2.body;
  if (v2.status === 404 || v2.status === 405) {
    const v1 = await prober("GET", `${origin}/api/v1/instance`);
    if (v1.status === 200) return v1.body;
  }
  return null;
}

/** NodeInfo secondary source: discovery document → 2.1 (or last) link. Only
 * same-origin hrefs are followed. Tolerant — null on any failure. */
async function fetchNodeinfo(
  origin: string,
  prober: Prober,
): Promise<{ name: string | null; version: string | null; body: unknown } | null> {
  const disco = await prober("GET", `${origin}/.well-known/nodeinfo`);
  if (disco.status !== 200 || !isPlainObject(disco.body)) return null;
  const links = Array.isArray(disco.body.links) ? disco.body.links : [];
  const preferred =
    links.find(
      (l) => isPlainObject(l) && typeof l.rel === "string" && l.rel.includes("/2.1"),
    ) ?? links[links.length - 1];
  const href = isPlainObject(preferred) ? preferred.href : null;
  if (typeof href !== "string") return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return null; // never follow a cross-origin href
  const doc = await prober("GET", url.toString());
  if (doc.status !== 200 || !isPlainObject(doc.body)) return null;
  const software = doc.body.software;
  const name = isPlainObject(software) && typeof software.name === "string" ? software.name : null;
  const version =
    isPlainObject(software) && typeof software.version === "string" ? software.version : null;
  return { name, version, body: doc.body };
}

async function defaultProber(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  timeoutMs = 8_000,
): Promise<ProbeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      credentials: "omit",
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: ctrl.signal,
    });
    const raw = res.status === 204 ? "" : await res.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detect family + flavor + capabilities for `origin`. Never throws: probes
 * that fail simply contribute no evidence (a timeout is never evidence of
 * absence), and an unreachable server reports flavor "unknown".
 */
export async function detectServer(
  origin: string,
  opts: DetectOptions = {},
): Promise<ServerDetection> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const prober: Prober =
    opts.prober ?? ((method, url, body) => defaultProber(method, url, body, timeoutMs));

  const evidence: DetectionEvidence = {
    nodeinfoName: null,
    nodeinfoVersion: null,
    version: null,
    pleromaBody: false,
    pleromaFeatures: [],
    misskeyBody: false,
    mastodonBody: false,
  };

  // 1. NodeInfo software.name first.
  const nodeinfo = await fetchNodeinfo(origin, prober);
  if (nodeinfo) {
    evidence.nodeinfoName = nodeinfo.name;
    evidence.nodeinfoVersion = nodeinfo.version;
    const nodeinfoFeatures = pleromaFeaturesOf(nodeinfo.body);
    if (nodeinfoFeatures.length > 0) evidence.pleromaFeatures = nodeinfoFeatures;
  }
  const nodeinfoFlavor = flavorFromNodeInfoName(evidence.nodeinfoName);

  // 2. Family probe — needed for shape evidence and version when NodeInfo
  //    did not decide (or was absent).
  if (nodeinfoFlavor === "unknown") {
    // Misskey-family probe first: `POST /api/meta` is public on every
    // Misskey-family server; elsewhere it 404s and costs one request.
    const meta = await prober("POST", `${origin}/api/meta`, {});
    if (meta.status === 200 && looksMisskey(meta.body)) {
      evidence.misskeyBody = true;
      evidence.version = versionOf(meta.body);
      const translator = (meta.body as { translatorAvailable?: unknown }).translatorAvailable;
      evidence.translatorAvailable = typeof translator === "boolean" ? translator : null;
    } else {
      // Mastodon-family probe: v2 → v1 fallback on 404/405 ONLY (never on
      // timeout/401/403/5xx — see the header comment).
      const instanceBody = await fetchInstance(prober, origin);
      if (instanceBody !== null && looksMastodon(instanceBody)) {
        evidence.mastodonBody = true;
        evidence.version = versionOf(instanceBody);
        evidence.pleromaBody = isPlainObject(instanceBody) && "pleroma" in instanceBody;
        evidence.pleromaFeatures = pleromaFeaturesOf(instanceBody);
        evidence.translationAdvertised = translationEnabledOf(instanceBody);
      }
    }
  } else {
    evidence.version = evidence.nodeinfoVersion;
    // NodeInfo named the software but carries no translation signal, and
    // the flag the table needs lives on the family endpoint: a
    // translation-capable server decided here would otherwise keep the
    // conservative "unknown" forever (E6: the rig Akkoma proved the
    // static claim wrong, so the probe is the only honest source).
    const family = familyOf(nodeinfoFlavor);
    if (family === "misskey") {
      const meta = await prober("POST", `${origin}/api/meta`, {});
      if (meta.status === 200 && looksMisskey(meta.body)) {
        const translator = (meta.body as { translatorAvailable?: unknown }).translatorAvailable;
        evidence.translatorAvailable = typeof translator === "boolean" ? translator : null;
      }
    } else if (family === "mastodon") {
      const instanceBody = await fetchInstance(prober, origin);
      if (instanceBody !== null && looksMastodon(instanceBody)) {
        evidence.mastodonBody = true;
        evidence.pleromaBody = isPlainObject(instanceBody) && "pleroma" in instanceBody;
        evidence.pleromaFeatures = pleromaFeaturesOf(instanceBody);
        evidence.translationAdvertised = translationEnabledOf(instanceBody);
      }
    }
  }

  // 3. Heuristics over the collected evidence.
  const flavor = detectFlavor(evidence);
  const decidedBy: ServerDetection["decidedBy"] =
    nodeinfoFlavor !== "unknown"
      ? "nodeinfo"
      : evidence.misskeyBody || evidence.mastodonBody || evidence.pleromaBody
        ? "probe-shape"
        : flavor !== "unknown"
          ? "version"
          : "none";

  return {
    family: familyOf(flavor) ?? (evidence.misskeyBody ? "misskey" : evidence.mastodonBody ? "mastodon" : null),
    flavor,
    version: evidence.version ?? evidence.nodeinfoVersion ?? null,
    features: buildCapabilities(flavor, evidence),
    decidedBy,
    evidence,
  };
}
