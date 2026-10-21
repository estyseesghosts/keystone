// Core domain models (unified plan §2.1). One model layer for every
// backend family; the UI renders these and NOTHING else — wire types live
// behind the adapters (`src/misskey/wire.ts`, `src/api/mastodon/wire.ts`)
// and never cross into components/ or routes/.
//
// Started from `api/mastodon/models.ts` (Keystodon's app models) and
// generalised per plan §2.1:
// - `content` carries `{ html?, mfm?, plain }` — the renderer is chosen
//   PER POST, not per server (Akkoma can carry MFM source).
// - `visibility` carries `{ kind, localOnly, raw }`. `raw` is ALWAYS kept
//   and written back on compose/edit, so Misskey `home` maps to `kind:
//   "quiet"` on read but is never rewritten to `unlisted` on write
//   (keystodon.md:165-167, plan §2.1).
// - Reactions and favourites are separate: `reactions: ReactionSummary |
//   null` (Misskey family — a like is a reaction; Akkoma emoji reactions),
//   `favourite: {count, mine} | null` (vanilla Mastodon). Never merged
//   (keystodon.md §1.5).
// - `raw`-discipline fields (`Visibility.raw`, `Notification.rawType`) are
//   carried verbatim and round-trip through write paths.
// - IDs are opaque strings: never parsed, never numerically compared.
//
// Field-naming note (Phase 2 decision, recorded in
// state/logs/2026-10-17-phase2.md): where §2.1 speaks, its names win
// (`content`, `visibility`, `reactions`/`favourite`, `quote`, `media`,
// `poll`, `card`, `editedAt`, `filtered`, `renote`/`reblog`, `emojis`,
// `ext`). Elsewhere the names match the Misskey-family UI vocabulary the
// app already renders (`cw`, `renote`, `name`/`username`/`host`) so the
// UI migration is mechanical and behaviour-preserving. `renote` IS the
// plan's "renote/reblog" field: the Phase 3 Mastodon adapter maps
// `Status.reblog` here.

// --- Content ---------------------------------------------------------------

/** A post's (or profile bio's) content, as the server sent it. At least
 * `plain` is always present. `mfm` is Misskey-family MFM source; `html` is
 * server HTML (Mastodon family). The renderer is chosen per post from what
 * is actually present — never assumed from the server. */
export interface Content {
  html?: string;
  mfm?: string;
  /** Plain-text extraction for search/fold/length decisions. */
  plain: string;
}

/** Light plain-text extraction from MFM source: strips the syntax the UI
 * never wants in a text fallback (mentions/hashtags/links keep their
 * visible label or target), keeps everything else verbatim. Pure. */
export function plainFromMfm(mfm: string | null | undefined): string {
  if (!mfm) return "";
  // <plain>…</plain> blocks render verbatim in MFM: keep their text
  // untouched behind placeholders until the stripping is done.
  const plains: string[] = [];
  let text = mfm.replace(/<plain>([\s\S]*?)<\/plain>/g, (_all, inner: string) => {
    plains.push(inner);
    return `\u0000${plains.length - 1}\u0000`;
  });
  text = text
    // quote blocks: drop the leading `>` markers only.
    .replace(/^> ?/gm, "")
    // emoji codes :name: / :name@host: -> name@host (never the colons).
    .replace(/:([\w+-]+)(@[\w.-]+)?:/g, "$1$2")
    // mentions @user / @user@host -> user / user@host (mfm-js packs the
    // leading @ into acct; the renderer shows it verbatim — 2026-10-16).
    // Only at a word boundary: `name@host` inside an emoji code stays.
    .replace(/(^|\s)@([\w-]+(?:@[\w.-]+)?)/g, "$1$2")
    // hashtags keep their text.
    .replace(/#([\w-]+)/g, "$1")
    // [label](url) -> label
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    // bare <url> -> url
    .replace(/<((?:https?|sc):\/\/[^>\s]+)>/g, "$1")
    // inline markers: **bold**, *italic*, <i>, strike, math, code, html tags
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\\((.+?)\\\)/g, "$1")
    .replace(/\\\[(.+?)\\\]/gs, "$1");
  return text
    .replace(/\u0000(\d+)\u0000/g, (_all, i: string) => plains[Number(i)] ?? "")
    .trim();
}

/** Build a Content from raw MFM source (the Misskey family). */
export function mfmContent(mfm: string | null | undefined): Content {
  const source = mfm ?? "";
  return { mfm: source.length > 0 ? source : undefined, plain: plainFromMfm(source) };
}

/** Build a Content from server HTML (the Mastodon family). `plain` is the
 * caller's extraction (transitional display text), never HTML. */
export function htmlContent(html: string | null | undefined, plain: string): Content {
  return { html: html ?? "", plain };
}

// --- Visibility ------------------------------------------------------------

export type VisibilityKind = "public" | "quiet" | "followers" | "direct";

export interface Visibility {
  /** Conservative normalized enum. Misskey `home` reads as `quiet`. */
  kind: VisibilityKind;
  /** Misskey `localOnly` / Akkoma `local`. Never folded into `kind`. */
  localOnly: boolean;
  /** The wire value VERBATIM (`home`, `specified`, `list:…`, …). Compose
   * and edit write this back when it is still accurate, so a `home` post
   * is never silently rewritten to `unlisted`. */
  raw: string;
}

/** Map a wire visibility string to the normalized kind. Unknown values are
 * NEVER rounded up to `public` — they read as `direct` (the most
 * restrictive safe display) while `raw` keeps the truth. Pure. */
export function visibilityKindOf(raw: string): VisibilityKind {
  switch (raw) {
    case "public":
      return "public";
    case "unlisted":
    case "home":
    case "quiet":
      return "quiet";
    case "followers":
    case "private":
      return "followers";
    case "specified":
    case "direct":
    default:
      return "direct";
  }
}

/** Build a Visibility from wire parts. */
export function visibilityOf(raw: string, localOnly: boolean): Visibility {
  return { kind: visibilityKindOf(raw), localOnly, raw };
}

// --- Accounts --------------------------------------------------------------

export interface AccountFieldModel {
  name: string;
  value: string;
  verifiedAt: string | null;
}

export interface Account {
  id: string;
  /** Bare username (`user`). */
  username: string;
  /** Handle as displayed without a leading `@`: `user` locally,
   * `user@host` remotely. */
  acct: string;
  /** Bare host for remote accounts, null for this server's own. */
  host: string | null;
  /** Raw display name exactly as sent — nullable/empty is normal and is
   * what `hasRealDisplayName`/`headNameOf` reason about. */
  name: string | null;
  /** Display name with the `username` fallback applied (never blank). */
  displayName: string;
  /** Bio as Content (Misskey family carries MFM; Mastodon carries HTML). */
  bio: Content;
  url: string | null;
  uri: string | null;
  avatarUrl: string | null;
  avatarBlurhash: string | null;
  /** Banner image (Misskey `bannerUrl` / Mastodon `header`). */
  headerUrl: string | null;
  headerBlurhash: string | null;
  followersCount: number;
  followingCount: number;
  /** Posts count (Misskey `notesCount` / Mastodon `statuses_count`). */
  statusesCount: number;
  locked: boolean;
  bot: boolean;
  /** Misskey `isCat`. */
  cat: boolean;
  silenced: boolean;
  suspended: boolean;
  /** Misskey online status string (`online`/`active`/`offline`/`unknown`). */
  onlineStatus: string | null;
  location: string | null;
  birthday: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastFetchedAt: string | null;
  /** Custom emoji: code → url (from packed `emojis` maps). */
  emojis: Record<string, string>;
  fields: AccountFieldModel[];
  /** `moved` target reduced to its identity — null when not moved. */
  movedTo: { id: string; acct: string; url: string } | null;
  /** Follower/following list visibility (absent = unknown — the list UI
   * renders without a privacy gate). */
  ffVisibility: "public" | "followers" | "private" | null;
  /** Pinned posts (the Featured tab ships absent, never faked). */
  pinnedPostIds: string[] | null;
  pinnedPosts: Post[] | null;

  // --- Viewer state (auth-only; absent means unknown, never false) ---
  isFollowing?: boolean;
  isFollowed?: boolean;
  /** Accepted vs pending follow distinction — never infer acceptance from
   * a successful follow call alone. */
  hasPendingFollowRequestFromYou?: boolean;
  hasPendingFollowRequestToYou?: boolean;
  isBlocking?: boolean;
  isBlocked?: boolean;
  isMuted?: boolean;
  isRenoteMuted?: boolean;

  /** Typed per-family bag (plan §2.1 `ext`): Misskey `i` extras the
   * profile editor round-trips, follower/following cursors hints, and so
   * on. Never read by family-neutral rendering. */
  ext: AccountExt;
}

/** Per-family account extras. Field names match the Misskey-family wire so
 * the profile editor round-trips verbatim; a Mastodon adapter leaves this
 * empty (or fills `mastodon`/`akkoma` bags). */
export interface AccountExt {
  /** The full Misskey `i`/`users/show` extra-field bag (`followedMessage`,
   * `lang`, `hideOnlineStatus`, `mutedWords`, `noCrawle`, …). Typed as a
   * bag because the set is server-defined and version-moving; the profile
   * editor is the sole consumer and treats entries as opaque values. */
  me?: Record<string, unknown>;
  /** Mastodon-family self-verify extras (`source`, `state`, `role`,
   * `pleroma.settings_store`, …) carried verbatim for the profile editor's
   * round-trip. Never read by family-neutral rendering. */
  mastodon?: Record<string, unknown>;
  /** Sharkey/Pinetree quote refusal (account-wide). */
  rejectQuotes?: boolean;
}

// --- Media -----------------------------------------------------------------

export type MediaKind = "image" | "gifv" | "video" | "audio" | "file" | "unknown";

export interface Media {
  id: string;
  kind: MediaKind;
  /** MIME type as sent (`image/png`, `video/mp4`, …). */
  mimeType: string;
  /** Full media URL; null while the server is still processing. */
  url: string | null;
  /** Preview/thumbnail URL (Misskey `thumbnailUrl`). */
  previewUrl: string | null;
  /** File name (Misskey `name`) — also the Drive display name. */
  name: string;
  /** Alt text / comment (Misskey `comment`, Mastodon `description`). */
  description: string | null;
  blurhash: string | null;
  isSensitive: boolean;
  size: number | null;
  md5: string | null;
  /** Server metadata verbatim (Misskey `properties`: width/height/duration). */
  meta: Record<string, unknown> | null;
  createdAt: string | null;
  /** Drive parent folder (Misskey drive). Null/absent outside the drive. */
  folderId: string | null;
  /** Drive owner. */
  userId: string | null;
}

/** `Media.meta` width when the server reported one. Pure. */
export function mediaWidth(media: Media): number | null {
  const w = media.meta?.width;
  return typeof w === "number" && Number.isFinite(w) ? w : null;
}

/** `Media.meta` height when the server reported one. Pure. */
export function mediaHeight(media: Media): number | null {
  const h = media.meta?.height;
  return typeof h === "number" && Number.isFinite(h) ? h : null;
}

// --- Polls -----------------------------------------------------------------

export interface PollOption {
  text: string;
  votesCount: number;
  /** True when the viewer voted this option (Misskey `isVoted`). */
  voted: boolean;
}

export interface Poll {
  multiple: boolean;
  expiresAt: string | null;
  /** Whether the poll is already closed (derived; never guessed). */
  expired: boolean;
  /** Sum of option votes; null when the server sent no counts. */
  votesCount: number | null;
  /** Voters count when the server reported one; null otherwise — never
   * coerced from votesCount. */
  votersCount: number | null;
  options: PollOption[];
}

// --- Reactions / favourites -----------------------------------------------

export interface ReactionEntry {
  /** The reaction key verbatim (`❤`, `:name@host:`, …). */
  key: string;
  count: number;
  /** True when the viewer's reaction is this key. */
  mine: boolean;
  /** Resolved custom-emoji URL for the key when one is known. */
  url: string | null;
}

export interface ReactionSummary {
  total: number;
  /** Server order preserved (chips render in this order). */
  entries: ReactionEntry[];
  /** The viewer's reaction key, or null. */
  mine: string | null;
  /** Every key the viewer reacted with (Pleroma allows several). */
  myReactions: string[];
  /** Packed emoji map: key → url (Misskey `reactionEmojis`). */
  urls: Record<string, string>;
}

export interface FavouriteState {
  count: number;
  mine: boolean;
}

/** The reaction keys → counts map a chips row renders. Derived from the
 * summary, preserving entry order. Pure. */
export function reactionMap(reactions: ReactionSummary | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!reactions) return out;
  for (const e of reactions.entries) out[e.key] = e.count;
  return out;
}

/** Local end-state of toggling the viewer's favourite (the Mastodon
 * family's `favourite` field — NEVER merged into `reactions`,
 * keystodon.md §1.5): the flag and its count move together, clamped at
 * zero. Feeds apply it optimistically, then reconcile with the server
 * response. Pure. */
export function withFavourite(post: Post, mine: boolean): Post {
  const current = post.favourite;
  if (!current || current.mine === mine) return post;
  const count = Math.max(0, current.count + (mine ? 1 : -1));
  return {
    ...post,
    favourite: { count, mine },
    counts: { ...post.counts, favourites: count },
  };
}

/** Pin the viewer's confirmed reaction (the optimistic-overlay pattern in
 * `misskey/myReactions`): sets `reactions.mine` WITHOUT touching counts,
 * so `withReaction` computes its delta from the pinned state. Pure. */
export function withMyReaction(post: Post, mine: string | null): Post {
  const summary = post.reactions;
  if (!summary) {
    return mine == null
      ? post
      : {
          ...post,
          reactions: { total: 0, entries: [], mine, myReactions: [mine], urls: {} },
        };
  }
  return {
    ...post,
    reactions: { ...summary, mine, myReactions: mine ? [mine] : [] },
  };
}

/** Local end-state of setting one reaction: removes the previous entry (if
 * any) and adds the new one, adjusting the total. Pure — feeds apply it
 * optimistically, then reconcile with the server response. */
export function withReaction(post: Post, reaction: string | null): Post {
  const mine = post.reactions?.mine ?? null;
  if (mine === reaction) return post;
  const summary = post.reactions ?? {
    total: 0,
    entries: [],
    mine: null,
    myReactions: [],
    urls: {},
  };
  const entries = summary.entries.map((e) => ({ ...e }));
  if (mine) {
    const idx = entries.findIndex((e) => e.key === mine);
    if (idx >= 0) {
      const left = entries[idx].count - 1;
      if (left <= 0) entries.splice(idx, 1);
      else {
        entries[idx] = { ...entries[idx], count: left, mine: false };
      }
    }
  }
  if (reaction) {
    const idx = entries.findIndex((e) => e.key === reaction);
    if (idx >= 0) {
      entries[idx] = {
        ...entries[idx],
        count: entries[idx].count + 1,
        mine: true,
      };
    } else {
      entries.push({
        key: reaction,
        count: 1,
        mine: true,
        url: summary.urls[reaction] ?? null,
      });
    }
  }
  const total = Math.max(0, summary.total + (mine ? -1 : 0) + (reaction ? 1 : 0));
  return {
    ...post,
    reactions: {
      ...summary,
      total,
      entries,
      mine: reaction,
      myReactions: reaction ? [reaction] : [],
    },
  };
}

// --- Posts -----------------------------------------------------------------

/** Server-side filter hit (Mastodon `filtered[]`; kept verbatim). */
export interface FilteredEntry {
  title: string;
  action: string;
}

export interface LinkCard {
  url: string;
  title: string;
  description: string;
  image: string | null;
  type: string;
  authorName: string | null;
  authorUrl: string | null;
  providerName: string | null;
}

export interface PostCounts {
  replies: number;
  /** Renotes/boosts (Misskey `renoteCount` / Mastodon `reblogs_count`). */
  boosts: number;
  quotes: number;
  reactions: number;
  favourites: number;
}

export interface Post {
  id: string;
  createdAt: string;
  /** The author. (Mastodon's `account` — one concept, one name.) */
  author: Account;
  accountId: string;
  content: Content;
  /** Content warning (Misskey `cw` / Mastodon `spoiler_text`). */
  cw: string | null;
  visibility: Visibility;
  counts: PostCounts;
  /** Misskey family + Akkoma emoji reactions; null on vanilla Mastodon. */
  reactions: ReactionSummary | null;
  /** Vanilla Mastodon favourites; null where favourites are the reactions. */
  favourite: FavouriteState | null;
  media: Media[];
  /** Attachment ids in server order (compose round-trips, pure-renote
   * tests). */
  mediaIds: string[];
  poll: Poll | null;
  card: LinkCard | null;
  /** Structured quote target when the server nested one. */
  quote: Post | null;
  /** Mastodon `quote.state` ("pending"/"accepted"/…); null when the server
   * sent no quote. */
  quoteState: string | null;
  /** True when this post quotes something the server will not disclose (a
   * quote object with no target, Pinetree `quoteTargetUnavailable`).
   * Distinct from "no quote". */
  quoteUnavailable: boolean;
  /** The plan's "renote/reblog": boost wrapper payload. Misskey calls it
   * `renote`; Mastodon `reblog` maps here in Phase 3. */
  renote: Post | null;
  /** Packed parent note when the server included one (may be null even
   * when `replyToId` is set — deleted, private, or simply unpacked). */
  reply: Post | null;
  replyToId: string | null;
  renoteId: string | null;
  /** Canonical ActivityPub identifiers. Used to recognize duplicate
   * textual `RE:` suffixes and remote deep-links — never fetched blindly. */
  uri: string | null;
  url: string | null;
  /** Custom emoji: code → url. */
  emojis: Record<string, string>;
  /** Mention target ids (opaque). */
  mentions: string[];
  tags: string[];
  editedAt: string | null;
  filtered: FilteredEntry[];
  /** True when the server pinned this post in a featured context. */
  pinned: boolean;
  /** Typed per-family bag (plan §2.1 `ext`). */
  ext: PostExt;
}

export interface PostExt {
  /** Misskey `reactionAcceptance` (null = all reactions allowed). */
  reactionAcceptance?: string | null;
  /** Misskey `visibleUserIds` on `specified` posts. */
  visibleUserIds?: string[];
  /** Misskey channel id when the note belongs to a channel. */
  channelId?: string | null;
  /** Pinetree quote extensions (absent on Misskey/Sharkey):
   * `quoteTargetUri` preserves a safe-to-disclose target URI when the
   * target itself is unresolved; `quoteTargetUnavailable` signals the
   * relationship exists but its target cannot safely be exposed;
   * `quoteAuthorizationStatus` is display metadata only. */
  quoteTargetUri?: string | null;
  quoteTargetUnavailable?: boolean | null;
  quoteAuthorizationStatus?: string | null;
  /** True when the wire carried a packed `myReaction` (credential-pinned
   * field: always assert/read authenticated). */
  myReactionPacked?: boolean;
  /** Mastodon-family bookmark flag (wire `bookmarked`, auth-only). Present
   * only when the server sent it — display badge, never faked. */
  bookmarked?: boolean;
  /** Mastodon-family "viewer boosted this" flag (wire `reblogged`,
   * auth-only). Present only when the server sent it; the Misskey family
   * has no such wire field and tracks repost state in the feed instead. */
  reblogged?: boolean;
  /** Mastodon-family mention anchor routing: account id → profile URL
   * (the server HTML mention anchors link by URL; `Post.mentions` carries
   * only the ids). Read by the HTML renderer only. */
  mentionUrls?: Record<string, string>;
}

/** Mirror of Misskey `is-renote.ts` (packed-note variants): a pure renote
 * (repost) carries `renoteId` with no own content — no text, CW, reply,
 * poll, or media. Anything else with `renoteId` is a quote: its own post
 * with an embedded original. Pure. */
export function isPureRenote(post: Post): boolean {
  return (
    post.renoteId != null &&
    (post.content.mfm ?? post.content.html ?? null) == null &&
    post.cw == null &&
    post.replyToId == null &&
    post.poll == null &&
    post.mediaIds.length === 0
  );
}

/** The post whose content and actions apply: the renoted original for a
 * pure repost, the post itself otherwise (a quote is its own post — the
 * server rejects renoting or replying to a pure-renote wrapper, so every
 * action must target the original). Falls back to the wrapper when the
 * original is unavailable (deleted/invisible). Pure. */
export function appearNoteOf(post: Post): Post {
  return isPureRenote(post) && post.renote ? post.renote : post;
}

export interface CollapsedFeed {
  /** Item ids with a visible row. */
  reps: Set<string>;
  /** Representative wrapper id → aggregated renoters (feed order). */
  renotersByRep: Map<string, Account[]>;
}

/** Collapse pure reposts in a feed: an original plus its reposts shows
 * only the first repost (input order), with renoters aggregated for the
 * banner. Quotes never collapse — they carry their own commentary.
 * Grouping is by effective target (a wrapper's `renoteId`, which survives
 * even a deleted/unpacked original; otherwise the item's own id). Pure:
 * returns fresh sets/maps, never mutates the input. */
export function collapseReposts(items: Post[]): CollapsedFeed {
  const groups = new Map<
    string,
    { rep: string; repIsWrapper: boolean; users: Account[]; userIds: Set<string> }
  >();
  for (const n of items) {
    if (isPureRenote(n)) {
      const key = n.renoteId ?? n.id;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          rep: n.id,
          repIsWrapper: true,
          users: [n.author],
          userIds: new Set([n.author.id]),
        });
      } else {
        // The first repost displaces a previously seen original.
        if (!g.repIsWrapper) {
          g.rep = n.id;
          g.repIsWrapper = true;
        }
        if (!g.userIds.has(n.author.id)) {
          g.userIds.add(n.author.id);
          g.users.push(n.author);
        }
      }
    } else if (!groups.has(n.id)) {
      groups.set(n.id, {
        rep: n.id,
        repIsWrapper: false,
        users: [],
        userIds: new Set(),
      });
    }
  }
  const reps = new Set<string>();
  const renotersByRep = new Map<string, Account[]>();
  for (const g of groups.values()) {
    reps.add(g.rep);
    if (g.repIsWrapper) renotersByRep.set(g.rep, g.users);
  }
  return { reps, renotersByRep };
}

// --- Relationships ---------------------------------------------------------

/** Relation of the viewer to one account. All flags optional — absent
 * means unknown (relation endpoint unsupported), never false. */
export interface Relationship {
  id: string;
  isFollowing?: boolean;
  isFollowed?: boolean;
  isBlocking?: boolean;
  isBlocked?: boolean;
  isMuted?: boolean;
  isRenoteMuted?: boolean;
  /** Pending follow YOU sent (locked account). */
  hasPendingFollowRequestFromYou?: boolean;
  /** Pending follow THEY sent you. */
  hasPendingFollowRequestToYou?: boolean;
}

// --- Notifications ---------------------------------------------------------

export type NotificationKind =
  | "follow"
  | "mention"
  | "reply"
  | "renote"
  | "quote"
  | "reaction"
  /** Mastodon-family favourite rows (wire type `favourite`). Kept DISTINCT
   * from `reaction` (keystodon.md §1.5 discipline): a favourite is never
   * rounded up into a reaction, and an emoji reaction never into a
   * favourite. */
  | "favourite"
  | "pollVote"
  | "pollEnded"
  | "receiveFollowRequest"
  | "followRequestAccepted"
  | "achievement"
  | "app"
  | "unknown";

/** One actor in a notification row. Grouped rows carry several (including
 * id-only actors the server listed without a packed account), each with
 * the reaction it contributed (grouped reaction rows only). */
export interface NotificationActor {
  /** The actor's account id (opaque). Always present. */
  id: string;
  /** The packed account when the server sent one; null for id-only actors
   * (a grouped row may count actors it did not pack). Never faked. */
  account: Account | null;
  reaction: string | null;
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** The wire type string VERBATIM — display/debug only, never routed on. */
  rawType: string;
  createdAt: string;
  /** Pinetree packs `isRead`; Misskey/Sharkey omit it → null = unknown.
   * Never faked. */
  read: boolean | null;
  /** One actor for flat rows; the aggregated set for grouped rows. */
  actors: NotificationActor[];
  /** The target post (reaction/mention/renote/…); null for account rows. */
  post: Post | null;
  /** Reaction key for flat `reaction` rows. */
  reaction: string | null;
  /** Typed per-family bag. */
  ext: NotificationExt;
}

export interface NotificationExt {
  /** Grouped reaction rows (`i/notifications-grouped`) keep the raw pairs
   * so a row can list "who reacted with what" even where the actor set and
   * the reaction set differ. */
  groupedReactions?: Array<{ userId: string; reaction: string }>;
}

// --- Pagination ------------------------------------------------------------

/** Opaque page cursor. Misskey `untilId`/`sinceId` and Mastodon `Link`
 * headers both hide behind it — the UI treats it as a token and never
 * parses it. */
export type Cursor = string & { readonly __cursor?: unique symbol };

export interface Page<T> {
  items: T[];
  /** Token for the NEXT page, or null when the server offered none. */
  cursor: Cursor | null;
  /** End-of-feed, decided by the adapter: the Misskey adapter ends on a
   * short/empty page (its cursor is just the last id, so a short page
   * means the listing is exhausted — same as the app's existing
   * `page.length < LIMIT` walk guard); the Mastodon adapter ends on a
   * missing next link or an empty page, never on `items.length < limit`
   * while a next link exists. */
  end: boolean;
}

/** A page with no continuation. */
export function endPage<T>(items: T[]): Page<T> {
  return { items, cursor: null, end: true };
}

/** Append an older page, deduplicating by id (server order preserved; a
 * duplicate id means the cursor overlapped — the id is never shown twice).
 * Returns how many NEW items were added: 0 means the page contributed
 * nothing the viewer doesn't already have. Pure. */
export function appendOlder<T extends { id: string }>(
  current: T[],
  incoming: T[],
): { items: T[]; added: number } {
  const seen = new Set(current.map((s) => s.id));
  const fresh: T[] = [];
  for (const s of incoming) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    fresh.push(s);
  }
  return fresh.length === 0
    ? { items: current, added: 0 }
    : { items: [...current, ...fresh], added: fresh.length };
}

/** A freshly fetched page replaces the list (refresh), deduplicating by id
 * within the page itself. Pure. */
export function replaceWithPage<T extends { id: string }>(incoming: T[]): T[] {
  const seen = new Set<string>();
  return incoming.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// --- Display-name helpers (semantics preserved from api/types.ts) ----------

export function displayNameOf(user: Pick<Account, "name" | "username">): string {
  return user.name && user.name.length > 0 ? user.name : user.username;
}

export function handleOf(user: Pick<Account, "username" | "host">): string {
  return user.host ? `@${user.username}@${user.host}` : `@${user.username}`;
}

/** Split a rendered mention label (`@user`, `user@host`, …) into a
 * backend lookup ref. Returns null when the label is not a handle
 * (display-name text, bare `@`, bad characters) — callers fall back
 * to the href or leave the mention inert, never a guessed profile. Pure. */
export function parseAcct(
  label: string | null | undefined,
): {username: string; host: string | null} | null {
  if (!label) return null;
  const bare = label.trim().replace(/^@+/, "");
  if (bare.length === 0) return null;
  const parts = bare.split("@");
  if (parts.length > 2) return null;
  const [username, host] = parts;
  if (!username || !/^[\w-]+$/.test(username)) return null;
  if (host !== undefined && (host.length === 0 || !/^[\w.-]+$/.test(host))) return null;
  return {username, host: host ?? null};
}

/** True when the profile carries a real display name — not empty, and not
 * just the username/handle echoed back (`pndc`, `@pndc`,
 * `@pndc@host` all count as absent). Pure. */
export function hasRealDisplayName(
  user: Pick<Account, "name" | "username" | "host">,
): boolean {
  const raw = (user.name ?? "").trim();
  if (raw.length === 0) return false;
  const low = raw.replace(/^@+/, "").toLowerCase();
  if (low === user.username.toLowerCase()) return false;
  const full = user.host ? `${user.username}@${user.host}` : user.username;
  if (low === full.toLowerCase()) return false;
  return true;
}

/** Head-line name: the display name when real, else the whole handle
 * (`@pndc@host`) — never a bare `@pndc` stuttering next to a duplicate
 * handle span. Callers hide the handle span when this falls back. Pure. */
export function headNameOf(
  user: Pick<Account, "name" | "username" | "host">,
): string {
  return hasRealDisplayName(user) ? displayNameOf(user) : handleOf(user);
}
