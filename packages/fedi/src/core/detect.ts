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

import { defaultFetchImpl, isRedirectStatus, type FetchImpl } from "./http";

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
  // Misskey-family Pages (P6.5): reader + editor. `pages_own_lists`
  // covers `i/pages` + `i/page-likes` (Pinetree 404s both).
  | "pages"
  | "pages_own_lists"
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
  // Filtered notification requests + filter policy (Mastodon 4.3+,
  // repair X4.5). Probe-backed ONLY: no flavor row below seeds it, so it
  // reads "unknown" until a real requests/policy call caches a per-origin
  // verdict (the `like.ts` pattern) — a flavor label never proves a
  // backport absent or present.
  | "notification_requests"
  // Drive sort + bulk-move (P6.6 DC-7): newer upstream; probed once per
  // origin and cached (the `like.ts` pattern). Default unknown for every
  // flavor; no flavor row below seeds them.
  | "drive_sort"
  | "drive_move_bulk"
  // Server services
  | "translation"
  | "streaming"
  // Auth
  | "password_grant"
  | "mfa_challenge"
  | "pkce"
  | "miauth"
  // Server insight (Wave 3, clickstone §3.1 — read-only first). `admin_read`
  // gates the measures/dimensions reads; `admin_write` gates every future
  // admin mutation (Wave 3.2+, never this slice). BOTH default to "unknown"
  // in every flavor row below: detect.ts never infers a role — the
  // viewer's admin/moderator role comes from verify_credentials
  // (`is_admin`/`is_moderator`, `role`) at the backend/session layer, and
  // a 403 on an admin call disables the section with a reason instead of
  // flipping a flag.
  | "admin_read"
  | "admin_write";

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
  "pages",
  "pages_own_lists",
  "channels",
  "announcements",
  "chats",
  "direct_messages",
  "lists",
  "lists_replies_policy",
  "lists_exclusive",
  "bookmarks",
  "favourites_distinct_from_reactions",
  "notification_requests",
  "drive_sort",
  "drive_move_bulk",
  "translation",
  "streaming",
  "password_grant",
  "mfa_challenge",
  "pkce",
  "miauth",
  "admin_read",
  "admin_write",
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
  /** Misskey-family `notes/edit` presence from an endpoint probe (X5.4):
   * `true` = a real 4xx param/auth rejection proved the route exists;
   * `false` = a real 404/`UNKNOWN_API_ENDPOINT` proved it absent;
   * `null`/absent = unprobed — the capability stays `unknown` and unlocks
   * nothing. Recorded by `probeMisskeyEndpoint`, never by a failed user
   * action. Misskey family only; ignored elsewhere. */
  notesEditAvailable?: boolean | null;
  /** Same probe verdict for `notes/schedule/*` (capability
   * `scheduled_posts`). Misskey family only. */
  scheduledAvailable?: boolean | null;
  /** Same probe verdict for `notes/drafts/*` (capability `server_drafts`).
   * Misskey family only. */
  serverDraftsAvailable?: boolean | null;
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
    // No static `like` seed: `misskey/like.ts` probes `notes/like` once per
    // origin and caches a real 404 absence — a flavor label cannot prove a
    // backport absent. Unknown unlocks nothing; the first press probes.
    quote_posting: "supported",
    // `notes/create` poll takes `multiple` (v1 `docs/api-surface.md:67`,
    // verified against Misskey/Sharkey/Pinetree backends).
    polls_multi: "supported",
    // Misskey polls take `multiple` but have no hide-totals switch, and
    // user lists have neither a reply policy nor an exclusive flag.
    polls_hide_totals: "unsupported",
    // Stock Misskey is honest-unknown for editing, scheduling and server
    // drafts (upstream has no `notes/edit`; scheduling/drafts are
    // unverified on stock). Never rely on a failing call for gating: the
    // Edit/schedule/draft controls stay hidden until an endpoint probe
    // records `notesEditAvailable`/`scheduledAvailable`/
    // `serverDraftsAvailable` evidence (see `probeMisskeyEndpoint`), which
    // `buildCapabilities` raises to `supported`. Sharkey keeps the
    // supported verdicts below (verified Sharkey-family endpoints).
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
    // P6.5 Pages: full `pages/*` + `users/pages` + `i/pages` +
    // `i/page-likes` surface (docs/pages-clips.md §4).
    pages: "supported",
    pages_own_lists: "supported",
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
    // Same Misskey-family Pages surface (docs/pages-clips.md §4).
    pages: "supported",
    pages_own_lists: "supported",
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
    // Pinetree serves Pages (`pages/*`, `users/pages`, `i/update` pin)
    // but 404s the own-lists (`i/pages`, `i/page-likes`).
    pages: "supported",
    pages_own_lists: "unsupported",
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
    // `poll[multiple]` is a documented Mastodon parameter and
    // `statusBodyOf` (compose.ts) already sends it (finding 6), so the
    // multi-choice toggle is on here. Akkoma/Pleroma have no table entry:
    // they stay "unknown" (honest, no fixture proof either way).
    polls_multi: "supported",
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
    pages: "unsupported",
    pages_own_lists: "unsupported",
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
    pages: "unsupported",
    pages_own_lists: "unsupported",
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
    pages: "unsupported",
    pages_own_lists: "unsupported",
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

  // Endpoint-probe verdicts (Misskey family only, X5.4). The table above
  // leaves editing/scheduling/server-drafts `unknown` on stock `misskey`;
  // a decisive probe (`probeMisskeyEndpoint`) raises or lowers them here.
  // A decisive absence is server-authoritative (same as the translation
  // explicit-false above); anything else never touches a verified table
  // fact, and other families ignore these flags entirely.
  if (family === "misskey") {
    if (evidence.notesEditAvailable === true) out.status_editing = "supported";
    else if (evidence.notesEditAvailable === false) out.status_editing = "unsupported";
    if (evidence.scheduledAvailable === true) out.scheduled_posts = "supported";
    else if (evidence.scheduledAvailable === false) out.scheduled_posts = "unsupported";
    if (evidence.serverDraftsAvailable === true) out.server_drafts = "supported";
    else if (evidence.serverDraftsAvailable === false) out.server_drafts = "unsupported";
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
  /** Injectable fetch for the default prober (tests pin URLs; production
   * flows from the core/http seam edge). */
  fetchImpl?: FetchImpl;
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

/** Hops the unauthenticated prober follows for a same-origin 3xx. */
const PROBE_MAX_REDIRECTS = 3;

async function defaultProber(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  timeoutMs = 8_000,
  fetchImpl: FetchImpl = defaultFetchImpl,
): Promise<ProbeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let baseOrigin: string;
  try {
    baseOrigin = new URL(url).origin;
  } catch {
    clearTimeout(timer);
    return { status: 0, body: null };
  }
  try {
    let current = url;
    for (let hop = 0; hop <= PROBE_MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(current, {
        credentials: "omit",
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        // Unauthenticated discovery may follow same-origin redirects ONLY
        // (repair X2.2 step 1): `manual` plus an origin re-check per hop,
        // so a compromised instance cannot bounce the prober elsewhere.
        redirect: "manual",
        signal: ctrl.signal,
      });
      if (isRedirectStatus(res.status)) {
        const location = res.headers.get("location");
        let next: string | null = null;
        if (location) {
          try {
            next = new URL(location, current).toString();
          } catch {
            next = null;
          }
        }
        // Cross-origin (or location-less, or over-budget) redirects are
        // evidence of nothing: stop and report the 3xx with no body.
        if (!next || hop === PROBE_MAX_REDIRECTS) return { status: res.status, body: null };
        let nextOrigin: string;
        try {
          nextOrigin = new URL(next).origin;
        } catch {
          return { status: res.status, body: null };
        }
        if (nextOrigin !== baseOrigin) return { status: res.status, body: null };
        current = next;
        continue;
      }
      // A fetch implementation that ignored `manual` must not leak the
      // prober cross-origin either: re-validate the landed URL.
      if (typeof res.url === "string" && res.url) {
        try {
          if (new URL(res.url, current).origin !== baseOrigin) {
            return { status: res.status, body: null };
          }
        } catch {
          return { status: res.status, body: null };
        }
      }
      // The body read stays INSIDE the deadline (repair X2.2 step 3).
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
    }
    return { status: 0, body: null };
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
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;
  const prober: Prober =
    opts.prober ?? ((method, url, body) => defaultProber(method, url, body, timeoutMs, fetchImpl));

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

// --- Misskey-family endpoint probes (X5.4) ---------------------------------

/** Misskey error envelope shape (`{error: {code, ...}}`), read tolerantly. */
function misskeyErrorCode(body: unknown): string | null {
  if (!isPlainObject(body)) return null;
  const error = body.error;
  if (!isPlainObject(error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/**
 * Interpret one unauthenticated endpoint probe (`POST /api/<path>` with
 * `{}`). Misskey routes before it authenticates, so the status alone
 * separates presence from absence:
 * - 404 or `UNKNOWN_API_ENDPOINT` (any status): the route is absent.
 * - any other 4xx (400 param errors, 401/403 credential errors): the route
 *   exists — it rejected the empty/unauthenticated call instead of 404ing.
 * - anything else (timeout/0, 5xx, unexpected 2xx): no evidence either way.
 * Pure — the verdict feeds `DetectionEvidence` (`notesEditAvailable` etc.)
 * and `buildCapabilities` raises the capability from there.
 */
export function interpretEndpointProbe(status: number, body: unknown): boolean | null {
  if (status === 404 || misskeyErrorCode(body) === "UNKNOWN_API_ENDPOINT") return false;
  if (status === 400 || status === 401 || status === 403 || status === 422) return true;
  return null;
}

/**
 * Probe one Misskey-family endpoint's presence without credentials
 * (`POST ${origin}/api/${apiPath}` with `{}`), e.g. `notes/edit`,
 * `notes/schedule/list`, `notes/drafts/count`. Returns the
 * `interpretEndpointProbe` verdict, or null when the probe itself failed.
 * Never throws. Call post-login from the session layer and recompute via
 * `buildCapabilities(flavor, {...evidence, notesEditAvailable: verdict})` —
 * `detectServer` does not call this itself (its prober is unauthenticated
 * discovery; capability refresh belongs to the authenticated session).
 */
export async function probeMisskeyEndpoint(
  prober: Prober,
  origin: string,
  apiPath: string,
): Promise<boolean | null> {
  try {
    const res = await prober("POST", `${origin}/api/${apiPath}`, {});
    return interpretEndpointProbe(res.status, res.body);
  } catch {
    return null;
  }
}
