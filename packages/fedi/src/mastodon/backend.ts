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
  FollowRequest,
  NewsLink,
  NotificationsOpts,
  PageOpts,
  PostDraft,
  ProfileUpdate,
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
  adaptAccount,
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
import type { ContinuationPage, TimelinePageOptions } from "./endpoints";
import {
  answerFollowRequest,
  deleteStatus,
  editStatus,
  fetchAccountListPage,
  fetchAccountStatusesPage,
  fetchCustomEmojis,
  fetchFollowRequestsPage,
  fetchNotificationsPage,
  fetchStatusAccountPage,
  fetchSuggestions,
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
import { MastoHttpError, createClient } from "./client";
import type { MastoClient } from "./client";
import { listsContaining as listsContainingMasto, addToList as addToListMasto, removeFromList as removeFromListMasto } from "./listMembership";
import type { Continuation } from "./pagination";
import { nextContinuation } from "./pagination";
import type {
  Account as WireAccount,
  CredentialAccount,
  MediaAttachment,
  Status as WireStatus,
} from "./wire";

// --- Error adaptation (the one boundary) -----------------------------------

/**
 * Transport errors become the UI's shared `ApiError` AT the boundary, so
 * every honest-state rule the Misskey family relies on (`isUnsupportedError`
 * = 404/405, `isPermissionError` = 401/403) reads the same here. A
 * timeout keeps `kind: "timeout"` — it is never "endpoint unsupported".
 */
export function toApiError(err: unknown): unknown {
  if (err instanceof MastoHttpError) {
    const code =
      err.body !== null && typeof err.body === "object"
        ? ((err.body as { error?: unknown }).error as string | undefined)
        : undefined;
    return new ApiError(err.message, err.status, code, err.kind);
  }
  return err;
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

// --- The backend ------------------------------------------------------------

export interface MastodonBackendOptions {
  /** Detected flavor (from the session / login detection). */
  flavor?: ServerFlavor;
  /** Detection evidence (feature flags from instance metadata). */
  evidence?: DetectionEvidence;
}

const DEFAULT_LIMIT = 20;
const FOLLOW_REQUESTS_LIMIT = 40;

export function createMastodonBackend(
  rawClient: MastoClient = createClient("https://example.invalid", null),
  opts: MastodonBackendOptions = {},
): Backend {
  const client = guarded(rawClient);
  const flavor: ServerFlavor = opts.flavor ?? "unknown";
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
      // Handle lookup (contract §4 `accounts/lookup`).
      const res = await client.get<WireAccount>("/api/v1/accounts/lookup", { acct });
      if (!res.data || typeof res.data !== "object" || !("id" in res.data)) {
        throw new ApiError(
          `No account found for ${acct}.`,
          404,
          "errors.unsupported.noAccountFound",
          undefined,
          { acct },
        );
      }
      return adaptAccount(res.data);
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

    async followRequests(): Promise<FollowRequest[]> {
      // The wire list is accounts; the core row pairs follower+followee
      // (the followee is the viewer on incoming requests).
      const self = await me();
      const page = await fetchFollowRequestsPage(client, {
        limit: FOLLOW_REQUESTS_LIMIT,
      });
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
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.display_name = patch.name ?? "";
      if (patch.bio !== undefined) body.note = patch.bio ?? "";
      if (patch.locked !== undefined) body.locked = patch.locked;
      if (patch.bot !== undefined) body.bot = patch.bot;
      if (patch.fields !== undefined) {
        body.fields_attributes = (patch.fields ?? []).map((f) => ({
          name: f.name,
          value: f.value,
        }));
      }
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

    async reportAccount(id, comment) {
      await reportAccount(client, id, comment);
    },

    // --- Search -------------------------------------------------------------

    search: {
      async posts(query: string, opts: SearchPostsOpts = {}) {
        void opts;
        const result = await searchV2(client, query);
        return { items: result.statuses, cursor: null, end: true };
      },
      async tags(tag: string, opts: PageOpts = {}) {
        return toPage(await fetchTagTimelinePage(client, tag, pageOpts(opts)));
      },
      async accounts(query: string, opts: PageOpts = {}) {
        void opts;
        const result = await searchV2(client, query);
        return { items: result.accounts, cursor: null, end: true };
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

    // --- Notifications ------------------------------------------------------

    async notifications(opts: NotificationsOpts = {}) {
      const cont = continuationOf(opts.cursor);
      // Prefer the v2 endpoint when the server offers grouped notifications;
      // fall back to v1 otherwise. A 404/405 means "no v2" — not an error.
      if (!cont) {
        try {
          const res = await client.get<{ accounts?: Array<Record<string, unknown>>; notifications?: Array<Record<string, unknown>> }>(
            "/api/v2/notifications",
            { limit: opts.limit ?? DEFAULT_LIMIT },
          );
          const accounts = Array.isArray(res.data?.accounts) ? res.data.accounts : [];
          const acctMap = new Map(accounts.map((a) => [String(a.id), a]));
          const rows = Array.isArray(res.data?.notifications) ? res.data.notifications : null;
          // Only treat as a v2 answer when the server actually sent the
          // v2 envelope (accounts + notifications arrays). Otherwise fall
          // through to v1 so a v1-shaped (or empty) stub keeps working.
          if (rows !== null) {
            const items = rows.map((n) => adaptV2Notification(n, acctMap));
            return { items, cursor: null, end: rows.length === 0 };
          }
        } catch (err) {
          // fall through to v1
        }
      }
      const page = await fetchNotificationsPage(client, {
        ...(cont ? { continuation: cont } : { limit: opts.limit ?? DEFAULT_LIMIT }),
        types: wireNotificationTypes(opts.includeTypes),
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
        const res = await client.get<Array<Record<string, unknown>>>("/api/v2/filters");
        const items = Array.isArray(res.data) ? res.data : [];
        return items.map((f) => ({
          id: String(f.id ?? ""),
          phrase: String(f.phrase ?? ""),
          context: Array.isArray(f.context) ? f.context.map(String) : [],
          expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
          irreversible: f.irreversible === true,
          wholeWord: f.whole_word === true,
        }));
      },
      async create(phrase, context, opts = {}) {
        const body: Record<string, unknown> = { phrase, context };
        if (opts.expiresAt) body.expires_at = opts.expiresAt;
        if (opts.irreversible !== undefined) body.irreversible = opts.irreversible;
        if (opts.wholeWord !== undefined) body.whole_word = opts.wholeWord;
        const res = await client.post<Record<string, unknown>>("/api/v2/filters", body);
        const f = res.data ?? {};
        return {
          id: String(f.id ?? ""),
          phrase: String(f.phrase ?? phrase),
          context: Array.isArray(f.context) ? f.context.map(String) : context,
          expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
          irreversible: f.irreversible === true,
          wholeWord: f.whole_word === true,
        };
      },
      async update(id, phrase, context, opts = {}) {
        const body: Record<string, unknown> = { phrase, context };
        if (opts.expiresAt !== undefined) body.expires_at = opts.expiresAt;
        if (opts.irreversible !== undefined) body.irreversible = opts.irreversible;
        if (opts.wholeWord !== undefined) body.whole_word = opts.wholeWord;
        const res = await client.put<Record<string, unknown>>(`/api/v2/filters/${encodeURIComponent(id)}`, body);
        const f = res.data ?? {};
        return {
          id: String(f.id ?? id),
          phrase: String(f.phrase ?? phrase),
          context: Array.isArray(f.context) ? f.context.map(String) : context,
          expiresAt: typeof f.expires_at === "string" ? f.expires_at : null,
          irreversible: f.irreversible === true,
          wholeWord: f.whole_word === true,
        };
      },
      async delete(id) {
        await client.delete(`/api/v2/filters/${encodeURIComponent(id)}`);
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
        const res = await client.get<Array<{ id: string; title: string }>>("/api/v1/lists");
        const items = Array.isArray(res.data) ? res.data : [];
        return items.map((l) => ({ id: l.id, name: l.title }));
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
    },

    bookmarks: {
      async list(opts = {}) {
        const cont = continuationOf(opts.cursor);
        const pageOpts = cont ? { continuation: cont } : { limit: opts.limit ?? DEFAULT_LIMIT };
        const query: Record<string, number> = cont ? {} : { limit: opts.limit ?? DEFAULT_LIMIT };
        const path = cont?.kind === "url" ? cont.url : "/api/v1/bookmarks";
        const res = await client.get<Array<unknown>>(path, query);
        const items = Array.isArray(res.data) ? res.data : [];
        // Link header pagination via statusPage-style: read next link.
        const posts = items.map((raw) => adaptStatus(raw as any));
        return {
          items: posts.map((post) => ({ id: post.id, post })),
          cursor: null,
          end: posts.length === 0,
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
        const res = await client.get<Array<{ id: string; scheduled_at: string }>>(
          "/api/v1/scheduled_statuses",
          { limit: opts.limit ?? 20 },
        );
        const items = Array.isArray(res.data) ? res.data : [];
        return items.map((s) => ({
          id: s.id,
          scheduledAt: s.scheduled_at,
          post: null,
          draft: null,
        }));
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
      return createStreamHandle(client.origin, { token: client.token });
    },
  };
}

// --- helpers bound to the transport ----------------------------------------

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
