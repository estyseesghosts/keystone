// MisskeyBackend — the Misskey family's implementation of
// `core/backend.Backend` (plan §2.2 / §3 Phase 2 item 4).
//
// It is the ONLY consumer of the wire surface: every method makes exactly
// the requests today's UI makes (same endpoints, same params — the
// cross-backend param rules of AGENTS.md §5 bind: `{limit, sinceId,
// untilId}` plus ids/text, never Misskey-only `include*Renotes`), then
// adapts the wire response to `core/models` via `adapt.ts`.
//
// Phase 2 shape: one backend per session — the transport is built from
// that session (a `MisskeyClient`), so a token can only ever reach its own
// origin. The transport is injectable for tests.
//
// Behaviour preservation notes:
// - 204/empty responses resolve as `undefined` (never `response.json()`).
// - unknown POST paths answer 404 non-JSON with the HTTP status kept on
//   `ApiError` (callers probe support with `isUnsupportedError`).
// - `notes/create` bodies are built exactly as the Composer built them
//   (field-inclusion rules included); `home` is written as `home` because
//   `PostDraft.visibility.raw` round-trips (plan §2.1).

import type {
  Account,
  Media,
  Notification,
  Page,
  Poll,
  Post,
  Relationship,
} from "../core/models";
import type {
  AccountPostsOpts,
  AdminInsightApi,
  AnnouncementsApi,
  AntennasApi,
  Backend,
  BookmarksApi,
  ChannelsApi,
  ChatApi,
  ClipsApi,
  CustomEmoji,
  DriveApi,
  FollowRequest,
  ListsApi,
  NoteReactionRow,
  NotificationsOpts,
  PageOpts,
  ProfileImageKind,
  ProfileUpdate,
  RecommendationsApi,
  ReportUnsupportedField,
  ReportsQueueApi,
  ScheduledApi,
  SearchPostsOpts,
  ServerDraftsApi,
  SignalOpts,
  StreamHandle,
  TimelineKind,
  TransferApi,
  Translation,
  UserReaction,
} from "../core/backend";
import type { DetectionEvidence, ServerFlavor } from "../core/detect";
import { buildCapabilities } from "../core/detect";
import { normalizeReportOptions, reportUnsupported } from "../core/backend";
import { ApiError, FediError } from "../core/errors";
import {
  adaptAccount,
  adaptDriveFile,
  adaptFollowRequest,
  adaptGroupedNotification,
  adaptMe,
  adaptNote,
  adaptNotification,
  adaptUserRelation,
  decodeCursor,
  misskeyNotificationTypes,
  pageOf,
} from "./adapt";
import { likeSupportFor, likeViaNotesLike } from "./like";
import { createRecommendationsApi } from "./recommendations";
import type {
  DriveFile,
  GroupedNotificationItem,
  MeDetailed,
  Note,
  NotificationItem,
  UserDetailed,
  UserLite,
  UserRelation,
} from "./wire";
import { isUnsupportedError } from "./client";
import type { CallOptions, UploadOptions } from "./client";
import {
  CONVERSATION_PAGE_SIZE,
  MAX_ANCESTOR_WALK,
  REPLIES_PAGE_SIZE,
  orderAncestors,
} from "./thread";
import { createStreamHandle } from "./stream";
import { createQuoteResolver } from "./quote";
import {
  addNoteToClip,
  adaptClipSummary,
  createClip,
  deleteClip,
  listClips,
  listClipsContaining,
  removeNoteFromClip,
  updateClip,
} from "./clips";
import { createChannelsApi } from "./channels";
import { createChatApi } from "./chat";
import { createAnnouncementsApi } from "./announcements";
import { createAdminInsightApi, createReportsQueueApi } from "./admin";
import { createBookmarksApi } from "./favorites";
import { listFeaturedNotes, listUserFeaturedNotes, pinNote, unpinNote } from "./featured";
import {
  acceptFollowRequest,
  cancelFollowRequest,
  listFollowRequests,
  rejectFollowRequest,
} from "./followRequests";
import { createDriveApi } from "./drive";
import { createAntennasApi } from "./antennas";
import { createEditNoteBody, createNoteBody } from "./noteBody";
import { isValidEmojiEntry } from "./emoji";
import { createScheduledApi } from "./schedule";
import { editNote } from "./noteEdit";
import { createListsApi } from "./listMembership";
import { listRenoteMutes } from "./renoteMutes";
import { pageOfAccountRows, type AccountListWrapperKey } from "./mutes";
import { createServerDraftsApi } from "./serverDrafts";
import { createTransferApi } from "./importExport";

// --- Transport -------------------------------------------------------------
//
// The backend is built for exactly one session: every method below calls
// through the injected transport (a `MisskeyClient` bound to that session,
// or a stub in tests), so a token can only ever reach its own origin.
// There is no global routing facade in this package.

export interface MisskeyTransport {
  call<T>(endpoint: string, params?: Record<string, unknown>, opts?: CallOptions): Promise<T>;
  upload<T>(file: File, opts?: UploadOptions): Promise<T>;
}

export interface MisskeyBackendOptions {
  /** Session origin for the stream socket (`Backend.stream()` returns
   * null without one — feeds keep working via paging + refresh). */
  origin?: string;
  /** Session token for the stream socket (`?i=` query). */
  token?: string | null;
  /** Detection evidence (from the session / login detection). Missing
   * means the flavor table alone — honestly conservative. */
  evidence?: DetectionEvidence;
}

// --- Compose body -----------------------------------------------------------
// Note bodies live in `./noteBody` (D3.1): one builder for create,
// scheduled, drafts (`createNoteBody`) and one for edit
// (`createEditNoteBody`), both omit-null. Scheduled/drafts add
// `scheduledAt` at their call sites below.

const TIMELINE_ENDPOINTS: Record<TimelineKind, string> = {
  home: "notes/timeline",
  local: "notes/local-timeline",
  social: "notes/hybrid-timeline",
  global: "notes/global-timeline",
};

const DEFAULT_LIMIT = 20;

// --- The backend -----------------------------------------------------------

export function createMisskeyBackend(
  transport: MisskeyTransport,
  flavor: ServerFlavor = "misskey",
  opts: MisskeyBackendOptions = {},
): Backend {
  const call = transport.call.bind(transport);
  // Per-backend quote fallback cache (R1.2): seen/lookup maps live here,
  // so a `Post` resolved under this session's credentials is never served
  // to another session. Backends are memoized per session in the app.
  const quotes = createQuoteResolver(call);

  // Runtime detection (`core/detect.ts`) is the authority: the flavor
  // table is the floor, `opts.evidence` (the session's stored probe
  // evidence) raises it where the server is authoritative.
  const capabilities = buildCapabilities(flavor, opts.evidence ?? {});
  // `notes/like` support is NEVER seeded from the flavor table: stock
  // Misskey may be backported, so a flavor label cannot prove the endpoint
  // absent (p6.0 0.7). The first heart press probes once per origin via
  // `like.ts`; a real 404 caches absence and only then falls back to a ❤
  // reaction. See `likeViaNotesLike`.

  async function callNotes(
    endpoint: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Page<Post>> {
    const limit = typeof params.limit === "number" ? params.limit : DEFAULT_LIMIT;
    const items = await call<Note[]>(endpoint, params, { signal });
    return pageOf(items ?? [], limit, adaptNote);
  }

  // Drive (`drive/files/*`, `drive/folders/*`) and antennas
  // (`antennas/*`) live in `./drive` / `./antennas` (D3.1) — same calls,
  // same omit-null params, shared paging via `callNotes` above.
  const drive: DriveApi = createDriveApi(call, callNotes);

  const antennas: AntennasApi = createAntennasApi(call, callNotes);

  const clips: ClipsApi = {
    async list() {
      return (await listClips(call)).map(adaptClipSummary);
    },
    async addNote(clipId, noteId) {
      await addNoteToClip(call, clipId, noteId);
    },
    async removeNote(clipId, noteId) {
      await removeNoteFromClip(call, clipId, noteId);
    },
    async create(name, opts = {}) {
      return adaptClipSummary(await createClip(call, name, opts));
    },
    async update(clipId, patch) {
      return adaptClipSummary(await updateClip(call, clipId, patch));
    },
    async delete(clipId) {
      await deleteClip(call, clipId);
    },
    async notes(clipId, opts = {}) {
      return callNotes(
        "clips/notes",
        {
          clipId,
          limit: opts.limit ?? DEFAULT_LIMIT,
          ...decodeCursor(opts.cursor ?? null),
        },
        opts.signal,
      );
    },
    async containing(noteId) {
      return (await listClipsContaining(call, noteId)).map(adaptClipSummary);
    },
  };

  // Domain sub-APIs live in their modules (D3.1) — same calls, same
  // omit-null params. `callNotes` is shared paging for the note listings.
  const channels: ChannelsApi = createChannelsApi(call, callNotes);

  const chat: ChatApi = createChatApi(call);

  const announcements: AnnouncementsApi = createAnnouncementsApi(call);

  const adminInsight: AdminInsightApi = createAdminInsightApi(call);

  const reportsQueue: ReportsQueueApi = createReportsQueueApi(call);

  const lists: ListsApi = createListsApi(call, callNotes);

  const scheduled: ScheduledApi = createScheduledApi(call);

  const serverDrafts: ServerDraftsApi = createServerDraftsApi(call);

  const bookmarks: BookmarksApi = createBookmarksApi(call);

  const transfer: TransferApi = createTransferApi(transport, call);

  const recommendations: RecommendationsApi = createRecommendationsApi(call, opts.origin);

  // Account-list endpoints answer WRAPPER rows, not bare users (M1):
  // `users/followers` -> `follower`, `users/following` -> `followee`,
  // `mute/list` -> `mutee`, `blocking/list` -> `blockee`. Unwrap per
  // endpoint (tolerant bare-user rows pass through for fork-compat), skip
  // rows without a string-id user, and keep the cursor on the ROW id
  // (`untilId` pages on the row, so `pageOf` runs on rows and the map
  // happens after — see `pageOfAccountRows`).
  const ACCOUNT_LIST_WRAPPER_KEY: Record<string, AccountListWrapperKey> = {
    "users/followers": "follower",
    "users/following": "followee",
    "mute/list": "mutee",
    "blocking/list": "blockee",
  };

  async function listAccounts(
    endpoint: string,
    opts: PageOpts,
    extra: Record<string, unknown> = {},
  ): Promise<Page<Account>> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const rows = await call<unknown[]>(
      endpoint,
      {
        ...extra,
        limit,
        ...decodeCursor(opts.cursor ?? null),
      },
      { signal: opts.signal },
    );
    const key = ACCOUNT_LIST_WRAPPER_KEY[endpoint];
    if (!key) return pageOf((rows ?? []) as UserLite[], limit, adaptAccount);
    return pageOfAccountRows(rows, limit, key);
  }

  return {
    family: "misskey",
    capabilities,

    timeline(kind, opts = {}) {
      return callNotes(
        TIMELINE_ENDPOINTS[kind],
        {
          limit: opts.limit ?? DEFAULT_LIMIT,
          ...decodeCursor(opts.cursor ?? null),
        },
        opts.signal,
      );
    },

    async post(id, opts: SignalOpts = {}) {
      return adaptNote(await call<Note>("notes/show", { noteId: id }, { signal: opts.signal }));
    },

    async thread(post, opts: SignalOpts = {}) {
      // Port of routes/Note's ancestor walk (docs/replies.md): offset
      // paging with dedupe, a short-page stop, a repeat-page guard and the
      // MAX_ANCESTOR_WALK bound, then the replyId-chain ordering. On a
      // server without `notes/conversation` (404) it falls back to the
      // one-level parent packed on the post — exactly as today.
      try {
        const seen = new Set<string>();
        const collected: Note[] = [];
        let offset = 0;
        for (;;) {
          const page = await call<Note[]>(
            "notes/conversation",
            {
              noteId: post.id,
              limit: CONVERSATION_PAGE_SIZE,
              offset,
            },
            { signal: opts.signal },
          );
          let grew = false;
          for (const n of page ?? []) {
            if (!seen.has(n.id)) {
              seen.add(n.id);
              collected.push(n);
              grew = true;
            }
          }
          if ((page ?? []).length < CONVERSATION_PAGE_SIZE) break;
          // A server that ignores `offset` repeats the same page: stop
          // instead of looping forever. The walk itself is bounded too.
          if (!grew || collected.length >= MAX_ANCESTOR_WALK) break;
          offset += page.length;
        }
        const ordered = orderAncestors(
          post.replyToId,
          collected.map(adaptNote),
        );
        return {
          ancestors: ordered.ancestors,
          incomplete: ordered.incomplete,
        };
      } catch (err) {
        if (isUnsupportedError(err)) {
          const parent = post.reply;
          return {
            ancestors: parent ? [parent] : [],
            incomplete: !!post.replyToId && (!parent || !!parent.replyToId),
          };
        }
        throw err;
      }
    },

    threadReplies(id, opts = {}) {
      return callNotes(
        "notes/replies",
        {
          noteId: id,
          limit: opts.limit ?? REPLIES_PAGE_SIZE,
          ...decodeCursor(opts.cursor ?? null),
        },
        opts.signal,
      );
    },

    // The detail "Reposts" tab: `notes/renotes` answers the renote
    // notes (usually pure wrappers); the tab shows their authors —
    // one active renote per account, server order. The cursor stays
    // the opaque note cursor; callers dedupe by account id exactly
    // like feeds merge by note id.
    async reposts(id, opts = {}) {
      const page = await callNotes(
        "notes/renotes",
        {
          noteId: id,
          limit: opts.limit ?? DEFAULT_LIMIT,
          ...decodeCursor(opts.cursor ?? null),
        },
        opts.signal,
      );
      const seen = new Set<string>();
      const accounts: Account[] = [];
      for (const n of page.items) {
        // The WRAPPER's author renoted (appearNoteOf would give the
        // original's author for pure renotes — the wrong person here).
        const author = n.author;
        if (seen.has(author.id)) continue;
        seen.add(author.id);
        accounts.push(author);
      }
      return { items: accounts, cursor: page.cursor, end: page.end };
    },

    // The detail "Reactions" tab: `notes/reactions` answers one row
    // per reaction ({id, createdAt, user, type}); `type` narrows to a
    // single emoji (the tab's sub-filter).
    async noteReactions(id, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const params: Record<string, unknown> = {
        noteId: id,
        limit,
        ...decodeCursor(opts.cursor ?? null),
      };
      if (opts.reaction !== undefined) params.type = opts.reaction;
      const rows = await call<
        Array<{ id?: unknown; createdAt?: unknown; user?: unknown; type?: unknown }>
      >("notes/reactions", params, { signal: opts.signal });
      // Deleted/gone reactors arrive without a packed user — skip the row
      // rather than crashing in `adaptAccount` (same `typeof id` guard as
      // `chat.ts`; the row carries no usable account).
      const valid = (rows ?? []).filter((row) => {
        const user = row?.user as { id?: unknown } | null | undefined;
        return !!user && typeof user.id === "string";
      });
      return pageOf(valid, limit, (row): NoteReactionRow => ({
        id: typeof row.id === "string" ? row.id : "",
        createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
        reaction: typeof row.type === "string" ? row.type : "",
        account: adaptAccount(row.user as UserDetailed),
      }));
    },

    async createPost(draft) {
      const res = await call<{ createdNote: Note }>("notes/create", createNoteBody(draft));
      return adaptNote(res.createdNote);
    },

    async deletePost(id) {
      // `notes/delete` removes the note only: Misskey never deletes the
      // Drive files attached to it, so a redraft can reattach them by id.
      // `opts.keepMedia` is therefore a documented no-op here.
      await call<undefined>("notes/delete", { noteId: id });
    },

    async editPost(id, draft) {
      // Edit semantics live in `./noteBody` (`createEditNoteBody`): empty
      // text/cw clear as explicit nulls, quote refusal forwards, poll edits
      // use the create shape. A server-side rejection (notably a 4xx on a
      // poll edit) propagates from `editNote` — never silently dropped.
      return editNote(call, id, createEditNoteBody(draft));
    },

    async react(id, reaction) {
      if (reaction == null) {
        await call<undefined>("notes/reactions/delete", { noteId: id });
        return;
      }
      await call<undefined>("notes/reactions/create", { noteId: id, reaction });
    },

    unreact(id) {
      return call<undefined>("notes/reactions/delete", { noteId: id }).then(() => undefined);
    },

    // Sharkey-family like shortcut (`POST notes/like`, toggle semantics).
    // Support is probed per origin and cached in `misskey/like`; absence
    // throws `LikeUnsupportedError` so the caller can fall back to a plain
    // heart reaction instead of walling the user out.
    like: {
      async like(noteId, override = null) {
        return likeViaNotesLike(call, opts.origin ?? null, noteId, override);
      },
      isSupported() {
        return opts.origin ? likeSupportFor(opts.origin) : null;
      },
    },

    async favourite(id) {
      await call<undefined>("notes/favorites/create", { noteId: id });
    },

    async unfavourite(id) {
      await call<undefined>("notes/favorites/delete", { noteId: id });
    },

    async boost(id) {
      const res = await call<{ createdNote: Note }>("notes/create", { renoteId: id });
      return adaptNote(res.createdNote);
    },

    async unboost(id) {
      await call<undefined>("notes/unrenote", { noteId: id });
    },

    async votePoll(id: string, choices: number[], poll?: Poll | null) {
      // Voting with no loaded poll at all is the typed `noPoll` failure
      // with zero requests (ADR 0010) — never let the server 400 decide.
      // An explicit null means the caller holds a post with no poll;
      // undefined is a legacy caller holding the note id alone. A
      // present poll's null id never blocks: the vote keys on the note
      // id, not a poll id.
      if (poll === null) {
        throw new FediError("This post has no poll to vote in.", "errors.shape.noPoll");
      }
      // One POST per choice: the endpoint takes a single `choice`, so a
      // multi-choice vote is N writes, never one atomic write. Stop at the
      // first failure and report how many choices were already recorded
      // (`errors.poll.partialVote` with `{recorded, total, cause}`) so the
      // UI can say so and retry only the rest — never a blind resend, and
      // never a claim of atomicity. Single-choice stays one POST. Live
      // duplicate behavior (re-sending a recorded choice) is not verified:
      // the UI retries only unrecorded choices. The partial code is handled
      // inline by `PostPoll` and never surfaces as a toast, so it stays out
      // of `localeErrors`.
      const recorded: number[] = [];
      for (const choice of choices) {
        try {
          await call<undefined>("notes/polls/vote", { noteId: id, choice });
        } catch (err) {
          throw new FediError(
            `Recorded ${recorded.length} of ${choices.length} choices before the vote failed.`,
            "errors.poll.partialVote",
            {
              recorded,
              total: choices.length,
              cause: err instanceof Error ? err.message : String(err),
            },
          );
        }
        recorded.push(choice);
      }
    },

    // Textual `RE:` resolution: the `ap/show` lookup (with its
    // per-backend seen/lookup caches in `misskey/quote`) over this
    // backend's transport — family-routed here so the UI never picks a
    // resolver by hand (plan §3 Phase 3 item 4).
    resolveQuoteUri(uri: string): Promise<Post | null> {
      return quotes.resolveQuoteUri(uri);
    },

    // Session-scoped seen re-seeding (R2.4/D3.6): rendered cards reseed
    // this backend's own resolver — never another session's. The
    // Misskey-family seen set is the one `resolveQuoteUri` reads before
    // `ap/show`, so a rendered note later resolves without a fetch.
    seedSeenQuote(note: Post): void {
      quotes.registerSeenNote(note);
    },

    async featuredPosts(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      return pageOf<Note, Post>(await listFeaturedNotes(call, limit, cursor.untilId), limit, adaptNote);
    },

    async accountFeaturedPosts(id, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      return pageOf<Note, Post>(await listUserFeaturedNotes(call, id, limit, cursor.untilId), limit, adaptNote);
    },

    async me(opts: SignalOpts = {}) {
      return adaptMe(await call<MeDetailed>("i", {}, { signal: opts.signal }));
    },

    async account(ref, opts: SignalOpts = {}) {
      const params: Record<string, unknown> = {};
      if (ref.id) params.userId = ref.id;
      if (ref.username) {
        params.username = ref.username;
        if (ref.host) params.host = ref.host;
      }
      // An empty ref would POST `{}` and 400 — refuse locally instead.
      if (params.userId == null && params.username == null) {
        throw new FediError(
          "An account lookup needs an id or a username.",
          "errors.account.refRequired",
        );
      }
      return adaptAccount(await call<UserDetailed>("users/show", params, { signal: opts.signal }));
    },

    accountPosts(id, opts: AccountPostsOpts = {}) {
      const params: Record<string, unknown> = {
        userId: id,
        limit: opts.limit ?? DEFAULT_LIMIT,
      };
      // Explicit pass-through: the `posts` tab sends `false` values the
      // server does not default to — never collapse them away.
      if (opts.withReplies !== undefined) params.withReplies = opts.withReplies;
      if (opts.withRenotes !== undefined) params.withRenotes = opts.withRenotes;
      if (opts.withFiles !== undefined) params.withFiles = opts.withFiles;
      Object.assign(params, decodeCursor(opts.cursor ?? null));
      return callNotes("users/notes", params, opts.signal);
    },

    followers(id, opts = {}) {
      return listAccounts("users/followers", opts, { userId: id });
    },

    following(id, opts = {}) {
      return listAccounts("users/following", opts, { userId: id });
    },

    async accountReactions(id, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const rows = await call<
        Array<{ id: string; createdAt: string; reaction: string; note?: Note | null }>
      >(
        "users/reactions",
        {
          userId: id,
          limit,
          ...decodeCursor(opts.cursor ?? null),
        },
        { signal: opts.signal },
      );
      return pageOf(rows ?? [], limit, (row): UserReaction => ({
        id: row.id,
        createdAt: row.createdAt,
        reaction: row.reaction,
        // The server hides some reacted posts: null, never faked.
        post: row.note ? adaptNote(row.note) : null,
      }));
    },

    async relationships(ids, opts: SignalOpts = {}) {
      const rels = await call<UserRelation[]>(
        "users/relation",
        { userId: ids },
        { signal: opts.signal },
      );
      return (rels ?? []).map(adaptUserRelation);
    },

    async follow(id) {
      await call<undefined>("following/create", { userId: id });
    },

    async unfollow(id) {
      await call<undefined>("following/delete", { userId: id });
    },

    async pinPost(id) {
      await pinNote(call, id);
    },

    async unpinPost(id) {
      await unpinNote(call, id);
    },

    async followRequests() {
      return (await listFollowRequests(call)).map(adaptFollowRequest);
    },

    async acceptFollowRequest(id) {
      await acceptFollowRequest(call, id);
    },

    async rejectFollowRequest(id) {
      await rejectFollowRequest(call, id);
    },

    async cancelFollowRequest(id) {
      await cancelFollowRequest(call, id);
    },

    async updateProfile(patch: ProfileUpdate) {
      const params: Record<string, unknown> = {};
      if (patch.name !== undefined) params.name = patch.name;
      if (patch.bio !== undefined) params.description = patch.bio;
      if (patch.location !== undefined) params.location = patch.location;
      if (patch.birthday !== undefined) params.birthday = patch.birthday;
      if (patch.locked !== undefined) params.isLocked = patch.locked;
      if (patch.bot !== undefined) params.isBot = patch.bot;
      if (patch.followedMessage !== undefined) params.followedMessage = patch.followedMessage;
      if (patch.lang !== undefined) params.lang = patch.lang;
      if (patch.avatarId !== undefined) params.avatarId = patch.avatarId;
      if (patch.bannerId !== undefined) params.bannerId = patch.bannerId;
      if (patch.fields !== undefined) params.fields = patch.fields;
      Object.assign(params, patch.ext ?? {});
      return adaptMe(await call<MeDetailed>("i/update", params));
    },

    /**
     * One profile image (clickstone §1.8): Misskey takes no file on
     * `i/update` — the avatar/banner must already be a Drive file the
     * caller owns with an `image/*` type (`i/update` errors
     * NO_SUCH_AVATAR / AVATAR_NOT_AN_IMAGE otherwise). So: upload through
     * `drive/files/create` (root — no `folderId`), then write the returned
     * id as `avatarId` / `bannerId`. Both of those params were already
     * accepted by `updateProfile`; this is the UI-reachable path to them.
     */
    async uploadProfileImage(kind: ProfileImageKind, file: File) {
      const uploaded = await transport.upload<DriveFile>(file);
      const id = uploaded?.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new FediError(
          "The server did not return the uploaded file.",
          "errors.shape.uploadedMedia",
        );
      }
      const params: Record<string, unknown> =
        kind === "avatar" ? { avatarId: id } : { bannerId: id };
      return adaptMe(await call<MeDetailed>("i/update", params));
    },

    async mutes(opts = {}) {
      return listAccounts("mute/list", opts);
    },

    async blocks(opts = {}) {
      return listAccounts("blocking/list", opts);
    },

    async mute(id) {
      await call<undefined>("mute/create", { userId: id });
    },

    async unmute(id) {
      await call<undefined>("mute/delete", { userId: id });
    },

    async muteRenotes(id) {
      await call<undefined>("renote-mute/create", { userId: id });
    },

    async unmuteRenotes(id) {
      await call<undefined>("renote-mute/delete", { userId: id });
    },

    // The accounts the viewer renote-mutes (C18-data): `renote-mute/list`
    // answers packed muting rows, unwrapped to accounts in
    // `misskey/renoteMutes.ts`. No Mastodon-family equivalent exists
    // (only the per-account `showing_reblogs` flag), so that backend
    // leaves this member absent.
    async renoteMutes(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      return listRenoteMutes(call, limit, cursor.untilId);
    },

    async block(id) {
      await call<undefined>("blocking/create", { userId: id });
    },

    async unblock(id) {
      await call<undefined>("blocking/delete", { userId: id });
    },

    async muteThread(noteId) {
      await call<undefined>("notes/thread-muting/create", { noteId });
    },

    // `users/report-abuse` is the USER-side report: `{userId, comment}`
    // with `comment` REQUIRED (minLength 1, verified in the server's
    // endpoint schema). That is the whole Misskey API — categories, rules,
    // status ids and forwarding do not exist there, so the chooser never
    // pretends they were used: the result lists them as unsupported with
    // the honest reason.
    async reportAccount(id, options = {}) {
      const normalized = normalizeReportOptions(options);
      const reason =
        "Misskey reports are a single message to the server's moderators — categories, rules, post selection and forwarding are not part of the Misskey API.";
      const unsupported: ReportUnsupportedField[] = [
        ...(normalized.statusIds?.length ? [reportUnsupported("statusIds", reason)] : []),
        ...(normalized.category ? [reportUnsupported("category", reason)] : []),
        ...(normalized.ruleIds?.length ? [reportUnsupported("ruleIds", reason)] : []),
        ...(normalized.forward === true ? [reportUnsupported("forward", reason)] : []),
      ];
      const comment = normalized.comment ?? "";
      if (comment.length === 0) {
        throw new FediError(
          "A report needs a reason on this server.",
          "errors.report.commentRequired",
        );
      }
      await call<undefined>("users/report-abuse", { userId: id, comment });
      return {
        comment,
        statusIds: [],
        category: null,
        ruleIds: [],
        forward: false,
        unsupported,
      };
    },

    search: {
      posts(query: string, opts: SearchPostsOpts = {}) {
        return callNotes(
          opts.tag ? "notes/search-by-tag" : "notes/search",
          {
            ...(opts.tag ? { tag: query } : { query }),
            limit: opts.limit ?? DEFAULT_LIMIT,
            ...decodeCursor(opts.cursor ?? null),
          },
          opts.signal,
        );
      },
      tags(tag: string, opts: PageOpts = {}) {
        return callNotes(
          "notes/search-by-tag",
          {
            tag,
            limit: opts.limit ?? DEFAULT_LIMIT,
            ...decodeCursor(opts.cursor ?? null),
          },
          opts.signal,
        );
      },
      async accounts(query: string, opts: PageOpts = {}) {
        const limit = opts.limit ?? DEFAULT_LIMIT;
        const rows = await call<UserLite[]>(
          "users/search",
          { query, limit },
          { signal: opts.signal },
        );
        return pageOf(rows ?? [], limit, adaptAccount);
      },
      /** `hashtags/search` (public, prefix match): the `#` autocomplete. */
      async suggestTags(query: string, opts: PageOpts = {}) {
        const rows = await call<string[]>(
          "hashtags/search",
          {
            query,
            limit: opts.limit ?? 8,
          },
          { signal: opts.signal },
        );
        return (rows ?? []).filter((t) => typeof t === "string" && t.length > 0);
      },
      /** `@` autocomplete is `users/search` (auth-required, like search). */
      async suggestAccounts(query: string, opts: PageOpts = {}) {
        const limit = opts.limit ?? 8;
        const rows = await call<UserLite[]>(
          "users/search",
          { query, limit },
          { signal: opts.signal },
        );
        return pageOf(rows ?? [], limit, adaptAccount);
      },
    },

    explore: {
      /** Pinned instance users + popular local users (reference-client
       * Explore: `pinned-users` + `users{state:alive,origin:local,
       * sort:+follower}`). Both public. Either side may fail alone: the
       * page still resolves from whichever side succeeded (never a fake
       * empty page when both fail — the first error propagates). */
      async users(opts: PageOpts = {}) {
        const limit = opts.limit ?? 10;
        const [pinnedSettled, popularSettled] = await Promise.allSettled([
          call<UserDetailed[]>("pinned-users", {}, { signal: opts.signal }),
          call<UserDetailed[]>(
            "users",
            {
              state: "alive",
              origin: "local",
              sort: "+follower",
              limit,
            },
            { signal: opts.signal },
          ),
        ]);
        if (pinnedSettled.status === "rejected" && popularSettled.status === "rejected") {
          throw pinnedSettled.reason;
        }
        const pinnedRows = pinnedSettled.status === "fulfilled" ? pinnedSettled.value : null;
        const popularRows = popularSettled.status === "fulfilled" ? popularSettled.value : null;
        const seen = new Set<string>();
        const suggested: Account[] = [];
        for (const row of [...(pinnedRows ?? []), ...(popularRows ?? [])]) {
          const account = adaptAccount(row);
          if (!seen.has(account.id)) {
            seen.add(account.id);
            suggested.push(account);
          }
        }
        return {
          pinned: (pinnedRows ?? []).map(adaptAccount),
          suggested,
        };
      },
      /** `hashtags/trend` (public): top tags with user counts. */
      async tags(opts: PageOpts = {}) {
        const rows = await call<Array<{ tag?: unknown; usersCount?: unknown }>>(
          "hashtags/trend",
          {},
          { signal: opts.signal },
        );
        return (rows ?? [])
          .filter((r) => typeof r?.tag === "string" && (r.tag as string).length > 0)
          .map((r) => ({
            name: r.tag as string,
            users: typeof r.usersCount === "number" ? r.usersCount : null,
            uses: null,
          }));
      },
      /** `notes/featured` (public): the global notes ranking, untilId-paged. */
      async posts(opts: PageOpts = {}) {
        const limit = opts.limit ?? DEFAULT_LIMIT;
        return callNotes(
          "notes/featured",
          {
            limit,
            ...decodeCursor(opts.cursor ?? null),
          },
          opts.signal,
        );
      },
    },

    async notifications(opts: NotificationsOpts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const params: Record<string, unknown> = {
        limit,
        ...decodeCursor(opts.cursor ?? null),
      };
      // Core preset tokens are KINDS; Misskey filters on its own wire
      // type strings (`achievementEarned`, not `achievement`). Unknown
      // tokens pass through verbatim so a fork-specific type can still be
      // filtered by its wire spelling.
      const includeTypes = misskeyNotificationTypes(opts.includeTypes);
      const excludeTypes = misskeyNotificationTypes(opts.excludeTypes);
      if (includeTypes.length > 0) params.includeTypes = includeTypes;
      if (excludeTypes.length > 0) params.excludeTypes = excludeTypes;
      if (opts.grouped) {
        const rows = await call<GroupedNotificationItem[]>(
          "i/notifications-grouped",
          params,
          { signal: opts.signal },
        );
        return pageOf(rows ?? [], limit, adaptGroupedNotification);
      }
      const rows = await call<NotificationItem[]>("i/notifications", params, {
        signal: opts.signal,
      });
      return pageOf(rows ?? [], limit, adaptNotification);
    },

    async markNotificationsRead() {
      await call<undefined>("notifications/mark-all-as-read", {});
    },

    async customEmojis() {
      const res = await call<{ emojis?: Array<{ name?: unknown; url?: unknown; category?: unknown }> }>(
        "emojis",
        {},
      );
      const list: CustomEmoji[] = [];
      for (const entry of res?.emojis ?? []) {
        // Same validation as the listing loader: junk entries never reach
        // the picker (`isValidEmojiEntry` in `./emoji`).
        if (!isValidEmojiEntry(entry)) continue;
        list.push({
          name: entry.name,
          url: entry.url,
          category: typeof entry.category === "string" ? entry.category : null,
        });
      }
      return list;
    },

    async uploadMedia(file, opts = {}) {
      // Build the multipart options explicitly: `folderId`/`force` are
      // opt-in Drive fields. A null folderId means the Drive root and is
      // omitted (never sent as an empty field — Sharkey rejects those).
      // `signal` aborts on explicit Cancel only (repair X3.1/X7.4).
      const uploadOpts: UploadOptions = {
        ...(opts.isSensitive !== undefined ? { isSensitive: opts.isSensitive } : {}),
        ...(opts.comment !== undefined ? { comment: opts.comment } : {}),
        ...(opts.folderId != null ? { folderId: opts.folderId } : {}),
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
      return adaptDriveFile(await transport.upload<DriveFile>(file, uploadOpts));
    },

    async updateMedia(id, patch) {
      // Caption edit is `drive/files/update` `comment` (clickstone §1.7:
      // title? `mediaDescription` gate). `focus` has no Misskey-family
      // field at all — it is DROPPED, never sent, and the UI never offers
      // it there. `null` clears the caption (the param is nullable
      // upstream); an untouched description is not sent.
      return drive.updateFile(id, {
        ...(patch.description !== undefined ? { comment: patch.description } : {}),
      });
    },

    async translate(id, targetLang) {
      const res = await call<{ sourceLang?: unknown; text?: unknown }>("notes/translate", {
        noteId: id,
        targetLang,
      });
      return {
        sourceLang: typeof res?.sourceLang === "string" ? res.sourceLang : null,
        text: typeof res?.text === "string" ? res.text : "",
      } satisfies Translation;
    },

    stream(): StreamHandle | null {
      // Single pooled handle per backend: the first call builds the pool,
      // later calls share it (the session-level registry in `api/client.ts`
      // shares the backend itself, so N feeds + notifications + chat ride
      // one socket per session). The slot lives on the backend instance —
      // no module state, no cross-session leak. No origin (tests, offline
      // builders): no socket target, so no handle — feeds keep working via
      // paging + refresh. Pinetree has no `/streaming` route: `supported:
      // false` returns null the same way.
      if (!opts.origin) return null;
      const slot = (this ?? {}) as Partial<{ pooledStream: StreamHandle | null }>;
      if (slot.pooledStream === undefined) {
        slot.pooledStream = createStreamHandle({
          origin: opts.origin,
          token: opts.token ?? null,
          supported: flavor !== "pinetree",
        });
      }
      return slot.pooledStream;
    },

    drive,
    antennas,
    clips,
    channels,
    // Chat ships on misskey + sharkey (verified `chat/*` presence:
    // upstream develop tree + live Sharkey probe). Catodon is unverified
    // and Pinetree has no chat — those flavors leave the member off and
    // the capability reads unsupported, so the screens render the honest
    // gate instead of a missing module (mastodon-conversations pattern).
    ...(flavor === "misskey" || flavor === "sharkey" ? { chat } : {}),
    announcements,
    // Server insight ships on misskey + sharkey + catodon (all three
    // serve the four insight endpoints with identical kinds; verified in
    // their checkouts). Pinetree serves none — the member stays off and
    // the insight gate renders the honest unavailable state.
    ...(flavor === "misskey" || flavor === "sharkey" || flavor === "catodon"
      ? { adminInsight }
      : {}),
    // Reports queue ships on the same three flavors (identical abuse
    // endpoints + kinds; verified in their checkouts). Pinetree stays off.
    ...(flavor === "misskey" || flavor === "sharkey" || flavor === "catodon"
      ? { reportsQueue }
      : {}),
    lists,
    scheduled,
    serverDrafts,
    bookmarks,
    transfer,
    recommendations,
  };
}


// --- Wire-shaped helpers that are not worth a module ----------------------
// (Antenna/draft/note-body mapping lives in `./antennas`,
// `./serverDrafts` and `./noteBody`; only the truly local helpers stay.)

/** The honest answer for an insight section this family cannot serve
 * (the Mastodon-family methods on the Misskey backend — no such
 * endpoints here). Status 404 so the UI's "not on this server" states
 * trigger exactly as they do for a missing Misskey endpoint. */
function unsupportedAdminInsight(scope: string): never {
  throw new ApiError(
    `Server insight ${scope} is not available on this server.`,
    404,
    "errors.unsupported.adminInsight",
  );
}

/**
 * Capabilities come from `core/detect.ts` (plan §2.1: detection plus a
 * flavour table — nothing unlocks on an unverified feature). The static
 * `buildMisskeyCapabilities` invention that was here first is gone.
 */
