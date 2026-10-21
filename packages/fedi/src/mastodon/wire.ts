// Mastodon-family wire types — field names EXACTLY as they appear on the
// wire (snake_case), per docs/mastoapi-contract.md §6. Verified against
// Mastodon 4.8.0-alpha.3 and Akkoma 3.20.1 source checkouts; Akkoma
// extensions (pleroma.*, akkoma.*, emoji_reactions, quote) are carried as
// optional fields so the adapter stays reaction-transparent from day one.
//
// Rules:
// - IDs are ALWAYS opaque strings (Akkoma uses 128-bit flake IDs — never
//   Number/parseInt, never numerically sorted).
// - Absent/unknown data is `null` or a missing optional key — never a
//   stringified "undefined".
// - `content`/`note` are HTML from the server (contract §7) — rendering
//   through the sanitizer, not MFM, unless the MFM setting is on.
// - Unknown/newer fields must be tolerated by readers; never require them.

/** Opaque wire identifier. Strings on every backend. */
export type ID = string;

/**
 * Mastodon-family visibility values as composable options. The wire field
 * itself is typed `string` below because servers report values outside this
 * set (Mastodon's internal `limited` — rendered as `private`; Akkoma's
 * extra `local`). Compose sends only values the target advertises
 * (contract §6), never `list:` on Akkoma.
 */
export type KnownVisibility = "public" | "unlisted" | "local" | "private" | "direct";

// --- Accounts -------------------------------------------------------------

/** Profile field (`fields[]`). `verified_at` is null when unverified. */
export interface AccountField {
  name: string;
  value: string;
  verified_at: string | null;
}

/** Emoji reference packed on an Account (subset of CustomEmoji). */
export interface AccountEmoji {
  shortcode: string;
  url: string;
  static_url: string;
}

/** Akkoma/Pleroma account extras (`account.pleroma.*`). Loose on purpose. */
export interface PleromaAccountExtras {
  email?: string | null;
  hostname?: string | null;
  banner_url?: string | null;
  background_image_url?: string | null;
  is_admin?: boolean;
  is_moderator?: boolean;
  confirmation_pending?: boolean;
  default_scope?: string;
  settings_store?: unknown;
  no_rich_text?: boolean;
  show_role?: boolean;
  actor_type?: string;
  discoverable?: boolean;
  tags?: string[];
  relationship?: unknown;
  [key: string]: unknown;
}

/**
 * Mastodon `Account` (contract §6). Conditional fields (`suspended`,
 * `limited`, `moved`, `roles`, `noindex`) are Mastodon-only; Akkoma
 * instead adds top-level `fqn` and `pleroma.*` and lacks
 * `discoverable`/`suspended`/`moved`/`roles` — hence optional everywhere.
 */
export interface Account {
  id: ID;
  username: string;
  acct: string;
  display_name: string;
  locked: boolean;
  bot: boolean;
  discoverable?: boolean | null;
  group?: boolean;
  created_at: string;
  /** HTML from the server. */
  note: string;
  url: string;
  uri?: string;
  avatar: string | null;
  avatar_static: string | null;
  header: string | null;
  header_static: string | null;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  last_status_at?: string | null;
  hide_collections?: boolean | null;
  noindex?: boolean | null;
  emojis?: AccountEmoji[];
  fields: AccountField[];
  // Mastodon-only conditionals (absent on Akkoma — never assume).
  suspended?: boolean;
  limited?: boolean | null;
  moved?: Account | null;
  roles?: string[];
  // Akkoma-only additions.
  fqn?: string;
  pleroma?: PleromaAccountExtras;
  akkoma?: Record<string, unknown>;
}

/**
 * `GET /api/v1/accounts/verify_credentials` result: an Account plus
 * backend-specific extras — Mastodon adds `source{privacy, sensitive,
 * language, note, fields, follow_requests_count, quote_policy, …}`,
 * `state`, `role`; Akkoma adds `pleroma.settings_store` and owner-only
 * extras. Typed as Account + loose extras so self-only fields survive.
 */
export interface CredentialAccount extends Account {
  source?: {
    privacy?: string;
    sensitive?: boolean;
    language?: string | null;
    note?: string;
    fields?: AccountField[];
    follow_requests_count?: number;
    quote_policy?: Record<string, unknown> | null;
    pleroma?: Record<string, unknown>;
    [key: string]: unknown;
  };
  state?: string | null;
  role?: string | null;
}

// --- Statuses -------------------------------------------------------------

export interface Mention {
  id: ID;
  username: string;
  acct: string;
  url: string;
}

export interface TagHistoryEntry {
  account_id: ID;
  uses: number;
  day: string;
}

export interface Tag {
  name: string;
  url: string;
  history?: TagHistoryEntry[] | null;
}

/** `GET /api/v2/suggestions` row: `{source, account}` (v1 is the bare
 * account array, deprecated — unused). */
export interface Suggestion {
  source?: string;
  account: Account;
}

export interface PreviewCard {
  url: string;
  title: string;
  description: string;
  image: string | null;
  type: string;
  author_name?: string;
  author_url?: string;
  provider_name?: string | null;
  provider_url?: string | null;
  html?: string;
  width?: number | null;
  height?: number | null;
  embed_url?: string;
  blurhash?: string | null;
  authors?: Array<Record<string, unknown>>;
}

export interface MediaMeta {
  original?: { width?: number; height?: number };
  small?: { width?: number; height?: number };
  focus?: { x: number; y: number };
  [key: string]: unknown;
}

export interface MediaAttachment {
  id: ID;
  /** image | gifv | video | audio | unknown */
  type: string;
  /** Null while processing on Mastodon media v2 (contract §4). */
  url: string | null;
  preview_url: string | null;
  remote_url?: string | null;
  text_url?: string | null;
  meta?: MediaMeta | null;
  description?: string | null;
  blurhash?: string | null;
  /** Akkoma extension (`pleroma.mime_type`). */
  pleroma?: { mime_type?: string | null; [key: string]: unknown };
}

export interface PollOption {
  title: string;
  votes_count: number | null;
}

export interface Poll {
  id: ID;
  expires_at: string | null;
  expired: boolean;
  multiple: boolean;
  votes_count: number;
  /** Null for single-choice polls on Akkoma. */
  voters_count: number | null;
  options: PollOption[];
  emojis?: AccountEmoji[];
  /** Auth-only. */
  voted?: boolean;
  own_votes?: number[];
}

/**
 * Akkoma/Pleroma emoji-reaction extension (contract §4/§9). The wire
 * carries an ARRAY (one entry per emoji), not a map.
 */
export interface EmojiReaction {
  name: string;
  count: number;
  url?: string | null;
  me: boolean;
  account_ids?: ID[];
}

/** Mastodon 4.5+ quote object: `{state, quoted_status}`. */
export interface MastodonQuoteState {
  state?: string | null;
  quoted_status?: Status | null;
  [key: string]: unknown;
}

/**
 * The `quote` field differs per backend (contract §6): Mastodon nests
 * `{state, quoted_status}`; Akkoma nests the quoted Status ITSELF (state
 * "accepted"). Readers must handle both shapes — never assume one.
 */
export type QuoteField = MastodonQuoteState | Status | null;

export interface StatusFilterResult {
  filter: { id: ID; title: string; filter_action: string; [key: string]: unknown };
  keywords?: Array<{ id: ID; keyword: string; whole_word?: boolean }>;
  status_ids?: ID[];
  [key: string]: unknown;
}

/**
 * Mastodon-family `Status` (contract §6). Auth-only flags (`favourited`,
 * `reblogged`, `muted`, `bookmarked`, `pinned`, `filtered`) are absent on
 * unauthenticated fetches. Akkoma extras: `emoji_reactions[]`,
 * `pleroma.*`, `akkoma.*`, `quote_id`. Reblog wrappers on Akkoma have
 * empty content and zeroed counts — always render `reblog.reblog`.
 */
export interface Status {
  id: ID;
  created_at: string;
  in_reply_to_id: ID | null;
  in_reply_to_account_id: ID | null;
  sensitive: boolean;
  spoiler_text: string;
  /** Raw wire value: use KnownVisibility for composing, normalize on read. */
  visibility: string;
  language: string | null;
  uri: string;
  url: string | null;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  quotes_count?: number;
  edited_at: string | null;
  account: Account;
  /** HTML from the server. */
  content: string;
  reblog?: Status | null;
  media_attachments: MediaAttachment[];
  mentions: Mention[];
  tags: Tag[];
  emojis?: AccountEmoji[];
  card?: PreviewCard | null;
  poll?: Poll | null;
  application?: { name: string; website?: string | null; [key: string]: unknown } | null;
  // Auth-only state.
  favourited?: boolean;
  reblogged?: boolean;
  muted?: boolean;
  bookmarked?: boolean;
  pinned?: boolean;
  filtered?: StatusFilterResult[];
  // Quote support (M 4.5+ / A `quote_posting`).
  quote?: QuoteField;
  quote_id?: ID | null;
  // Pleroma/Akkoma emoji-reaction extension — carried through untouched
  // (owner directive: the reaction layer is KEPT, gate on support).
  emoji_reactions?: EmojiReaction[];
  pleroma?: Record<string, unknown>;
  akkoma?: Record<string, unknown>;
}

// --- Notifications --------------------------------------------------------

/**
 * `type` is an EXTENSIBLE string (contract §6/§7): render unknown types
 * via a generic row. Mastodon ships 17 types, Akkoma a different set
 * (`pleroma:emoji_reaction`, `move`, `pleroma:report`, …) — never freeze
 * the list.
 */
export interface Notification {
  id: ID;
  type: string;
  created_at: string;
  account?: Account | null;
  status?: Status | null;
  report?: Record<string, unknown> | null;
  event?: string | null;
  /** Mastodon `fallback` text when `supported_types[]` filtering is used. */
  fallback?: string | null;
  /** Pleroma/Akkoma `pleroma:emoji_reaction` rows carry the emoji here. */
  emoji?: string | null;
  /** Akkoma extras. */
  pleroma?: { is_seen?: boolean; is_muted?: boolean; [key: string]: unknown };
}

// --- Relationships --------------------------------------------------------

/** Contract §6 field list; Akkoma adds `requested_by`/`subscribing`. */
export interface Relationship {
  id: ID;
  following: boolean;
  followed_by: boolean;
  blocking: boolean;
  blocked_by: boolean;
  muting: boolean;
  muting_notifications: boolean;
  requested: boolean;
  requested_by?: boolean;
  domain_blocking: boolean;
  showing_reblogs: boolean;
  endorsing?: boolean;
  endorsed?: boolean;
  note?: string | null;
  subscribing?: boolean;
}

// --- Instance metadata ----------------------------------------------------

export interface InstanceV2Configuration {
  statuses?: {
    max_characters?: number;
    max_media_attachments?: number;
    characters_reserved_per_url?: number;
  };
  media_attachments?: {
    image_size_limit?: number;
    video_size_limit?: number;
    supported_mime_types?: string[];
  };
  polls?: Record<string, unknown>;
  translation?: { enabled?: boolean };
  accounts?: Record<string, unknown>;
  urls?: { streaming?: string | null };
  [key: string]: unknown;
}

/** `GET /api/v2/instance` (Mastodon 4.0+; ABSENT on Akkoma — 404). */
export interface InstanceV2 {
  domain: string;
  title: string;
  version: string;
  source_url?: string;
  description?: string;
  usage?: { users?: { active_month?: number } };
  api_versions?: Record<string, number>;
  configuration?: InstanceV2Configuration;
  registrations?: { enabled?: boolean; approval_required?: boolean };
  [key: string]: unknown;
}

export interface InstanceV1PleromaMetadata {
  features?: string[];
  [key: string]: unknown;
}

/** `GET /api/v1/instance` (deprecated on Mastodon, canonical on Akkoma). */
export interface InstanceV1 {
  uri: string;
  title: string;
  version: string;
  description?: string;
  stats?: {
    user_count?: number;
    status_count?: number;
    domain_count?: number;
    remote_user_count?: number;
  };
  /** Mastodon 4.x keeps configuration in v1 too; Akkoma has none. */
  configuration?: InstanceV2Configuration;
  max_toot_chars?: number;
  poll_limits?: Record<string, number>;
  upload_limit?: number;
  description_limit?: number;
  urls?: { streaming_api?: string | null };
  pleroma?: { metadata?: InstanceV1PleromaMetadata; vapid_public_key?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** NodeInfo 2.x secondary detection source (contract §3). */
export interface NodeInfoSoftware {
  name: string;
  version: string;
}

export interface NodeInfo {
  software?: NodeInfoSoftware;
  metadata?: { features?: unknown; publicTimelineVisibility?: string; [key: string]: unknown };
  [key: string]: unknown;
}

// --- Scheduled statuses -----------------------------------------------------

/**
 * `GET /api/v1/scheduled_statuses` row (contract §4). `params` carries the
 * compose payload (text, spoiler_text, visibility, media_ids, poll, …);
 * `media_attachments` carries the already-uploaded attachments so a
 * preview can render without re-uploading. Both are absent on servers
 * that pack only `{id, scheduled_at}`.
 */
export interface ScheduledStatus {
  id: ID;
  scheduled_at: string;
  params?: {
    text?: string | null;
    spoiler_text?: string | null;
    visibility?: string | null;
    media_ids?: ID[] | null;
    poll?: { options?: string[]; expires_in?: number; multiple?: boolean } | null;
    [key: string]: unknown;
  } | null;
  media_attachments?: MediaAttachment[] | null;
}

// --- OAuth ----------------------------------------------------------------

/** `POST /api/v1/apps` response (contract §2.1). */
export interface RegisteredApp {
  id?: ID;
  name?: string;
  redirect_uri: string;
  client_id: string;
  client_secret: string;
  vapid_key?: string;
  /** Mastodon: always 0 (never expires). Absent on Akkoma. */
  client_secret_expires_at?: number;
  website?: string | null;
  scopes?: string;
}

/** `POST /oauth/token` success body (contract §2.1). */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  created_at?: number;
  scope?: string;
  /** Akkoma extras — ignored by the client. */
  refresh_token?: string;
  expires_in?: number;
  me?: string;
}

/**
 * MFA challenge from a password grant (Akkoma, HTTP 403):
 * `{error: "mfa_required", mfa_token, supported_challenge_types}` —
 * `o_auth_controller.ex` → `MFAView.render("mfa_response.json")`.
 */
export interface MfaChallengeResponse {
  error: string;
  mfa_token: string;
  supported_challenge_types: string[];
}

/** OAuth/token endpoint error body: `{error, error_description?}`. */
export interface OAuthErrorBody {
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}
