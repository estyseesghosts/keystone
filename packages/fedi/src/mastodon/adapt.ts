// Wire → CORE MODEL normalization (plan §3 Phase 3 item 1). One direction
// only: `wire.ts` types in, `core/models.ts` types out. Nothing here
// posts, fetches, or touches the DOM.
//
// Phase 3 retarget: this adapter's own `models.ts` is dissolved — core
// started from Keystodon's models, so the change is mostly additive
// (`Post.content {html?, mfm?, plain}`, `visibility {kind, localOnly,
// raw}`, `reactions | favourite`, `quote`/`quoteState`/`quoteUnavailable`,
// `renote` = the plan's renote/reblog). Mapping table (wire → core):
//
//   Status.content (HTML)   → Content { html?, plain }  (html undefined
//                            when the body is empty — a boost wrapper has
//                            NO content source, so `isPureRenote` holds)
//   Status.spoiler_text     → Post.cw ("" → null)
//   Status.visibility       → Visibility { kind, localOnly, raw } —
//                            `local` (Akkoma) reads as kind "quiet" with
//                            localOnly true (owner rule 2026-10-17); every
//                            other raw value goes through
//                            `visibilityKindOf` (unknown → "direct", never
//                            rounded up); `raw` is NEVER rewritten
//   Status.emoji_reactions  → reactions: ReactionSummary | null — null
//                            when the wire sent NO field (vanilla
//                            Mastodon), a summary (possibly empty) when
//                            the array is present. Favourites are NEVER
//                            merged in here (keystodon.md §1.5)
//   Status.favourites_count → favourite { count, mine } | null + counts
//                            — null on the Misskey family (there a like
//                            IS a reaction); `mine` is the auth-only
//                            `favourited` flag (absent reads false, the
//                            documented auth-only rule)
//   Status.reblog           → renote + renoteId (the plan's
//                            "renote/reblog"); `isPureRenote` sees the
//                            empty wrapper and `appearNoteOf` shows the
//                            original
//   Status.quote            → quote + quoteState + quoteUnavailable
//                            (both wire shapes: Mastodon
//                            `{state, quoted_status}` and Akkoma's nested
//                            Status; `quote_id` with a null quote object
//                            = unavailable, never "no quote")
//   Status.edited_at        → editedAt; Status.filtered → filtered
//   Status.bookmarked/pinned→ ext.bookmarked / pinned
//   Status.mentions[]       → mentions (ids) + ext.mentionUrls (id → URL,
//                            for the HTML renderer's internal routing)
//   MediaAttachment         → Media { kind, mimeType, … } (kind maps the
//                            documented `type` enum, anything else
//                            "unknown"; `mimeType` only where the server
//                            sent one — Akkoma `pleroma.mime_type`)
//   Poll                    → Poll (votersCount stays null where the
//                            server sends none — Akkoma single-choice)
//   Account                 → Account (bio is HTML Content; `display_name`
//                            empty → username fallback in `displayName`,
//                            raw kept in `name`)
//   Relationship            → Relationship (absent optional flags stay
//                            absent — unknown, never false)
//   Notification            → Notification (adaptNotification: flat rows,
//                            one actor; `favourite` stays its own kind)
//
// Cursors: Mastodon paging rides `Link` rel="next" continuations
// (`pagination.ts`) behind the opaque core `Cursor` — the JSON encoding
// lives here (encodeContinuation/decodeContinuation) and `Page.end` is the
// contract §5 rule: no next link OR an empty page, NEVER `length < limit`.

import type {
  Account,
  AccountFieldModel,
  Content,
  Cursor,
  FavouriteState,
  LinkCard,
  Media,
  MediaKind,
  Notification,
  NotificationActor,
  NotificationKind,
  Page,
  Poll,
  Post,
  PostRevision,
  ReactionEntry,
  ReactionSummary,
  Relationship,
  Visibility,
} from "../core/models";
import { plainFromMfm, visibilityKindOf } from "../core/models";
import type { Announcement as CoreAnnouncement } from "../core/backend";
import type { Continuation } from "./pagination";
import type {
  Account as WireAccount,
  Announcement as WireAnnouncement,
  CredentialAccount,
  EmojiReaction,
  MediaAttachment,
  Mention,
  Notification as WireNotification,
  Poll as WirePoll,
  Relationship as WireRelationship,
  Status,
  StatusEdit,
  StatusFilterResult,
} from "./wire";

// --- HTML → plain text ------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body.toLowerCase().startsWith("#x");
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? full;
  });
}

/**
 * Reduce server-sanitized HTML to displayable plain text.
 *
 * - `<br>` / `</p>` become newlines (Mastodon paragraph-per-`<p>`).
 * - `<img alt="…">` contributes its alt text (custom emoji show as
 *   `:shortcode:` here — the literal is honest).
 * - Everything else between tags is dropped; remaining text is
 *   entity-decoded once (`&amp;` last so `&amp;lt;` stays `&lt;`).
 *
 * Never used as an HTML source: the output is rendered as a text node.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (typeof html !== "string" || html.length === 0) return "";
  let out = html;
  // Images first: keep the alt text, drop the tag.
  out = out.replace(/<img\b[^>]*?\balt\s*=\s*"([^"]*)"[^>]*>/gi, "$1");
  out = out.replace(/<img\b[^>]*>/gi, "");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n");
  out = out.replace(/<p[^>]*>/gi, "");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  // Tidy: de-indent lines, collapse runs of blank lines, trim.
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/** Build a core Content from server HTML. `html` is undefined when the
 * body is empty, so the renderer picker sees "no HTML source" instead of
 * an empty document (mirrors `mfmContent`). Pure. */
export function htmlContentOf(html: string | null | undefined): Content {
  const source = html ?? "";
  return {
    html: source.length > 0 ? source : undefined,
    plain: htmlToPlainText(source),
  };
}

/**
 * The MFM source of a status, or null. Akkoma packs the original
 * `text/plain` (MFM-flavoured) in `status.pleroma.content`; vanilla
 * Mastodon sends no such field. Non-empty strings only — an empty
 * source is "no MFM source", never an empty document. Pure.
 */
export function mfmSourceOf(status: Status): string | null {
  const pleroma = status.pleroma as Record<string, unknown> | undefined;
  const content = pleroma?.content;
  if (!content || typeof content !== "object") return null;
  const text = (content as Record<string, unknown>)["text/plain"];
  return typeof text === "string" && text.length > 0 ? text : null;
}

/**
 * Build a core Content from a wire status: server HTML always, plus the
 * MFM source when the server packed one (Akkoma). `plain` follows the
 * MFM projection when MFM is present (that is what renders), else the
 * HTML projection. Pure.
 */
export function statusContentOf(status: Status): Content {
  const base = htmlContentOf(status.content ?? "");
  const mfm = mfmSourceOf(status);
  if (mfm === null) return base;
  return { ...base, mfm, plain: plainFromMfm(mfm) };
}

// --- Visibility -------------------------------------------------------------

/**
 * Wire visibility → core Visibility. `local` (Akkoma) is the documented
 * localOnly source and reads as kind `quiet` (owner rule 2026-10-17 —
 * "Akkoma `local` and Mastodon `unlisted` map like Misskey `home`");
 * everything else goes through core `visibilityKindOf`, where unknown
 * values read `direct` (never rounded up to `public`) and `raw` is always
 * kept verbatim. Pure.
 */
export function visibilityOfWire(raw: string): Visibility {
  if (raw === "local") return { kind: "quiet", localOnly: true, raw };
  return { kind: visibilityKindOf(raw), localOnly: false, raw };
}

// --- Accounts ---------------------------------------------------------------

export function adaptAccount(account: WireAccount): Account {
  const host = account.acct.includes("@")
    ? account.acct.slice(account.acct.indexOf("@") + 1)
    : null;
  const fields: AccountFieldModel[] = (account.fields ?? []).map((f) => ({
    name: f.name,
    value: f.value,
    verifiedAt: f.verified_at ?? null,
  }));
  const emojis: Record<string, string> = {};
  for (const e of account.emojis ?? []) emojis[e.shortcode] = e.url;
  const name = account.display_name ?? "";
  return {
    id: account.id,
    username: account.username,
    acct: account.acct,
    host,
    // Raw name kept verbatim (empty is normal); displayName applies the
    // username fallback (core's contract).
    name,
    displayName: name.trim().length > 0 ? name : account.username,
    bio: htmlContentOf(account.note ?? ""),
    url: account.url ?? null,
    uri: account.uri ?? null,
    avatarUrl: account.avatar_static ?? account.avatar ?? null,
    avatarBlurhash: null,
    headerUrl: account.header_static ?? account.header ?? null,
    headerBlurhash: null,
    followersCount: account.followers_count ?? 0,
    followingCount: account.following_count ?? 0,
    statusesCount: account.statuses_count ?? 0,
    locked: account.locked === true,
    bot: account.bot === true,
    cat: false,
    // Mastodon's `limited` is the server-restriction flag; `suspended` is
    // Mastodon-only (Akkoma lacks it — absent reads false on a core
    // boolean, never "unknown" into the UI).
    silenced: account.limited === true,
    suspended: account.suspended === true,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: account.created_at ?? null,
    updatedAt: null,
    lastFetchedAt: null,
    emojis,
    fields,
    movedTo: account.moved
      ? { id: account.moved.id, acct: account.moved.acct, url: account.moved.url }
      : null,
    // The wire's `hide_collections` is not a follower-list visibility
    // statement — absent stays unknown (null).
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
  };
}

/** `verify_credentials` → core Account, keeping the self-only extras in
 * `ext.mastodon` verbatim (the profile editor round-trips them). */
export function adaptCredentialAccount(account: CredentialAccount): Account {
  const extras: Record<string, unknown> = {};
  if (account.source !== undefined) extras.source = account.source;
  if (account.state !== undefined) extras.state = account.state;
  if (account.role !== undefined) extras.role = account.role;
  if (account.pleroma !== undefined) extras.pleroma = account.pleroma;
  if (account.akkoma !== undefined) extras.akkoma = account.akkoma;
  return { ...adaptAccount(account), ext: { mastodon: extras } };
}

// --- Media ------------------------------------------------------------------

const MEDIA_KINDS: readonly string[] = ["image", "gifv", "video", "audio", "unknown"];

function mediaKindOf(type: string): MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(type) ? (type as MediaKind) : "unknown";
}

/** `sensitive` is the STATUS-level flag: the wire attachment carries none
 * of its own, and it is never guessed per-file. */
export function adaptMedia(m: MediaAttachment, sensitive: boolean): Media {
  const url = m.url ?? m.remote_url ?? null;
  return {
    id: m.id,
    kind: mediaKindOf(m.type),
    // Only Akkoma sends a MIME (`pleroma.mime_type`); absent stays "" —
    // the UI branches on `kind`, never on a faked MIME.
    mimeType: m.pleroma?.mime_type ?? "",
    url,
    previewUrl: m.preview_url ?? url,
    name: "",
    description: m.description ?? null,
    blurhash: m.blurhash ?? null,
    isSensitive: sensitive === true,
    size: null,
    md5: null,
    meta: (m.meta as Record<string, unknown> | null | undefined) ?? null,
    createdAt: null,
    folderId: null,
    userId: null,
  };
}

// --- Polls ------------------------------------------------------------------

/** `expired` is the server's own flag (never derived from the clock here),
 * `votersCount` stays null where the server sends none (Akkoma
 * single-choice) — never coerced from votes. Per-option `voted` comes
 * from `own_votes` (the indices the viewer voted). */
export function adaptPoll(p: WirePoll): Poll {
  const own = Array.isArray(p.own_votes) ? p.own_votes : [];
  return {
    multiple: p.multiple === true,
    expiresAt: p.expires_at ?? null,
    expired: p.expired === true,
    votesCount: typeof p.votes_count === "number" ? p.votes_count : null,
    votersCount: p.voters_count ?? null,
    options: (p.options ?? []).map((o, i) => ({
      text: o.title,
      votesCount: o.votes_count ?? 0,
      voted: own.includes(i),
    })),
  };
}

// --- Reactions (NEVER merged with favourites) -------------------------------

function adaptReactions(list: EmojiReaction[] | undefined): ReactionSummary | null {
  if (!Array.isArray(list)) return null; // no field = no reaction support
  const entries: ReactionEntry[] = [];
  const urls: Record<string, string> = {};
  const myReactions: string[] = [];
  for (const r of list) {
    if (!r || typeof r.name !== "string" || r.name.length === 0) continue;
    entries.push({
      key: r.name,
      count: typeof r.count === "number" ? r.count : 0,
      mine: r.me === true,
      url: typeof r.url === "string" && r.url ? r.url : null,
    });
    if (typeof r.url === "string" && r.url) urls[r.name] = r.url;
    if (r.me === true) myReactions.push(r.name);
  }
  return {
    total: entries.reduce((sum, e) => sum + e.count, 0),
    entries,
    mine: myReactions[0] ?? null,
    myReactions,
    urls,
  };
}

/** Favourites are their own state (vanilla Mastodon only has these).
 * Auth-only rule: `favourited` absent reads `false`, exactly as the
 * Keystodon model documented it. */
function adaptFavourite(status: Status): FavouriteState | null {
  return {
    count: status.favourites_count ?? 0,
    mine: status.favourited === true,
  };
}

// --- Cards / quotes ---------------------------------------------------------

function adaptCard(card: Status["card"]): LinkCard | null {
  if (!card || typeof card.url !== "string") return null;
  return {
    url: card.url,
    title: card.title ?? "",
    description: card.description ?? "",
    image: card.image ?? null,
    type: card.type ?? "",
    authorName: card.author_name ?? null,
    authorUrl: card.author_url ?? null,
    providerName: card.provider_name ?? null,
  };
}

/** Quote field: Mastodon nests `{state, quoted_status}`; Akkoma nests the
 * quoted Status itself (state "accepted"). Handle BOTH shapes — never
 * assume one (contract §6). `quote_id` with no quote object is
 * unavailable (deleted/hidden target), NOT "no quote". */
function adaptQuote(
  quote: Status["quote"],
  quoteId: string | null,
): { quote: Post | null; quoteState: string | null; quoteUnavailable: boolean } {
  if (quote === null || quote === undefined) {
    return { quote: null, quoteState: null, quoteUnavailable: quoteId !== null };
  }
  // Mastodon shape FIRST: `{state, quoted_status}` carries state/quoted_status
  // keys; Akkoma nests the Status itself (no such keys). Never assume one
  // (contract §6).
  if ("quoted_status" in quote || "state" in quote) {
    const state = quote as { state?: string | null; quoted_status?: Status | null };
    return {
      quote: state.quoted_status ? adaptStatus(state.quoted_status) : null,
      quoteState: typeof state.state === "string" ? state.state : null,
      // A Mastodon quote object without `quoted_status`: the server knows of
      // the quote but does not disclose the target.
      quoteUnavailable: !state.quoted_status,
    };
  }
  if ("id" in quote && typeof (quote as Status).id === "string") {
    // Akkoma shape: the status itself.
    return { quote: adaptStatus(quote as Status), quoteState: "accepted", quoteUnavailable: false };
  }
  // A quote object of neither known shape: the relationship exists but the
  // target is undisclosed.
  return { quote: null, quoteState: null, quoteUnavailable: true };
}

function adaptFiltered(list: StatusFilterResult[] | undefined): Array<{ title: string; action: string }> {
  return (list ?? []).map((f) => ({
    title: f.filter?.title ?? "",
    action: f.filter?.filter_action ?? "",
  }));
}

function adaptMentions(list: Mention[] | undefined): {
  mentions: string[];
  mentionUrls: Record<string, string> | undefined;
} {
  const mentions: string[] = [];
  const mentionUrls: Record<string, string> = {};
  for (const m of list ?? []) {
    if (!m || typeof m.id !== "string") continue;
    mentions.push(m.id);
    if (typeof m.url === "string" && m.url) mentionUrls[m.id] = m.url;
  }
  return { mentions, mentionUrls: Object.keys(mentionUrls).length > 0 ? mentionUrls : undefined };
}

// --- Status -----------------------------------------------------------------

export function adaptStatus(status: Status): Post {
  const pleromaReactions = (() => {
    const p = status.pleroma as Record<string, unknown> | undefined;
    if (!p) return undefined;
    for (const key of ["emoji_reactions", "reactions"]) {
      if (Array.isArray(p[key])) return p[key];
    }
    // Last resort: any array in the pleroma bag whose entries look like
    // { name, count }.
    for (const v of Object.values(p)) {
      if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === "object" && "name" in (v[0] as object)) {
        return v;
      }
    }
    return undefined;
  })();
  const reactions = adaptReactions(status.emoji_reactions ?? pleromaReactions);
  const emojis: Record<string, string> = {};
  for (const e of status.emojis ?? []) emojis[e.shortcode] = e.url;
  const quoteParts = adaptQuote(status.quote, status.quote_id || null);
  const { mentions, mentionUrls } = adaptMentions(status.mentions);
  const reblog = status.reblog ? adaptStatus(status.reblog) : null;
  return {
    id: status.id,
    createdAt: status.created_at,
    author: adaptAccount(status.account),
    accountId: status.account?.id ?? "",
    content: statusContentOf(status),
    cw: (status.spoiler_text ?? "").length > 0 ? status.spoiler_text : null,
    visibility: visibilityOfWire(status.visibility),
    counts: {
      replies: status.replies_count ?? 0,
      boosts: status.reblogs_count ?? 0,
      quotes: status.quotes_count ?? 0,
      // The reaction count is the emoji-reaction sum where the extension
      // is present; vanilla Mastodon reports none (0).
      reactions: reactions ? reactions.total : 0,
      favourites: status.favourites_count ?? 0,
    },
    // Favourites and reactions stay SEPARATE (keystodon.md §1.5). The
    // Misskey adapter leaves `favourite` null; here `reactions` is null
    // on vanilla Mastodon and both coexist on Akkoma.
    reactions,
    favourite: adaptFavourite(status),
    media: (status.media_attachments ?? []).map((m) => adaptMedia(m, status.sensitive === true)),
    mediaIds: (status.media_attachments ?? []).map((m) => m.id),
    poll: status.poll ? adaptPoll(status.poll) : null,
    card: adaptCard(status.card),
    quote: quoteParts.quote,
    quoteState: quoteParts.quoteState,
    quoteUnavailable: quoteParts.quoteUnavailable,
    // The plan's "renote/reblog": a boost wrapper carries the original.
    renote: reblog,
    reply: null,
    replyToId: status.in_reply_to_id ?? null,
    renoteId: status.reblog ? status.reblog.id : null,
    uri: status.uri,
    url: status.url ?? null,
    emojis,
    mentions,
    tags: (status.tags ?? []).map((t) => t.name),
    editedAt: status.edited_at ?? null,
    filtered: adaptFiltered(status.filtered),
    pinned: status.pinned === true,
    ext: {
      ...(status.bookmarked !== undefined
        ? { bookmarked: status.bookmarked === true }
        : {}),
      ...(status.reblogged !== undefined
        ? { reblogged: status.reblogged === true }
        : {}),
      ...(mentionUrls ? { mentionUrls } : {}),
    },
  };
}

// --- Edit history (clickstone §1.7) -----------------------------------------

/** One `StatusEdit` → core `PostRevision`. `original` is decided by the
 * CALLER (index 0 of the server's oldest-first list), because only the
 * whole array knows which revision is the creation snapshot. Media carry
 * their revision-level descriptions; the status-level `sensitive` flag is
 * passed to each attachment (the wire attachment has no own flag). Pure. */
export function adaptStatusEdit(edit: StatusEdit, original: boolean): PostRevision {
  return {
    content: htmlContentOf(edit.content ?? ""),
    cw: edit.spoiler_text && edit.spoiler_text.length > 0 ? edit.spoiler_text : null,
    sensitive: edit.sensitive === true,
    createdAt: edit.created_at,
    media: (edit.media_attachments ?? []).map((m) => adaptMedia(m, edit.sensitive === true)),
    accountId: edit.account?.id ?? null,
    original,
  };
}

/**
 * Adapt the raw `GET /api/v1/statuses/:id/history` answer. The server is
 * OLDEST-FIRST (`StatusEdit.ordered`) with the creation snapshot at index
 * 0; the UI wants newest-first (Mastodon web reverses it too:
 * `reducers/history.js` maps `original: i === 0` then `.reverse()`), so the
 * result is reversed here and every revision keeps its honest `original`
 * flag. An empty answer stays empty — never a fabricated single revision.
 */
export function adaptStatusHistory(edits: readonly StatusEdit[]): PostRevision[] {
  const list = [...edits];
  const out = list.map((edit, i) => adaptStatusEdit(edit, i === 0));
  out.reverse();
  return out;
}

// --- Relationships ----------------------------------------------------------

/** Absent optional flags stay ABSENT (unknown, never false). `requested_by`
 * is an Akkoma extension (Mastodon sends it from 4.x too, but not on every
 * version — present-only mapping). `isRenoteMuted` is the boost mute: it
 * only exists while following (`showing_reblogs` is false for everyone you
 * do not follow). */
export function adaptRelationship(rel: WireRelationship): Relationship {
  return {
    id: rel.id,
    isFollowing: rel.following === true,
    isFollowed: rel.followed_by === true,
    isBlocking: rel.blocking === true,
    isBlocked: rel.blocked_by === true,
    isMuted: rel.muting === true,
    isRenoteMuted: rel.following === true && rel.showing_reblogs === false,
    hasPendingFollowRequestFromYou: rel.requested === true,
    ...(rel.requested_by !== undefined
      ? { hasPendingFollowRequestToYou: rel.requested_by === true }
      : {}),
  };
}

// --- Announcements (clickstone §1.12) ---------------------------------------

/**
 * Mastodon announcement → core `Announcement`.
 *
 * Mastodon announcements have NO title, NO severity and NO image: those
 * model fields stay null rather than being filled with invented text. The
 * body is server HTML (`linkify(object.text)`) and goes through the one
 * allow-listed AST parser at render time (`html` source + plain
 * projection), never as raw markup. `read` exists only for an authenticated
 * request, so it stays `null` otherwise — never fabricated as `false`.
 * `published_at` is the publication moment the server exposes; a row that
 * omitted it reads "" (the list screen sorts it last rather than inventing
 * a date).
 */
export function adaptAnnouncement(raw: WireAnnouncement): CoreAnnouncement {
  return {
    id: String(raw.id ?? ""),
    title: null,
    content: htmlContentOf(raw.content),
    createdAt: typeof raw.published_at === "string" ? raw.published_at : "",
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
    imageUrl: null,
    icon: null,
    needConfirmationToRead: false,
    startsAt: typeof raw.starts_at === "string" ? raw.starts_at : null,
    endsAt: typeof raw.ends_at === "string" ? raw.ends_at : null,
    allDay: raw.all_day === true,
    isRead: typeof raw.read === "boolean" ? raw.read : null,
  };
}

// --- Notifications (Phase 3 addition: no adapter existed) -------------------

const NOTIFICATION_KINDS: Record<string, NotificationKind> = {
  mention: "mention",
  follow: "follow",
  follow_request: "receiveFollowRequest",
  reblog: "renote",
  quote: "quote",
  favourite: "favourite",
  poll: "pollEnded",
  "pleroma:emoji_reaction": "reaction",
};

/**
 * Flat Mastodon-family notification rows → core Notification. One actor
 * per row (the wire's `account`); rows without a packed account carry NO
 * actor (never an id-only actor — the wire names no id). `type` is an
 * extensible string: anything outside the known set maps to kind
 * `unknown` with `rawType` kept verbatim (the generic row), never rounded
 * up into a known kind. `read` is only ever true/false where the wire
 * packed Akkoma's `pleroma.is_seen` — absent stays null. The favourite
 * kind stays DISTINCT from `reaction` (keystodon.md §1.5).
 * Grouped rows (`notification_groups`) take the group branch inside: the
 * group key is the row id, `sample_account_ids` resolve against the
 * envelope's `accounts` (ids the envelope did not pack stay id-only
 * actors — the wire DOES name those ids, unlike flat rows), `status_id`
 * resolves against the envelope's `statuses`, and the server's
 * `notifications_count` is preserved in `ext.groupedCount`.
 */
export function adaptV2Notification(
  item: Record<string, unknown>,
  accounts: Map<string, Record<string, unknown>>,
  statuses: Map<string, Record<string, unknown>> = new Map(),
): Notification {
  // A real `notification_groups` envelope sends GROUPS (a `group_key`,
  // server count, sampled actor ids, a status id) instead of flat rows.
  // Anything without a `group_key` is the expanded flat row shape
  // (`account_id` + packed `status`).
  if (typeof item.group_key === "string") {
    return adaptV2Group(item, accounts, statuses);
  }
  const type = typeof item.type === "string" ? item.type : "unknown";
  const kind: NotificationKind = NOTIFICATION_KINDS[type] ?? "unknown";
  const accountId = typeof item.account_id === "string" ? item.account_id : null;
  const rawAccount = accountId ? accounts.get(accountId) : null;
  const account = rawAccount ? adaptAccount(rawAccount as any) : null;
  const reaction =
    kind === "reaction" && typeof item.emoji === "string" && item.emoji.length > 0
      ? item.emoji
      : null;
  const actors = account ? [{ id: account.id, account, reaction }] : [];
  const status = item.status ? adaptStatus(item.status as any) : null;
  return {
    id: String(item.id ?? ""),
    kind,
    rawType: type,
    createdAt: typeof item.created_at === "string" ? item.created_at : new Date().toISOString(),
    read: null,
    actors,
    post: status,
    reaction,
    ext: {},
  };
}

/**
 * One `notification_groups` entry → core Notification. The envelope packs
 * each actor and status once; the group only names them, so an unknown
 * sample id degrades to an id-only actor and an unknown `status_id` to a
 * null post instead of dropping the row. The server's
 * `notifications_count` is preserved in `ext.groupedCount` (never rounded
 * into the actor list). The grouped endpoint reports no read state
 * (Misskey grouped precedent). Reaction fan-out mirrors the flat rule:
 * a group-level emoji counts only for reaction-kind groups — absent stays
 * null, never fabricated.
 */
function adaptV2Group(
  group: Record<string, unknown>,
  accounts: Map<string, Record<string, unknown>>,
  statuses: Map<string, Record<string, unknown>>,
): Notification {
  const groupKey = group.group_key as string;
  const type = typeof group.type === "string" ? group.type : "unknown";
  const kind: NotificationKind = NOTIFICATION_KINDS[type] ?? "unknown";
  const reaction =
    kind === "reaction" && typeof group.emoji === "string" && group.emoji.length > 0
      ? group.emoji
      : null;
  const sampleIds = Array.isArray(group.sample_account_ids)
    ? group.sample_account_ids.map((id) => String(id))
    : [];
  const seen = new Set<string>();
  const actors: NotificationActor[] = [];
  for (const id of sampleIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rawAccount = accounts.get(id);
    const account = rawAccount ? adaptAccount(rawAccount as any) : null;
    actors.push({ id, account, reaction });
  }
  const statusId = typeof group.status_id === "string" ? group.status_id : null;
  const rawStatus = statusId ? statuses.get(statusId) : null;
  const status = rawStatus ? adaptStatus(rawStatus as any) : null;
  const count =
    typeof group.notifications_count === "number" && Number.isFinite(group.notifications_count)
      ? group.notifications_count
      : null;
  return {
    id: groupKey,
    kind,
    rawType: type,
    createdAt:
      typeof group.latest_page_notification_at === "string"
        ? group.latest_page_notification_at
        : new Date().toISOString(),
    read: null,
    actors,
    post: status,
    reaction,
    ext: count === null ? {} : { groupedCount: count },
  };
}

export function adaptNotification(item: WireNotification): Notification {
  const kind: NotificationKind = NOTIFICATION_KINDS[item.type] ?? "unknown";
  const account = item.account ? adaptAccount(item.account) : null;
  const reaction =
    kind === "reaction"
      ? typeof item.emoji === "string" && item.emoji.length > 0
        ? item.emoji
        : null
      : null;
  const actors: NotificationActor[] = account
    ? [{ id: account.id, account, reaction }]
    : [];
  return {
    id: item.id,
    kind,
    rawType: item.type,
    createdAt: item.created_at,
    read: typeof item.pleroma?.is_seen === "boolean" ? item.pleroma.is_seen : null,
    actors,
    post: item.status ? adaptStatus(item.status) : null,
    reaction,
    ext: {},
  };
}

// --- Cursors and pages ------------------------------------------------------

/**
 * The core `Cursor` hides the Mastodon continuation (contract §5): a
 * server next-URL (same-origin, verified in `pagination.nextContinuation`)
 * or its carried-over cursor params. Opaque to the UI — encode/decode
 * live here only.
 */
export function encodeContinuation(cont: Continuation | null): Cursor | null {
  if (cont === null) return null;
  return JSON.stringify(cont) as Cursor;
}

export function decodeContinuation(
  cursor: Cursor | null | undefined,
): Continuation | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor as string) as Continuation;
    if (parsed && parsed.kind === "url" && typeof parsed.url === "string") return parsed;
    if (parsed && parsed.kind === "cursors" && parsed.cursors && typeof parsed.cursors === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * One adapted page. `end` follows contract §5 (and core/models.ts's
 * per-adapter rule): NO next continuation OR an empty page — never
 * `items.length < limit`.
 */
export function pageOf<T, R>(
  items: T[],
  continuation: Continuation | null,
  adapt: (t: T) => R,
): Page<R> {
  const mapped = items.map(adapt);
  return {
    items: mapped,
    cursor: encodeContinuation(continuation),
    end: continuation === null || mapped.length === 0,
  };
}
