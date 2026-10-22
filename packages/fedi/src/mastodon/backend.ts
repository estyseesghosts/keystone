// MastodonBackend — the Mastodon family's implementation of
// `core/backend.Backend` (plan §3 Phase 3 item 2).
//
// Keystodon's endpoint/action modules live BEHIND it: `endpoints.ts` (the
// typed wire calls, one place per endpoint), `statusActions.ts`
// (favourite, reblog, Pleroma emoji reactions), `thread.ts` (context →
// tree), `quoteMarker.ts` + `presentation.ts` + `sanitize.ts` (the pure
// rendering pipeline the shared PostCard consumes). This file adapts at
// the boundary: core `PostDraft` → wire bodies, wire responses →
// `core/models`, and EVERY transport error → the UI's shared `ApiError`
// (so `isUnsupportedError`/`isPermissionError` work identically on both
// families).
//
// Contract rules that bind here (docs/mastoapi-contract.md):
// - Paging: `Link rel="next"` continuations hide behind the opaque core
//   `Cursor` (`adapt.encodeContinuation`); end-of-feed is a missing next
//   link or an empty page — NEVER `items.length < limit` (§5).
// - 404/405 ≈ endpoint absent ("not on this server"); 401/403 is an
//   auth/scope problem, never absence (§3).
// - Favourites and reactions stay separate (keystodon.md §1.5): the
//   reaction paths are the Pleroma/Akkoma extension only, and
//   `accountReactions` has NO MastoAPI equivalent (favourites are never
//   repackaged as reactions) — it answers the honest unsupported state.
// - Absent features answer typed unsupported errors, never silent
//   success: Misskey-only surfaces (featured listings on vanilla
//   Mastodon, avatar/banner profile fields) have no endpoint here.
// - `stream()` is null until Phase 6 (Keystodon deferred streaming;
//   every feed keeps refresh + cursor paging).
//
// The transport is injectable for tests (a `MastoClient`); the live one
// resolves the ACTIVE Mastodon-family session per call, exactly as
// `apiCall` does on the Misskey family — an external token never reaches
// another origin (`client.ts` enforces it).

import type {
  Account,
  Media,
  Notification,
  Page,
  Post,
  Relationship,
} from "../core/models";
import type {
  AccountPostsOpts,
  Backend,
  CustomEmoji,
  ExploreUsers,
  Filter,
  FilterKeyword,
  FollowRequest,
  NewsLink,
  InstanceRule,
  ListFields,
  ListRepliesPolicy,
  ListSummary,
  NotificationsOpts,
  PageOpts,
  PostDraft,
  ProfileUpdate,
  ScheduledNote,
  SearchPostsOpts,
  StreamHandle,
  TimelineKind,
  Translation,
  TrendingTag,
  UserReaction,
} from "../core/backend";
import type { Capabilities, DetectionEvidence, ServerFlavor } from "../core/detect";
import { buildCapabilities } from "../core/detect";
import { ApiError, FediError } from "../core/errors";
import {
  adaptCredentialAccount,
  adaptMedia,
  adaptNotification,
  adaptV2Notification,
  adaptRelationship,
  adaptStatus,
  decodeContinuation,
  encodeContinuation,
  htmlToPlainText,
  pageOf,
} from "./adapt";
import type { ContinuationPage, SearchResult, TimelinePageOptions } from "./endpoints";
import {
  answerFollowRequest,
  deleteStatus,
  editStatus,
  fetchAccountListPage,
  fetchAccountStatusesPage,
  fetchCustomEmojis,
  fetchFollowRequestsPage,
  fetchNotificationsPage,
  fetchInstanceRules,
  fetchScheduledStatusesPage,
  fetchStatusAccountPage,
  fetchV2NotificationRows,  fetchSuggestions,
  fetchTimelinePage,
  fetchTagTimelinePage,
  fetchTrendingLinks,
  fetchTrendingStatuses,
  fetchTrendingTags,
  getAccount,
  getMedia,
  getRelationships,
  getStatus,
  getStatusContext,
  markNotificationsRead,
  muteStatusThread,
  reportAccount,
  resolveAccountByHandle,
  searchV2,
  setBlocked,
  setFollowing,
  setMuted,
  setStatusPinned,
  setShowingReblogs,
  translateStatus,
  voteInPoll,
} from "./endpoints";
import { createStatus, setEmojiReaction, setStatusToggle } from "./statusActions";
import { newIdempotencyKey, statusBodyOf } from "./compose";
import { rebuildThread } from "./thread";
import { createStreamHandle } from "./stream";
import { createClient, toApiError as clientToApiError } from "./client";
import type { MastoClient, QueryValue } from "./client";
import { listsContaining as listsContainingMasto, addToList as addToListMasto, removeFromList as removeFromListMasto } from "./listMembership";
import {
  deleteFeaturedTag,
  featureTag,
  fetchFeaturedTags,
  fetchFollowedTagsPage,
  followTag,
  getTag,
  unfeatureTag,
  unfollowTag,
} from "./tags";
import { blockDomain, fetchDomainBlocksPage, unblockDomain } from "./domainBlocks";
import type { Continuation } from "./pagination";
import { nextContinuation, withCursors } from "./pagination";
import type {
  CredentialAccount,
  MediaAttachment,
  ListRow,
  ScheduledStatus as WireScheduledStatus,
  Status as WireStatus,
} from "./wire";

// --- Error adaptation (the one boundary) -----------------------------------

/**
 * Transport errors become the UI's shared `ApiError` AT the boundary (see
 * `client.toApiError` — the canonical implementation lives there so
 * direct endpoint/oauth/instance callers can adapt too). A timeout keeps
 * `kind: "timeout"` — it is never "endpoint unsupported".
 */
export function toApiError(err: unknown): unknown {
  return clientToApiError(err);
}

/** The server has no such endpoint (contract §3: 404/405 mean absent —
 * never silent success, never an auth problem). Used for v2-first with
 * v1-fallback probing: only absence falls back, everything else rethrows. */
function isAbsentError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

/** Wrap a client so every call adapts its errors (see `toApiError`). */
function guarded(client: MastoClient): MastoClient {
  const wrap = <T>(run: () => Promise<T>): Promise<T> =>
    run().catch((err: unknown) => {
      throw toApiError(err);
    });
  return {
    origin: client.origin,
    token: client.token,
    get: (path, query, opts) => wrap(() => client.get(path, query, opts)),
    post: (path, json, opts) => wrap(() => client.post(path, json, opts)),
    put: (path, json, opts) => wrap(() => client.put(path, json, opts)),
    patch: (path, json, opts) => wrap(() => client.patch(path, json, opts)),
    delete: (path, json, opts) => wrap(() => client.delete(path, json, opts)),
    postForm: (path, form, opts) => wrap(() => client.postForm(path, form, opts)),
    postFormData: (path, formData, opts) =>
      wrap(() => client.postFormData(path, formData, opts)),
  };
}

/** The honest answer for a surface this family cannot serve. Status 404
 * so the UI's "not on this server" states trigger exactly as they do for
 * a missing Misskey endpoint. Messages are the fixed English fallbacks;
 * `code` carries the stable identity the UI localizes. */
type UnsupportedKey =
  | "errors.unsupported.pinned"
  | "errors.unsupported.social"
  | "errors.unsupported.reactions"
  | "errors.unsupported.featured"
  | "errors.unsupported.avatar";

const UNSUPPORTED_MESSAGES: Record<UnsupportedKey, string> = {
  "errors.unsupported.pinned": "Pinned-post listings are not available on this server.",
  "errors.unsupported.social": "The social timeline is not available on this server.",
  "errors.unsupported.reactions": "Reaction listings are not available on this server.",
  "errors.unsupported.featured": "The featured-notes listing is not available on this server.",
  "errors.unsupported.avatar": "Avatar and banner changes are not supported on the Mastodon family yet.",
};

function unsupported(key: UnsupportedKey): never {
  throw new ApiError(UNSUPPORTED_MESSAGES[key], 404, key);
}

// --- Notification filter tokens → wire types --------------------------------
//
// `NotificationsOpts.includeTypes` carries the core preset tokens
// (core/backend.NOTIFICATION_FILTER_PRESETS); the WIRE types differ per
// family (contract §6). Known tokens map; the preset is a filter, never a
// model merge — a `favourite` row is still kind "favourite".

const NOTIF_WIRE_TYPES: Record<string, string[]> = {
  mention: ["mention"],
  reply: ["mention"],
  reaction: ["favourite", "pleroma:emoji_reaction"],
  renote: ["reblog"],
  quote: ["quote"],
  follow: ["follow"],
  receiveFollowRequest: ["follow_request"],
  followRequestAccepted: [],
  pollVote: [],
  pollEnded: ["poll"],
};

function wireNotificationTypes(tokens: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const token of tokens ?? []) {
    for (const wire of NOTIF_WIRE_TYPES[token] ?? []) out.add(wire);
  }
  return [...out];
}

// --- Server-filter mapping (v2 groups vs v1 keywords) -----------------------
//
// Mastodon v2 (`/api/v2/filters`) speaks filter GROUPS — `{id, title,
// context[], expires_at, filter_action, keywords: [{id, keyword,
// whole_word}]}` — while v1 (`/api/v1/filters`, still present on
// Mastodon and the ONLY shape on Akkoma/Pleroma) speaks single keywords
// — `{id, phrase, context[], expires_at, irreversible, whole_word}`.
// The core `Filter` keeps the phrase-shaped v1 fields (`phrase` is the
// first keyword, what the UI edits) AND the full `keywords` list, so a
// multi-keyword v2 group is neither hidden nor destroyed on edit:
// `filter_action: "hide"` is the v2 irreversible. v1 has no
// `filter_action` — it stays absent, never fabricated.

/** Wire keyword row → core keyword. Missing text becomes "" (the adapter
 * never invents a phrase) and `whole_word` defaults to false. */
function adaptFilterKeyword(k: Record<string, unknown>, fallbackId: string): FilterKeyword {
  return {
    id: k.id != null ? String(k.id) : fallbackId,
    keyword: typeof k.keyword === "string" ? k.keyword : "",
    wholeWord: k.whole_word === true,
  };
}

function adaptV1FilterRow(f: Record<string, unknown>, phraseFallback: string): Filter {
  const id = String(f.id ?? "");
  const phrase = typeof f.phrase === "string" ? f.phrase : phraseFallback;
  const wholeWord = f.whole_word === true;
  return {
    id,
    phrase,
    context: Array.isArray(f.context) ? f.context.map(String) : [],
    expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
    irreversible: f.irreversible === true,
    wholeWord,
    // v1: the row and its single keyword are the same object.
    keywords: [{ id, keyword: phrase, wholeWord }],
  };
}

function adaptV2FilterRow(f: Record<string, unknown>): Filter {
  const raw = Array.isArray(f.keywords) ? f.keywords : [];
  const id = String(f.id ?? "");
  const keywords = raw
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => adaptFilterKeyword(k, id));
  const first = keywords[0];
  const title = typeof f.title === "string" ? f.title : null;
  const phrase = first && first.keyword.length > 0 ? first.keyword : (title ?? "");
  // A compliant server always sends >= 1 keyword; a keyword-less payload
  // (fork quirk) still reads as the single phrase the group is named
  // after — the list is never empty while a phrase exists.
  if (keywords.length === 0 && phrase.length > 0) {
    keywords.push({ id, keyword: phrase, wholeWord: false });
  }
  return {
    id,
    // Every keyword is carried in `keywords`; `phrase`/`wholeWord` are the
    // first one (the row the UI edits), never the whole group.
    phrase,
    context: Array.isArray(f.context) ? f.context.map(String) : [],
    expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
    irreversible: f.filter_action === "hide",
    wholeWord: first?.wholeWord === true,
    keywords,
  };
}

/** Core `expiresAt` (ISO) → wire `expires_in` (seconds from now): BOTH
 * filter versions take seconds, never a date. Null/undefined stays
 * absent — clearing an expiry is not portable, so it is never sent. */
function filterExpiresIn(expiresAt: string | null | undefined): number | undefined {
  if (typeof expiresAt !== "string" || expiresAt.length === 0) return undefined;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.round((ms - Date.now()) / 1000));
}

/** v2-first with v1-fallback: only 404/405 (no such endpoint here —
 * Akkoma/Pleroma) fall back; anything else rethrows. When BOTH are
 * absent the v1 error propagates as the honest unsupported state. */
async function withFilterFallback<T>(
  runV2: () => Promise<T>,
  runV1: () => Promise<T>,
): Promise<T> {
  try {
    return await runV2();
  } catch (err) {
    if (!isAbsentError(err)) throw err;
    return runV1();
  }
}

// --- Lists (clickstone §1.6) ------------------------------------------------

const LIST_REPLIES_POLICIES: readonly ListRepliesPolicy[] = ["none", "followed", "list"];

/** The three policy values are the `List` enum (`list`, `followed`,
 * `none`); anything else the server sends is not guessed at. */
export function knownRepliesPolicy(value: unknown): ListRepliesPolicy | undefined {
  return typeof value === "string" && (LIST_REPLIES_POLICIES as readonly string[]).includes(value)
    ? (value as ListRepliesPolicy)
    : undefined;
}

/** `ListRow` → core `ListSummary`. `title` is the name; the extras ride
 * only when the server reported a known value (the Misskey-backed and
 * Akkoma rows carry no policy at all). */
export function adaptListRow(row: ListRow, fallbackName?: string): ListSummary {
  const out: ListSummary = {
    id: row.id,
    name: typeof row.title === "string" ? row.title : (fallbackName ?? ""),
  };
  const policy = knownRepliesPolicy(row.replies_policy);
  if (policy !== undefined) out.repliesPolicy = policy;
  if (typeof row.exclusive === "boolean") out.exclusive = row.exclusive;
  return out;
}

/** Create/update body: `title` always, then each optional field ONLY when
 * the caller chose it and the server reports the capability as
 * `supported`. Unknown and unsupported both omit the field — a server that
 * rejects unknown params (Sharkey 400s; Akkoma's CastAndValidate) never
 * sees one. */
export function listFieldsBody(
  fields: ListFields,
  capabilities: Capabilities,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const policy = knownRepliesPolicy(fields.repliesPolicy);
  if (policy !== undefined && capabilities.lists_replies_policy === "supported") {
    out.replies_policy = policy;
  }
  if (typeof fields.exclusive === "boolean" && capabilities.lists_exclusive === "supported") {
    out.exclusive = fields.exclusive;
  }
  return out;
}

// --- The backend ------------------------------------------------------------

export interface MastodonBackendOptions {
  /** Detected flavor (from the session / login detection). */
  flavor?: ServerFlavor;
  /** Detection evidence (feature flags from instance metadata). */
  evidence?: DetectionEvidence;
  /** Advertised streaming origin (`instance.ts` `streamingOrigin` — the
   * `configuration.urls.streaming` host, which may differ from the REST
   * origin). Falls back to the session origin when absent (MD10). */
  streamingOrigin?: string | null;
}

const DEFAULT_LIMIT = 20;

export function createMastodonBackend(
  rawClient: MastoClient = createClient("https://example.invalid", null),
  opts: MastodonBackendOptions = {},
): Backend {
  const client = guarded(rawClient);
  const flavor: ServerFlavor = opts.flavor ?? "unknown";
  const streamOrigin = opts.streamingOrigin ?? null;
  const capabilities: Capabilities = buildCapabilities(flavor, opts.evidence ?? {});

  // --- paging seams -------------------------------------------------------

  function continuationOf(cursor: PageOpts["cursor"]): Continuation | null {
    return decodeContinuation(cursor ?? null);
  }

  function toPage<T>(page: ContinuationPage<T>): Page<T> {
    return {
      items: page.items,
      cursor: encodeContinuation(page.continuation),
      // Contract §5: no next link OR an empty page.
      end: page.end,
    };
  }

  /** One adapted search page (v2 search mixes result kinds, so the
   * continuation applies to the whole answer while this maps only the
   * requested kind). Same §5 end rule: only the server's absent next
   * Link ends the feed — a full page without one stays the end (never a
   * length heuristic, never an invented cursor). */
  function toSearchPage<T>(result: SearchResult, items: T[]): Page<T> {
    return toPage({
      items,
      continuation: result.continuation,
      end: result.continuation === null || items.length === 0,
    });
  }

  function pageOpts(opts: PageOpts): TimelinePageOptions {
    const cont = continuationOf(opts.cursor);
    return cont
      ? { continuation: cont }
      : { limit: opts.limit ?? DEFAULT_LIMIT };
  }

  async function listAccounts(
    kind: "followers" | "following" | "mutes" | "blocks",
    id: string,
    opts: PageOpts,
  ): Promise<Page<Account>> {
    const page = await fetchAccountListPage(client, id, kind, pageOpts(opts));
    return toPage(page);
  }

  // Declared before the returned object so `this` is never needed (a
  // destructured method must behave the same as `backend.method()`).
  async function unreact(id: string): Promise<void> {
    // Pleroma allows several reactions per account: clear the caller's
    // current set (contract §9 DELETE per emoji).
    const post = await getStatus(client, id);
    for (const key of post.reactions?.myReactions ?? []) {
      await setEmojiReaction(client, id, key, false);
    }
  }

  async function accountFeaturedPosts(id: string, opts: PageOpts = {}): Promise<Page<Post>> {
    // Akkoma/Pleroma answer `pinned=true` on the statuses endpoint
    // (contract §4); vanilla Mastodon has no pinned listing — never
    // show an unpinned feed pretending to be featured.
    if (flavor !== "akkoma" && flavor !== "pleroma") {
      unsupported("errors.unsupported.pinned");
    }
    const page = await fetchAccountStatusesPage(
      client,
      id,
      { exclude_replies: true, pinned: true },
      pageOpts(opts),
    );
    return toPage(page);
  }

  async function me(): Promise<Account> {
    return adaptCredentialAccount(await verifySelf(client));
  }

  // The followee on incoming-request rows is the viewer: fetched once per
  // backend instance and reused (MD7 — one `verify_credentials` per
  // handle, not one per `followRequests()` call). The guarded client is
  // bound to one (origin, token) pair, so the cache cannot serve another
  // session's account.
  let selfCache: Account | null = null;
  async function cachedSelf(): Promise<Account> {
    if (!selfCache) selfCache = await me();
    return selfCache;
  }

  return {
    family: "mastodon",
    capabilities,

    // --- Feeds and posts ---------------------------------------------------

    async timeline(kind: TimelineKind, opts: PageOpts = {}) {
      // Social has no MastoAPI equivalent (Misskey `notes/hybrid-timeline`):
      // never an empty feed pretending to be social.
      if (kind === "social") {
        unsupported("errors.unsupported.social");
      }
      return toPage(await fetchTimelinePage(client, kind, pageOpts(opts)));
    },

    post(id) {
      return getStatus(client, id);
    },

    async thread(post) {
      // The flat context rebuilds into the ancestor chain (contract §4:
      // `/context` returns flat lists; the tree is client-side). The chain
      // is incomplete when the root names a parent the server did not
      // deliver (the Misskey adapter's "conversation 404" analogue).
      const context = await getStatusContext(client, post.id);
      const structure = rebuildThread(post, context.ancestors, context.descendants);
      const chain = structure.chain;
      const incomplete =
        post.replyToId !== null &&
        (chain.length === 0 || chain[chain.length - 1].id !== post.replyToId);
      return { ancestors: chain, incomplete };
    },

    async threadReplies(id, opts: PageOpts = {}) {
      // `/context` is one un-paged answer (contract §4): the direct
      // children of `id` arrive as a single page. The cursor seam still
      // works — continuation pages are empty here.
      const cont = continuationOf(opts.cursor);
      if (cont) return { items: [], cursor: null, end: true };
      const context = await getStatusContext(client, id);
      const children = context.descendants.filter((p) => p.replyToId === id);
      return { items: children, cursor: null, end: true };
    },

    async reposts(id, opts: PageOpts = {}) {
      // The detail "Reposts" tab on this family: the accounts that
      // boosted the status. Same Link-paged account shape as the
      // follow lists, so no new row UI is needed.
      return toPage(await fetchStatusAccountPage(client, id, "reblogged_by", pageOpts(opts)));
    },

    async noteReactions() {
      // No per-note reactor listing exists on this family (contract
      // §4) — and favourites are never repackaged as reactions
      // (keystodon.md §1.5). The UI shows the honest unavailable
      // state instead of a favourite list pretending to be reactions.
      unsupported("errors.unsupported.reactions");
    },

    async createPost(draft: PostDraft) {
      const body = statusBodyOf(draft);
      // Idempotency-Key per logical attempt (contract §1): one key per
      // attempt, kept across retries of that attempt (compose.ts's
      // attemptKeyFor owns the identity rules at the composer seam).
      return createStatus(client, body, newIdempotencyKey());
    },

    async deletePost(id) {
      await deleteStatus(client, id);
    },

    async editPost(id, draft: PostDraft) {
      // Edits write back `visibility.raw` (plan §2.1): a `local` post is
      // edited as `local`, never rewritten.
      return editStatus(client, id, statusBodyOf(draft));
    },

    async react(id, reaction) {
      if (reaction == null) {
        await unreact(id);
        return;
      }
      await setEmojiReaction(client, id, reaction, true);
    },

    unreact,

    async favourite(id) {
      await setStatusToggle(client, id, "favourite", true);
    },

    async unfavourite(id) {
      await setStatusToggle(client, id, "favourite", false);
    },

    async boost(id) {
      // The reblog answer is the wrapper; core `renote` carries the
      // original (contract §6).
      return setStatusToggle(client, id, "reblog", true);
    },

    async unboost(id) {
      await setStatusToggle(client, id, "reblog", false);
    },

    async votePoll(id, choices) {
      await voteInPoll(client, id, choices);
    },

    resolveQuoteUri(uri: string): Promise<Post | null> {
      // Textual `RE:` fallback via `/api/v2/search` + strict URI match
      // (plan §3 Phase 3 item 4; `quoteMarker.pickQuotedStatus` decides
      // what counts as THE target). Every failure resolves null so the
      // caller keeps the raw `RE:` text.
      return resolveQuote(client, uri);
    },

    async featuredPosts() {
      // Misskey `notes/featured` has no MastoAPI equivalent (contract §4).
      unsupported("errors.unsupported.featured");
    },

    accountFeaturedPosts,

    // --- Accounts ----------------------------------------------------------

    me,

    async account(ref) {
      if (ref.id) return getAccount(client, ref.id);
      const acct = ref.host ? `${ref.username}@${ref.host}` : ref.username;
      if (!acct)
        throw new ApiError("No account reference given.", 400, "errors.unsupported.noAccountRef");
      // Handle lookup with older-server fallbacks (MD8 — `lookup` 404s
      // on servers without it; search paths need `read:search`, already
      // in the OAuth scope set; a strict-server 403 stays a 403).
      return resolveAccountByHandle(client, acct);
    },

    async accountPosts(id, opts: AccountPostsOpts = {}) {
      if (opts.featured) {
        return accountFeaturedPosts(id, opts);
      }
      // Core options map to the wire filters (contract §4): posts tab
      // sends explicit `false`s the server does not default to.
      const page = await fetchAccountStatusesPage(
        client,
        id,
        {
          exclude_replies: opts.withReplies === false,
          exclude_reblogs: opts.withRenotes === false,
          only_media: opts.withFiles === true,
        },
        pageOpts(opts),
      );
      return toPage(page);
    },

    followers(id, opts) {
      return listAccounts("followers", id, opts ?? {});
    },

    following(id, opts) {
      return listAccounts("following", id, opts ?? {});
    },

    async relationships(ids) {
      if (ids.length === 0) return [];
      return getRelationships(client, ids);
    },

    async follow(id) {
      // The follow answer is a Relationship, not a state change the UI
      // trusts (mirrors the Misskey family: callers re-read).
      await setFollowing(client, id, true);
    },

    async unfollow(id) {
      await setFollowing(client, id, false);
    },

    async accountReactions() {
      // `users/reactions` has no MastoAPI equivalent — and favourites are
      // NEVER repackaged as reactions (keystodon.md §1.5).
      unsupported("errors.unsupported.reactions");
    },

    async pinPost(id) {
      await setStatusPinned(client, id, true);
    },

    async unpinPost(id) {
      await setStatusPinned(client, id, false);
    },

    async followRequests(opts: PageOpts = {}): Promise<FollowRequest[]> {
      // The wire list is accounts; the core row pairs follower+followee
      // (the followee is the viewer on incoming requests). One Link page
      // per call: the historical default is one 40-row page (MD7) unless
      // the caller passes its own limit/cursor — the array return stays
      // BACKWARD-COMPAT (no cursor is threaded back; full paging rides
      // the exported endpoint + continuation directly).
      const self = await cachedSelf();
      const paging = pageOpts(opts);
      if (paging.continuation == null && opts.limit === undefined) paging.limit = 40;
      const page = await fetchFollowRequestsPage(client, paging);
      return page.items.map((follower) => ({ id: follower.id, follower, followee: self }));
    },

    async acceptFollowRequest(id) {
      await answerFollowRequest(client, id, true);
    },

    async rejectFollowRequest(id) {
      await answerFollowRequest(client, id, false);
    },

    async cancelFollowRequest(id) {
      // An outgoing pending request is undone by unfollowing (contract §4:
      // follow → `requested: true`; unfollow clears it).
      await setFollowing(client, id, false);
    },

    async updateProfile(patch: ProfileUpdate) {
      // Contract §6 self-verify: display_name / note / locked round-trip;
      // avatar/banner are multipart uploads with no id mapping (contract
      // §7 — `avatarId` is the Misskey drive shape) and are honestly
      // refused rather than silently dropped.
      if (patch.avatarId || patch.bannerId) {
        unsupported("errors.unsupported.avatar");
      }
      // Misskey-family-only generics have NO update_credentials field:
      // refused honestly (never silently dropped — MD6). The app's
      // profile editor disables these rows on this family, so this
      // throws only for direct callers.
      const unsupportedFields: string[] = [];
      if (patch.location !== undefined) unsupportedFields.push("location");
      if (patch.birthday !== undefined) unsupportedFields.push("birthday");
      if (patch.followedMessage !== undefined) unsupportedFields.push("followedMessage");
      if (unsupportedFields.length > 0) {
        throw new FediError(
          `This server has no profile field for ${unsupportedFields.join(", ")}.`,
          "errors.unsupported.profileField",
          { fields: unsupportedFields },
        );
      }
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.display_name = patch.name ?? "";
      if (patch.bio !== undefined) body.note = patch.bio ?? "";
      if (patch.locked !== undefined) body.locked = patch.locked;
      if (patch.bot !== undefined) body.bot = patch.bot;
      if (patch.fields !== undefined) {
        // Wire cap is 4 entries (the server 422s beyond); edited rows
        // re-verify server-side, never kept.
        body.fields_attributes = (patch.fields ?? []).map((f) => ({
          name: f.name,
          value: f.value,
        }));
      }
      // `lang` ↔ the credential `source.language` (snake_case wire —
      // never `locale`). Null clears where the server allows it.
      const source: Record<string, unknown> = {};
      if (patch.lang !== undefined) source.language = patch.lang;
      // Family extras ride ONLY where the wire supports them
      // (snake_case allow-list — strict servers 400 unknown fields, so
      // verbatim passthrough of arbitrary keys is never sent). Unknown
      // `ext` keys are ignored, never fabricated into the body.
      const ext = patch.ext ?? {};
      for (const key of ["discoverable", "hide_collections", "indexable"] as const) {
        if (ext[key] !== undefined) body[key] = ext[key];
      }
      if (ext.source !== undefined && typeof ext.source === "object" && ext.source !== null) {
        Object.assign(source, ext.source as Record<string, unknown>);
      }
      if (Object.keys(source).length > 0) body.source = source;
      const res = await client.patch<CredentialAccount>(
        "/api/v1/accounts/update_credentials",
        body,
      );
      if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
        throw new FediError("The server did not return the updated profile.", "errors.shape.updatedProfile");
      }
      return adaptCredentialAccount(res.data);
    },

    // --- Mutes and blocks ---------------------------------------------------

    async mutes(opts: PageOpts = {}) {
      return listAccounts("mutes", "", opts);
    },

    async blocks(opts: PageOpts = {}) {
      return listAccounts("blocks", "", opts);
    },

    async mute(id) {
      await setMuted(client, id, true);
    },

    async unmute(id) {
      await setMuted(client, id, false);
    },

    async muteRenotes(id) {
      await setBoostVisibility(client, id, false);
    },

    async unmuteRenotes(id) {
      await setBoostVisibility(client, id, true);
    },

    async block(id) {
      await setBlocked(client, id, true);
    },

    async unblock(id) {
      await setBlocked(client, id, false);
    },

    async muteThread(noteId) {
      await muteStatusThread(client, noteId);
    },

    async reportAccount(id, options = {}) {
      return reportAccount(client, id, options);
    },

    // Server rules for the report chooser (clickstone §1.5). Mastodon and
    // forks with the endpoint answer a list; Akkoma/Pleroma 404 — the
    // honest "no published rule list" state, not an error page.
    async instanceRules() {
      try {
        return await fetchInstanceRules(client);
      } catch (err) {
        if (isAbsentError(err)) {
          throw new ApiError(
            "This server does not publish its rules.",
            404,
            undefined,
            "report-rules",
          );
        }
        throw err;
      }
    },

    // Personal domain blocks (clickstone §1.4) — `/api/v1/domain_blocks`,
    // never the admin endpoint. Every flavor here serves the personal trio;
    // a fork that 404s surfaces as the honest unavailable state at the UI
    // (the row is never hidden).
    domainBlocks: {
      async list(opts: PageOpts = {}) {
        const cont = continuationOf(opts.cursor);
        const page = await fetchDomainBlocksPage(
          client,
          cont ? { continuation: cont } : { limit: opts.limit ?? 100 },
        );
        return {
          items: page.domains,
          cursor: encodeContinuation(page.continuation),
          end: page.end,
        };
      },
      async block(domain: string) {
        // The caller feeds the raw input through core
        // `normalizeDomainBlock`; the server stores what it is sent.
        await blockDomain(client, domain);
      },
      async unblock(domain: string) {
        await unblockDomain(client, domain);
      },
    },

    // --- Search -------------------------------------------------------------

    search: {
      /** Full-text post search, paged by the v2 Link header. `type` is
       * always sent: upstream pins combined (type-less) search to
       * offset 0, so only a typed search can page. */
      async posts(query: string, opts: SearchPostsOpts = {}) {
        const result = await searchV2(client, query, {
          type: "statuses",
          ...pageOpts(opts),
        });
        return toSearchPage(result, result.statuses);
      },
      async tags(tag: string, opts: PageOpts = {}) {
        return toPage(await fetchTagTimelinePage(client, tag, pageOpts(opts)));
      },
      /** Account search, same Link paging (v2 search pages accounts by
       * `offset`; a prev Link is available as `searchV2(...).prev`). */
      async accounts(query: string, opts: PageOpts = {}) {
        const result = await searchV2(client, query, {
          type: "accounts",
          ...pageOpts(opts),
        });
        return toSearchPage(result, result.accounts);
      },
      /** `#` autocomplete: tag-name candidates via typed v2 search. */
      async suggestTags(query: string, opts: PageOpts = {}) {
        const result = await searchV2(client, query, {
          type: "hashtags",
          limit: opts.limit ?? 8,
        });
        return result.hashtags.map((t) => t.name);
      },
      /** `@` autocomplete: account candidates via typed v2 search. */
      async suggestAccounts(query: string, opts: PageOpts = {}) {
        const result = await searchV2(client, query, {
          type: "accounts",
          limit: opts.limit ?? 8,
        });
        return { items: result.accounts, cursor: null, end: true };
      },
    },

    explore: {
      /** Follow suggestions (auth-required): 401 signed out (the page
       * answers with a sign-in prompt), 404 on flavors without the
       * endpoint (honest unavailable). */
      async users(opts: PageOpts = {}): Promise<ExploreUsers> {
        return {
          pinned: [],
          suggested: await fetchSuggestions(client, opts.limit ?? 10),
        };
      },
      /** Trending tags (public — the session client when signed in). */
      async tags(opts: PageOpts = {}): Promise<TrendingTag[]> {
        const rows = await fetchTrendingTags(client, opts.limit ?? 10);
        return rows.map((r) => ({
          name: r.name,
          users: r.accounts > 0 ? r.accounts : null,
          uses: r.uses > 0 ? r.uses : null,
        }));
      },
      /** Trending statuses (public), offset-paged. */
      async posts(opts: PageOpts = {}): Promise<Page<Post>> {
        let offset = 0;
        if (typeof opts.cursor === "string" && /^\d+$/.test(opts.cursor)) {
          offset = Number(opts.cursor);
        }
        const limit = opts.limit ?? DEFAULT_LIMIT;
        const page = await fetchTrendingStatuses(client, limit, offset);
        const next = offset + page.items.length;
        return {
          items: page.items,
          cursor: page.end ? null : String(next),
          end: page.end,
        };
      },
      // Trending links are vanilla-Mastodon-only. Akkoma answers `[]`,
      // Pleroma 404s — the member is absent on every other flavor so the
      // UI hides the News tab (an unknown flavor never unlocks it).
      ...(flavor === "mastodon"
        ? {
            async news(opts: PageOpts = {}): Promise<Page<NewsLink>> {
              let offset = 0;
              if (typeof opts.cursor === "string" && /^\d+$/.test(opts.cursor)) {
                offset = Number(opts.cursor);
              }
              const limit = opts.limit ?? 10;
              const page = await fetchTrendingLinks(client, limit, offset);
              const next = offset + page.items.length;
              return {
                items: page.items.map((l) => ({
                  url: l.url,
                  title: l.title,
                  description: l.description.length > 0 ? l.description : null,
                  providerName: l.providerName,
                  image: l.image,
                })),
                cursor: page.end ? null : String(next),
                end: page.end,
              };
            },
          }
        : {}),
    },

    // Hashtag curation (clickstone §1.4). Follow/unfollow exist on both
    // flavors; the feature/featured surface is vanilla Mastodon's (Akkoma
    // has no `/api/v1/featured_tags` and no tag `feature` action), so those
    // members stay undefined there and the UI renders a disabled row with
    // the reason instead of hiding it. A tag MUTE endpoint exists on
    // neither server — it is deliberately absent here, never faked.
    tags: {
      show(name: string) {
        return getTag(client, name);
      },
      async follow(name: string) {
        await followTag(client, name);
      },
      async unfollow(name: string) {
        await unfollowTag(client, name);
      },
      async followed(opts: PageOpts = {}) {
        const cont = continuationOf(opts.cursor);
        const page = await fetchFollowedTagsPage(
          client,
          cont ? { continuation: cont } : { limit: opts.limit ?? 80 },
        );
        return {
          items: page.items,
          cursor: encodeContinuation(page.continuation),
          end: page.end,
        };
      },
      ...(flavor === "akkoma" || flavor === "pleroma"
        ? {}
        : {
            featured() {
              return fetchFeaturedTags(client);
            },
            async feature(name: string) {
              await featureTag(client, name);
            },
            async unfeature(name: string) {
              await unfeatureTag(client, name);
            },
            async deleteFeatured(id: string) {
              await deleteFeaturedTag(client, id);
            },
          }),
    },

    async notifications(opts: NotificationsOpts = {}) {
      const cont = continuationOf(opts.cursor);
      const types = wireNotificationTypes(opts.includeTypes);
      const excludeTypes = wireNotificationTypes(opts.excludeTypes);
      // Prefer the grouped v2 endpoint; fall back to flat v1 when the
      // server has none (404/405 — Akkoma/Pleroma) or answers an envelope
      // the adapter cannot read (null). ONLY absence falls back: auth,
      // timeout and 5xx errors rethrow — they are never masked as "no
      // grouped notifications". A cursor already pinned to a v1 next-URL
      // stays on v1 (its paging belongs there).
      const pinnedV1 =
        cont?.kind === "url" && !cont.url.includes("/api/v2/notifications");
      if (!pinnedV1) {
        try {
          const v2 = await fetchV2NotificationRows(client, {
            ...(cont ? { continuation: cont } : { limit: opts.limit ?? DEFAULT_LIMIT }),
            types,
            excludeTypes,
          });
          if (v2 !== null) {
            // The v2 Link header drives REAL paging (contract §5): the
            // cursor advances via fetchMore instead of stalling at null.
            // Grouped rows adapt with their sampled actors, server count,
            // and resolved post (see `adaptV2Notification`).
            return {
              items: v2.rows.map((n) => adaptV2Notification(n, v2.accounts, v2.statuses)),
              cursor: encodeContinuation(v2.continuation),
              end: v2.end,
            };
          }
        } catch (err) {
          if (!isAbsentError(err)) throw err;
        }
      }
      const page = await fetchNotificationsPage(client, {
        ...(cont ? { continuation: cont } : { limit: opts.limit ?? DEFAULT_LIMIT }),
        types,
        excludeTypes,
      });
      return {
        items: page.items.map(adaptNotification),
        cursor: encodeContinuation(page.continuation),
        end: page.end,
      };
    },

    async markNotificationsRead() {
      // No v1 mark-as-read endpoint exists (contract §4): the notifications
      // marker is the read position, anchored at the newest row.
      const page = await fetchNotificationsPage(client, { limit: 1 });
      const newest = page.items[0];
      if (!newest) return;
      await markNotificationsRead(client, newest.id);
    },

    // --- Server services -----------------------------------------------------

    async customEmojis(): Promise<CustomEmoji[]> {
      const items = await fetchCustomEmojis(client);
      return items.map((e) => ({
        name: e.shortcode,
        url: e.url,
        category: e.category ?? null,
      }));
    },

    async uploadMedia(file: File, opts: { isSensitive?: boolean; comment?: string } = {}) {
      // Contract §4: multipart to v2/media; Mastodon answers 202 while
      // processing and the URL is null until done — poll the media read
      // and return whatever the server has (the media row renders the
      // honest "still processing" state on a null URL).
      const form = new FormData();
      form.append("file", file);
      if (opts.comment) form.append("description", opts.comment);
      const res = await client.postFormData<MediaAttachment>("/api/v2/media", form);
      let media = res.data;
      if (media && media.url == null && media.id) {
        for (let attempt = 0; attempt < 20 && media.url == null; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          try {
            media = await getMedia(client, media.id);
          } catch {
            break; // 422 processing failure: return what we have
          }
        }
      }
      if (!media || typeof media !== "object" || !("id" in media)) {
        throw new FediError("The server did not return the uploaded media.", "errors.shape.uploadedMedia");
      }
      return adaptMedia(media, opts.isSensitive === true);
    },

    filters: {
      async list() {
        // v2 groups first (Mastodon), v1 keywords on 404/405
        // (Akkoma/Pleroma) — same single-phrase rows either way.
        return withFilterFallback(
          async () => {
            const res = await client.get<Array<Record<string, unknown>>>("/api/v2/filters");
            const items = Array.isArray(res.data) ? res.data : [];
            return items.map(adaptV2FilterRow);
          },
          async () => {
            const res = await client.get<Array<Record<string, unknown>>>("/api/v1/filters");
            const items = Array.isArray(res.data) ? res.data : [];
            return items.map((f) => adaptV1FilterRow(f, ""));
          },
        );
      },
      async create(phrase, context, opts = {}) {
        const wholeWord = opts.wholeWord === true;
        const irreversible = opts.irreversible === true;
        const expires_in = filterExpiresIn(opts.expiresAt ?? undefined);
        return withFilterFallback(
          async () => {
            // v2 creates a GROUP: `title` names it, `keywords_attributes`
            // carries the matched text (one keyword — what the core row
            // edits), `filter_action` carries the hide/warn behaviour.
            const body: Record<string, unknown> = {
              title: phrase,
              context,
              filter_action: irreversible ? "hide" : "warn",
              keywords_attributes: [{ keyword: phrase, whole_word: wholeWord }],
              ...(expires_in !== undefined ? { expires_in } : {}),
            };
            const res = await client.post<Record<string, unknown>>("/api/v2/filters", body);
            return adaptV2FilterRow(res.data ?? {});
          },
          async () => {
            // v1 creates the keyword directly (no `filter_action` there).
            const body: Record<string, unknown> = { phrase, context };
            if (expires_in !== undefined) body.expires_in = expires_in;
            if (opts.irreversible !== undefined) body.irreversible = opts.irreversible;
            if (opts.wholeWord !== undefined) body.whole_word = opts.wholeWord;
            const res = await client.post<Record<string, unknown>>("/api/v1/filters", body);
            return adaptV1FilterRow(res.data ?? {}, phrase);
          },
        );
      },
      async update(id, phrase, context, opts = {}) {
        const wholeWord = opts.wholeWord === true;
        const pathV2 = `/api/v2/filters/${encodeURIComponent(id)}`;
        return withFilterFallback(
          async () => {
            // v2 edits a GROUP: read it first so the phrase edit rewrites
            // the group's keywords in place (first keyword takes the new
            // phrase, EVERY sibling is written back with its own text and
            // whole_word) instead of appending a duplicate keyword on
            // every edit or sending bare `{id}` rows that blank the rest.
            const seen = await client.get<Record<string, unknown>>(pathV2);
            const raw = (seen.data ?? {}) as Record<string, unknown>;
            const priorRows = Array.isArray(raw.keywords)
              ? (raw.keywords as unknown[]).filter(
                  (k): k is Record<string, unknown> => !!k && typeof k === "object",
                )
              : [];
            const prior = priorRows.map((k) => adaptFilterKeyword(k, id));
            const keywords_attributes =
              prior.length > 0
                ? prior.map((k, i) =>
                    i === 0
                      ? { id: k.id, keyword: phrase, whole_word: wholeWord }
                      : { id: k.id, keyword: k.keyword, whole_word: k.wholeWord },
                  )
                : [{ keyword: phrase, whole_word: wholeWord }];
            // The title is the group's label, not the phrase: keep a custom
            // one, only follow the phrase when it was auto-derived from the
            // old primary keyword (or absent).
            const priorTitle = typeof raw.title === "string" ? raw.title.trim() : "";
            const title =
              priorTitle.length > 0 && priorTitle !== prior[0]?.keyword ? priorTitle : phrase;
            const body: Record<string, unknown> = {
              title,
              context,
              keywords_attributes,
            };
            if (opts.irreversible !== undefined) {
              body.filter_action = opts.irreversible ? "hide" : "warn";
            }
            const expires_in = filterExpiresIn(opts.expiresAt ?? undefined);
            if (expires_in !== undefined) body.expires_in = expires_in;
            const res = await client.put<Record<string, unknown>>(pathV2, body);
            return adaptV2FilterRow(res.data ?? {});
          },
          async () => {
            const body: Record<string, unknown> = { phrase, context };
            if (opts.expiresAt !== undefined) {
              const expires_in = filterExpiresIn(opts.expiresAt ?? undefined);
              if (expires_in !== undefined) body.expires_in = expires_in;
            }
            if (opts.irreversible !== undefined) body.irreversible = opts.irreversible;
            if (opts.wholeWord !== undefined) body.whole_word = opts.wholeWord;
            const res = await client.put<Record<string, unknown>>(
              `/api/v1/filters/${encodeURIComponent(id)}`,
              body,
            );
            return adaptV1FilterRow(res.data ?? {}, phrase);
          },
        );
      },
      async delete(id) {
        const pathV2 = `/api/v2/filters/${encodeURIComponent(id)}`;
        const pathV1 = `/api/v1/filters/${encodeURIComponent(id)}`;
        return withFilterFallback(
          async () => {
            await client.delete(pathV2);
          },
          async () => {
            await client.delete(pathV1);
          },
        );
      },
    },

    async translate(id: string, targetLang: string): Promise<Translation> {
      const res = await translateStatus(client, id, targetLang);
      const text = res.text ? htmlToPlainText(res.text) : "";
      if (text.length === 0) {
        throw new FediError("The server returned no translation for this post.", "errors.shape.noTranslation");
      }
      return { sourceLang: res.sourceLang, text };
    },

    lists: {
      membership: {
        containing: (accountId) => listsContainingMasto(client, accountId),
        add: (listId, accountId) => addToListMasto(client, listId, accountId),
        remove: (listId, accountId) => removeFromListMasto(client, listId, accountId),
      },
      async list() {
        const res = await client.get<ListRow[]>("/api/v1/lists");
        const items = Array.isArray(res.data) ? res.data : [];
        return items.map((l) => adaptListRow(l));
      },
      async timeline(listId, opts = {}) {
        const cont = continuationOf(opts.cursor);
        const path = cont?.kind === "url" ? cont.url : `/api/v1/timelines/list/${encodeURIComponent(listId)}`;
        const query: Record<string, number> = cont ? {} : { limit: opts.limit ?? DEFAULT_LIMIT };
        const res = await client.get<Array<unknown>>(path, query);
        const items = Array.isArray(res.data) ? res.data : [];
        const posts = items.map((raw) => adaptStatus(raw as any));
        const continuation = nextContinuation(res.headers, client.origin);
        return {
          items: posts,
          cursor: encodeContinuation(continuation),
          end: continuation === null || posts.length === 0,
        };
      },
      // Lists exist on every flavor here (Mastodon + Akkoma/Pleroma all
      // serve `/api/v1/lists` CRUD) — no v1/v2 split, so no fallback:
      // absence propagates as the honest unsupported state. The optional
      // fields ride only when chosen AND supported (see `listFieldsBody`).
      async create(name, fields = {}) {
        const res = await client.post<ListRow>("/api/v1/lists", {
          title: name,
          ...listFieldsBody(fields, capabilities),
        });
        if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
          throw new FediError("The server did not return the created list.", "errors.shape.createdList");
        }
        return adaptListRow(res.data, name);
      },
      async update(id, patch) {
        const res = await client.put<ListRow>(
          `/api/v1/lists/${encodeURIComponent(id)}`,
          { title: patch.name, ...listFieldsBody(patch, capabilities) },
        );
        if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
          throw new FediError("The server did not return the updated list.", "errors.shape.updatedList");
        }
        return adaptListRow(res.data, patch.name);
      },
      async delete(id) {
        await client.delete(`/api/v1/lists/${encodeURIComponent(id)}`);
      },
    },

    bookmarks: {
      async list(opts = {}) {
        const cont = continuationOf(opts.cursor);
        const path = cont?.kind === "url" ? cont.url : "/api/v1/bookmarks";
        // Same Link-continuation plumbing as every other listing: a
        // same-origin next URL is followed verbatim (its params already
        // baked in), carried-over cursors rebuild on the session origin —
        // never a length heuristic.
        const query: Record<string, QueryValue> =
          cont?.kind === "url"
            ? {}
            : cont?.kind === "cursors"
              ? withCursors({}, cont.cursors)
              : { limit: opts.limit ?? DEFAULT_LIMIT };
        const res = await client.get<Array<unknown>>(path, query);
        const items = Array.isArray(res.data) ? res.data : [];
        const posts = items.map((raw) => adaptStatus(raw as any));
        const continuation = nextContinuation(res.headers, client.origin);
        return {
          items: posts.map((post) => ({ id: post.id, post })),
          cursor: encodeContinuation(continuation),
          end: continuation === null || posts.length === 0,
        };
      },
      async add(noteId) {
        await client.post(`/api/v1/statuses/${encodeURIComponent(noteId)}/bookmark`, {});
      },
      async remove(noteId) {
        await client.post(`/api/v1/statuses/${encodeURIComponent(noteId)}/unbookmark`, {});
      },
    },

    scheduled: {
      async list(opts = {}) {
        // Link-paged like every other listing; rows adapt their wire
        // `params`/`media_attachments` into the draft preview below.
        const page = await fetchScheduledStatusesPage(client, pageOpts(opts));
        return page.items.map(adaptScheduledRow);
      },
      async create(draft) {
        const body = statusBodyOf(draft);
        if (draft.scheduledAt) (body as unknown as Record<string, unknown>).scheduled_at = draft.scheduledAt;
        const res = await client.post<{ id: string; scheduled_at: string }>(
          "/api/v1/statuses",
          body,
          { idempotencyKey: newIdempotencyKey() },
        );
        const data = res.data;
        if (!data || typeof data !== "object" || !("id" in data)) {
          throw new FediError("The server did not return the scheduled status.", "errors.shape.noScheduled");
        }
        return {
          id: data.id,
          scheduledAt: (data as { scheduled_at?: string }).scheduled_at ?? draft.scheduledAt ?? "",
          post: null,
          draft: null,
        };
      },
      async delete(id) {
        await client.delete(`/api/v1/scheduled_statuses/${encodeURIComponent(id)}`);
      },
    },

    stream(): StreamHandle | null {
      // Single pooled handle per backend (MD10): one socket per
      // (stream, params) key, shared across timeline + notification +
      // post subscriptions — subscribing never closes another feed's
      // socket. The socket dials the ADVERTISED streaming origin, never
      // an assumed REST-host mapping.
      return createStreamHandle(client.origin, {
        token: client.token,
        streamingOrigin: streamOrigin,
      });
    },
  };
}

// --- helpers bound to the transport ----------------------------------------

/**
 * Wire scheduled row → core `ScheduledNote` (MD9 — still the
 * `{post, draft}` shape, no interface change). `params` fills the draft
 * preview (text/cw/visibility/media ids/poll, verbatim wire keys);
 * `media_attachments` appends adapted media descriptors so a preview can
 * render without re-uploading. `post` stays null: the row carries no
 * author, and a Post with a fabricated author would be fake data.
 */
function adaptScheduledRow(row: WireScheduledStatus): ScheduledNote {
  const params = row.params ?? null;
  let draft: Record<string, unknown> | null = null;
  if (params !== null && typeof params === "object") {
    draft = { ...params };
    if (params.text !== undefined) draft.text = params.text;
    if (params.spoiler_text !== undefined) draft.cw = params.spoiler_text;
    if (params.visibility !== undefined) draft.visibility = params.visibility;
    if (params.media_ids !== undefined) draft.mediaIds = params.media_ids;
    if (params.poll !== undefined) draft.poll = params.poll;
    const media = Array.isArray(row.media_attachments) ? row.media_attachments : [];
    if (media.length > 0) {
      draft.media = media.map((m) => ({
        id: m.id,
        kind: m.type,
        url: m.url ?? m.preview_url ?? null,
        previewUrl: m.preview_url ?? m.url ?? null,
        description: m.description ?? null,
      }));
    }
  }
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    post: null,
    draft,
  };
}

async function verifySelf(client: MastoClient): Promise<CredentialAccount> {
  const res = await client.get<CredentialAccount>(
    "/api/v1/accounts/verify_credentials",
  );
  const account = res.data;
  if (!account || typeof account !== "object" || typeof account.id !== "string") {
    throw new FediError("verify_credentials did not return an account.", "errors.auth.noVerifyAccount");
  }
  return account;
}

/**
 * The "mute boosts" control: the boost setting rides the follow call
 * (contract §4 `reblogs` param) — which would FOLLOW an account you do
 * not follow, so that case is refused instead of silently following.
 */
async function setBoostVisibility(
  client: MastoClient,
  id: string,
  showing: boolean,
): Promise<void> {
  const rels = await getRelationships(client, [id]);
  const rel: Relationship | undefined = rels[0];
  if (!rel || rel.isFollowing !== true) {
    throw new ApiError(
      "You can only change boost visibility for accounts you follow.",
      400,
      "errors.unsupported.boostVisibility",
    );
  }
  await setShowingReblogs(client, id, showing);
}

// Textual-`RE:` resolution cache (per origin+token, with the miss TTL the
// quote-posts rules require: a transient 429/403 is never cached forever).
const QUOTE_MISS_TTL_MS = 90_000;
const quoteLookups = new Map<string, { promise: Promise<Post | null>; missedAt: number | null }>();

async function resolveQuote(client: MastoClient, uri: string): Promise<Post | null> {
  const key = `${client.origin}\n${client.token ?? ""}\n${uri}`;
  const cached = quoteLookups.get(key);
  if (cached && (cached.missedAt === null || Date.now() - cached.missedAt < QUOTE_MISS_TTL_MS)) {
    return cached.promise;
  }
  const entry: { promise: Promise<Post | null>; missedAt: number | null } = {
    promise: Promise.resolve(null),
    missedAt: null,
  };
  entry.promise = (async () => {
    try {
      const res = await client.get<{ statuses?: WireStatus[] }>("/api/v2/search", {
        q: uri,
        resolve: true,
        type: "statuses",
        limit: 1,
      });
      const statuses = Array.isArray(res.data?.statuses)
        ? res.data.statuses.map(adaptStatus)
        : [];
      const found = pickQuoteTarget(statuses, uri);
      if (found === null) entry.missedAt = Date.now();
      return found;
    } catch {
      entry.missedAt = Date.now();
      return null;
    }
  })();
  quoteLookups.set(key, entry);
  return entry.promise;
}

/** The search hit that IS the quoted URI (strict match — a hit for
 * anything else is never rendered as the quote target). Re-exported
 * logic from `quoteMarker.pickQuotedStatus`; inlined here so the backend
 * owns its fetch decisions. */
function pickQuoteTarget(statuses: readonly Post[], uri: string): Post | null {
  for (const s of statuses) {
    if ((s.uri !== null && s.uri === uri) || (s.url !== null && s.url === uri)) return s;
    try {
      const want = new URL(uri).href;
      if (s.uri !== null && new URL(s.uri).href === want) return s;
      if (s.url !== null && new URL(s.url).href === want) return s;
    } catch {
      // Unparsable URIs only match verbatim (above).
    }
  }
  return null;
}
