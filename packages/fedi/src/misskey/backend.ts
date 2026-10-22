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
  Post,
  Relationship,
} from "../core/models";
import type {
  AccountPostsOpts,
  AnnouncementsApi,
  Antenna,
  AntennasApi,
  Backend,
  BookmarksApi,
  ChannelsApi,
  ChatApi,
  ClipSummary,
  ClipsApi,
  CustomEmoji,
  DriveApi,
  FollowRequest,
  ListsApi,
  NoteReactionRow,
  NotificationsOpts,
  PageOpts,
  PostDraft,
  ProfileImageKind,
  ProfileUpdate,
  ReportUnsupportedField,
  ScheduledApi,
  ScheduledNote,
  SearchPostsOpts,
  ServerDraft,
  ServerDraftsApi,
  StreamHandle,
  TimelineKind,
  TransferApi,
  Translation,
  UserReaction,
} from "../core/backend";
import type { DetectionEvidence, ServerFlavor } from "../core/detect";
import { buildCapabilities } from "../core/detect";
import { normalizeReportOptions, reportUnsupported } from "../core/backend";
import { FediError } from "../core/errors";
import {
  adaptAccount,
  adaptDriveFile,
  adaptDriveFolder,
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
import type {
  DriveFile,
  DriveFolder as WireDriveFolder,
  ServerDraft as WireServerDraft,
  GroupedNotificationItem,
  MeDetailed,
  Note,
  NotificationItem,
  UserDetailed,
  UserLite,
  UserRelation,
} from "./wire";
import { isUnsupportedError } from "./client";
import type { UploadOptions } from "./client";
import {
  CONVERSATION_PAGE_SIZE,
  MAX_ANCESTOR_WALK,
  REPLIES_PAGE_SIZE,
  orderAncestors,
} from "./thread";
import { createStreamHandle } from "./stream";
import { resolveQuoteUri } from "./quote";
import {
  addNoteToClip,
  createClip,
  deleteClip,
  listClips,
  listClipsContaining,
  removeNoteFromClip,
  updateClip,
} from "./clips";
import {
  adaptChannel,
  followChannel,
  listFollowedChannels,
  searchChannels,
  showChannel,
  unfollowChannel,
} from "./channels";
import {
  chatHistory,
  createChatRoom,
  createRoomMessage,
  createUserMessage,
  deleteChatMessage,
  listChatRooms,
  readAllChat,
  roomTimeline,
  showChatMessage,
  showChatRoom,
  userTimeline,
} from "./chat";
import { listAnnouncements, readAnnouncement } from "./announcements";
import { listFavorites, removeFavorite } from "./favorites";
import { listFeaturedNotes, listUserFeaturedNotes, pinNote, unpinNote } from "./featured";
import {
  acceptFollowRequest,
  cancelFollowRequest,
  listFollowRequests,
  rejectFollowRequest,
} from "./followRequests";
import { createScheduledNote, deleteScheduledNote, listScheduledNotes } from "./schedule";
import { editNote } from "./noteEdit";
import { listsContaining as listsContainingM, addToList as addToListM, removeFromList as removeFromListM } from "./listMembership";
import { listRenoteMutes } from "./renoteMutes";
import {
  countServerDrafts,
  createServerDraft,
  deleteServerDraft,
  listServerDrafts,
  updateServerDraft,
} from "./serverDrafts";
import { exportData, importData } from "./importExport";

// --- Transport -------------------------------------------------------------
//
// The backend is built for exactly one session: every method below calls
// through the injected transport (a `MisskeyClient` bound to that session,
// or a stub in tests), so a token can only ever reach its own origin.
// There is no global routing facade in this package.

export interface MisskeyTransport {
  call<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
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

// --- Compose body (verbatim mirror of the Composer's construction) ---------

function wireVisibility(draft: PostDraft): string {
  if (draft.visibility?.raw) return draft.visibility.raw;
  switch (draft.visibility?.kind) {
    case "quiet":
      return "home";
    case "followers":
      return "followers";
    case "direct":
      return "specified";
    default:
      return "public";
  }
}

function createNoteBody(draft: PostDraft): Record<string, unknown> {
  const visibility = wireVisibility(draft);
  return {
    visibility,
    ...(draft.text && draft.text.trim() ? { text: draft.text.trim() } : {}),
    ...(draft.cw && draft.cw.trim() ? { cw: draft.cw.trim() } : {}),
    ...(visibility === "specified" && draft.visibleUserIds
      ? { visibleUserIds: draft.visibleUserIds }
      : {}),
    ...(draft.visibility?.localOnly ? { localOnly: true } : {}),
    ...(draft.replyId ? { replyId: draft.replyId } : {}),
    ...(draft.renoteId ? { renoteId: draft.renoteId } : {}),
    ...(draft.mediaIds && draft.mediaIds.length > 0 ? { fileIds: draft.mediaIds } : {}),
    // The Composer maps its empty selection to null (never ""); a value is
    // sent verbatim, unknown values included.
    ...(draft.reactionAcceptance != null ? { reactionAcceptance: draft.reactionAcceptance } : {}),
    ...(draft.noQuote ? { noQuote: true } : {}),
    ...(draft.poll
      ? {
          poll: {
            choices: draft.poll.choices,
            multiple: draft.poll.multiple,
            ...(draft.poll.expiredAfter != null
              ? { expiredAfter: draft.poll.expiredAfter }
              : {}),
            ...(draft.poll.expiresAt != null ? { expiresAt: draft.poll.expiresAt } : {}),
          },
        }
      : {}),
  };
}

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
  ): Promise<Page<Post>> {
    const limit = typeof params.limit === "number" ? params.limit : DEFAULT_LIMIT;
    const items = await call<Note[]>(endpoint, params);
    return pageOf(items ?? [], limit, adaptNote);
  }

  const drive: DriveApi = {
    async files(opts = {}) {
      const params: Record<string, unknown> = {
        limit: opts.limit ?? DEFAULT_LIMIT,
      };
      if (opts.type) params.type = opts.type;
      // Omitted means the Drive root upstream; an explicit null is the same
      // root and is never sent (Sharkey rejects empty/default fields).
      if (opts.folderId != null) params.folderId = opts.folderId;
      Object.assign(params, decodeCursor(opts.cursor ?? null));
      const items = await call<DriveFile[]>("drive/files", params);
      return pageOf(items ?? [], params.limit as number, adaptDriveFile);
    },
    async showFile(id) {
      return adaptDriveFile(await call<DriveFile>("drive/files/show", { fileId: id }));
    },
    async attachedNotes(id, opts = {}) {
      // Same note paging shape as every other Misskey note listing
      // (`drive/files/attached-notes` takes fileId + limit/untilId).
      return callNotes("drive/files/attached-notes", {
        fileId: id,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    async updateFile(id, patch) {
      const params: Record<string, unknown> = { fileId: id };
      if (patch.name !== undefined) params.name = patch.name;
      if (patch.isSensitive !== undefined) params.isSensitive = patch.isSensitive;
      if (patch.comment !== undefined) params.comment = patch.comment;
      if (patch.folderId !== undefined) params.folderId = patch.folderId;
      return adaptDriveFile(await call<DriveFile>("drive/files/update", params));
    },
    async deleteFile(id) {
      await call<undefined>("drive/files/delete", { fileId: id });
    },
    // Drive folders (`drive/folders/*`, Misskey/Sharkey-family only —
    // verified absent on Pinetree, which keeps `drive: unsupported`). The
    // list call sends no `folderId`: upstream defaults to null, which is
    // the drive root, and omitted params can never trip Sharkey's
    // unknown-field 400s.
    folders: {
      async list() {
        const items = await call<WireDriveFolder[]>("drive/folders", {});
        return (items ?? []).map(adaptDriveFolder);
      },
      async create(name, opts = {}) {
        return adaptDriveFolder(
          await call<WireDriveFolder>("drive/folders/create", {
            name,
            ...(opts.parentId != null ? { parentId: opts.parentId } : {}),
          }),
        );
      },
      async update(id, patch) {
        const params: Record<string, unknown> = { folderId: id };
        if (patch.name !== undefined) params.name = patch.name;
        if (patch.parentId !== undefined) params.parentId = patch.parentId;
        return adaptDriveFolder(await call<WireDriveFolder>("drive/folders/update", params));
      },
      async delete(id) {
        await call<undefined>("drive/folders/delete", { folderId: id });
      },
    },
  };

  const antennas: AntennasApi = {
    async list() {
      const items = await call<Array<Record<string, unknown>>>("antennas/list", {});
      return (items ?? []).map(adaptAntenna);
    },
    async create(params) {
      return adaptAntenna(
        await call<Record<string, unknown>>("antennas/create", antennaBody(params)),
      );
    },
    async update(id, params) {
      return adaptAntenna(
        await call<Record<string, unknown>>("antennas/update", {
          antennaId: id,
          ...antennaBody(params),
        }),
      );
    },
    async delete(id) {
      await call<undefined>("antennas/delete", { antennaId: id });
    },
    async notes(id, opts = {}) {
      return callNotes("antennas/notes", {
        antennaId: id,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
  };

  const clips: ClipsApi = {
    async list() {
      return (await listClips(call)).map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.isPublic !== undefined ? { isPublic: c.isPublic } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.notesCount !== undefined ? { notesCount: c.notesCount } : {}),
      }));
    },
    async addNote(clipId, noteId) {
      await addNoteToClip(call, clipId, noteId);
    },
    async removeNote(clipId, noteId) {
      await removeNoteFromClip(call, clipId, noteId);
    },
    async create(name, opts = {}) {
      const c = await createClip(call, name, opts);
      return {
        id: c.id,
        name: c.name,
        ...(c.isPublic !== undefined ? { isPublic: c.isPublic } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.notesCount !== undefined ? { notesCount: c.notesCount } : {}),
      };
    },
    async update(clipId, patch) {
      const c = await updateClip(call, clipId, patch);
      return {
        id: c.id,
        name: c.name,
        ...(c.isPublic !== undefined ? { isPublic: c.isPublic } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.notesCount !== undefined ? { notesCount: c.notesCount } : {}),
      };
    },
    async delete(clipId) {
      await deleteClip(call, clipId);
    },
    async notes(clipId, opts = {}) {
      return callNotes("clips/notes", {
        clipId,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    async containing(noteId) {
      return (await listClipsContaining(call, noteId)).map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.isPublic !== undefined ? { isPublic: c.isPublic } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.notesCount !== undefined ? { notesCount: c.notesCount } : {}),
      }));
    },
  };

  // Channels (clickstone §1.9): the Misskey-family group timelines. The
  // directory is `channels/search` with an empty query (the official client
  // renders the same paged search); `channels/featured` is a fixed top-10
  // with no cursor, so it cannot page. No `allowPartial` is sent — the
  // reference client's paginator sends only `channelId` + cursor params.
  const channels: ChannelsApi = {
    async list(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const params: Record<string, unknown> = {
        query: opts.query ?? "",
        limit,
        ...decodeCursor(opts.cursor ?? null),
      };
      return pageOf(await searchChannels(call, params), limit, adaptChannel);
    },
    async show(channelId) {
      return showChannel(call, channelId);
    },
    async notes(channelId, opts = {}) {
      return callNotes("channels/timeline", {
        channelId,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    async followed(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const rows = await listFollowedChannels(call, {
        limit,
        ...decodeCursor(opts.cursor ?? null),
      });
      return pageOf(rows, limit, adaptChannel);
    },
    follow(channelId) {
      return followChannel(call, channelId);
    },
    unfollow(channelId) {
      return unfollowChannel(call, channelId);
    },
  };

  // Misskey chat (P6.2, clickstone §2.2): rooms + 1-on-1 threads. The
  // paged surfaces (`joining`, both timelines) ride the shared
  // `{limit, sinceId, untilId}` cursor convention (decodeCursor); the
  // overview (`chat/history`) is limit-only server-side, so `history`
  // refetches rather than pages. Timeline fetches mark read server-side
  // — there is deliberately no per-thread mark call here.
  const chat: ChatApi = {
    async rooms(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      const rows = await listChatRooms(call, {
        limit,
        ...(cursor.sinceId ? { sinceId: cursor.sinceId } : {}),
        ...(cursor.untilId ? { untilId: cursor.untilId } : {}),
      });
      return pageOf(rows ?? [], limit, (row) => row);
    },
    async history(opts = {}) {
      const rows = await chatHistory(call, {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.rooms !== undefined ? { rooms: opts.rooms } : {}),
      });
      return rows ?? [];
    },
    showRoom(roomId) {
      return showChatRoom(call, roomId);
    },
    createRoom(name, opts = {}) {
      return createChatRoom(call, {
        name,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
      });
    },
    async roomMessages(roomId, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      const { items } = await roomTimeline(call, roomId, {
        limit,
        ...(cursor.sinceId ? { sinceId: cursor.sinceId } : {}),
        ...(cursor.untilId ? { untilId: cursor.untilId } : {}),
      });
      return pageOf(items ?? [], limit, (item) => item);
    },
    async userMessages(userId, opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      const { items } = await userTimeline(call, userId, {
        limit,
        ...(cursor.sinceId ? { sinceId: cursor.sinceId } : {}),
        ...(cursor.untilId ? { untilId: cursor.untilId } : {}),
      });
      return pageOf(items ?? [], limit, (item) => item);
    },
    showMessage(messageId) {
      return showChatMessage(call, messageId);
    },
    sendToRoom(roomId, text, opts = {}) {
      return createRoomMessage(call, roomId, {
        ...(text !== undefined ? { text } : {}),
        ...(opts.fileId !== undefined ? { fileId: opts.fileId } : {}),
      });
    },
    sendToUser(userId, text, opts = {}) {
      return createUserMessage(call, userId, {
        ...(text !== undefined ? { text } : {}),
        ...(opts.fileId !== undefined ? { fileId: opts.fileId } : {}),
      });
    },
    deleteMessage(messageId) {
      return deleteChatMessage(call, messageId);
    },
    readAll() {
      return readAllChat(call);
    },
  };

  // Server announcements (clickstone §1.12): `announcements` is public and
  // paged (`limit`/`sinceId`/`untilId`, active only); the read flag rides
  // the pack for a signed-in caller. `i/read-announcement` marks one read.
  const announcements: AnnouncementsApi = {
    async list(opts = {}) {
      return listAnnouncements(call, {
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    async dismiss(id) {
      await readAnnouncement(call, id);
    },
  };

  const lists: ListsApi = {
    membership: {
      containing: (accountId) => listsContainingM(call, accountId),
      add: (listId, accountId) => addToListM(call, listId, accountId),
      remove: (listId, accountId) => removeFromListM(call, listId, accountId),
    },
    async list() {
      const items = await call<Array<{ id: string; name: string }>>("lists/list", {});
      return items ?? [];
    },
    async timeline(listId, opts = {}) {
      return callNotes("notes/user-list-timeline", {
        listId,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },
    // List CRUD (C15-data): `users/lists/create|update|delete` — the
    // packed UserList answers `{id, name, ...}`; only id+name surface.
    // `fields` (Mastodon replies_policy/exclusive) is intentionally
    // ignored: Misskey user lists have neither, and the capabilities table
    // reports both unsupported so the UI never offers them. Sending an
    // unknown param to Misskey is a 400 — never send it.
    async create(name, _fields = {}) {
      const row = await call<{ id: string; name: string }>("users/lists/create", { name });
      return { id: row.id, name: row.name ?? name };
    },
    async update(id, patch) {
      const row = await call<{ id: string; name: string }>("users/lists/update", {
        listId: id,
        name: patch.name,
      });
      return { id: row.id ?? id, name: row.name ?? patch.name };
    },
    async delete(id) {
      await call<undefined>("users/lists/delete", { listId: id });
    },
  };

  const scheduled: ScheduledApi = {
    async list(opts = {}) {
      const cursor = decodeCursor(opts.cursor ?? null);
      // Both directions: `untilId` pages down, `sinceId` lets pull-to-
      // refresh see rows created after the newest one it already holds.
      const items = await listScheduledNotes(
        call,
        opts.limit ?? DEFAULT_LIMIT,
        cursor.untilId,
        cursor.sinceId,
      );
      return items.map(
        (s): ScheduledNote => ({
          id: s.id,
          scheduledAt: s.scheduledAt,
          post: s.note ? adaptNote(s.note) : null,
          draft: s.draft ?? null,
        }),
      );
    },
    async create(draft) {
      const created = await createScheduledNote(
        call,
        {
          ...createNoteBody(draft),
          scheduledAt: draft.scheduledAt,
        },
      );
      return {
        id: created.id,
        scheduledAt: created.scheduledAt,
        post: created.note ? adaptNote(created.note) : null,
        draft: created.draft ?? null,
      };
    },
    async delete(id) {
      await deleteScheduledNote(call, id);
    },
  };

  const serverDrafts: ServerDraftsApi = {
    async list(opts = {}) {
      const cursor = decodeCursor(opts.cursor ?? null);
      return (
        await listServerDrafts(
          call,
          opts.limit ?? DEFAULT_LIMIT,
          cursor.untilId,
          cursor.sinceId,
        )
      ).map(adaptServerDraft);
    },
    async create(draft) {
      return adaptServerDraft(
        await createServerDraft(
          call,
          {
            ...createNoteBody(draft),
            ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
          },
        ),
      );
    },
    async update(id, draft) {
      return adaptServerDraft(
        await updateServerDraft(
          call,
          id,
          {
            ...createNoteBody(draft),
            ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
          },
        ),
      );
    },
    async delete(id) {
      await deleteServerDraft(call, id);
    },
    async count() {
      return countServerDrafts(call);
    },
  };

  const bookmarks: BookmarksApi = {
    async list(opts = {}) {
      const limit = opts.limit ?? DEFAULT_LIMIT;
      const cursor = decodeCursor(opts.cursor ?? null);
      const rows = await listFavorites(call, cursor.untilId);
      return pageOf(rows ?? [], limit, (row) => ({
        id: row.id,
        post: adaptNote(row.note),
      }));
    },
    async add(noteId) {
      await call<undefined>("notes/favorites/create", { noteId });
    },
    async remove(noteId) {
      await removeFavorite(call, noteId);
    },
  };

  // Account data portability (clickstone §2.3): imports upload the picked
  // file to Drive and then call `i/import-*` with the returned `{fileId}`
  // (never `{file}`); exports only ENQUEUE and report the rate window +
  // the `exportCompleted` notification to watch. The 0.6 shapes stand.
  const transfer: TransferApi = {
    importFile: (kind, file, opts) => {
      const onPhase = opts?.onPhase;
      return importData(
        transport,
        kind,
        file,
        onPhase ? { onProgress: (progress) => onPhase(progress.phase) } : {},
      );
    },
    exportList: (kind) => exportData(call, kind),
  };

  return {
    family: "misskey",
    capabilities,

    timeline(kind, opts = {}) {
      return callNotes(TIMELINE_ENDPOINTS[kind], {
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
    },

    async post(id) {
      return adaptNote(await call<Note>("notes/show", { noteId: id }));
    },

    async thread(post) {
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
          const page = await call<Note[]>("notes/conversation", {
            noteId: post.id,
            limit: CONVERSATION_PAGE_SIZE,
            offset,
          });
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
      return callNotes("notes/replies", {
        noteId: id,
        limit: opts.limit ?? REPLIES_PAGE_SIZE,
        ...decodeCursor(opts.cursor ?? null),
      });
    },

    // The detail "Reposts" tab: `notes/renotes` answers the renote
    // notes (usually pure wrappers); the tab shows their authors —
    // one active renote per account, server order. The cursor stays
    // the opaque note cursor; callers dedupe by account id exactly
    // like feeds merge by note id.
    async reposts(id, opts = {}) {
      const page = await callNotes("notes/renotes", {
        noteId: id,
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...decodeCursor(opts.cursor ?? null),
      });
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
      >("notes/reactions", params);
      return pageOf(rows ?? [], limit, (row): NoteReactionRow => ({
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
      // Edit semantics differ from create: empty text/cw are sent as
      // EXPLICIT nulls so the server clears them (today's editNote body).
      const visibility = wireVisibility(draft);
      return editNote(
        call,
        id,
        {
          text: draft.text && draft.text.trim() ? draft.text.trim() : null,
          cw: draft.cw && draft.cw.trim() ? draft.cw.trim() : null,
          visibility,
          ...(visibility === "specified" && draft.visibleUserIds
            ? { visibleUserIds: draft.visibleUserIds }
            : {}),
          ...(draft.visibility?.localOnly ? { localOnly: true } : {}),
          ...(draft.mediaIds && draft.mediaIds.length > 0
            ? { fileIds: draft.mediaIds }
            : {}),
          // Per-note quote refusal (create parity). Edit forwards the value
          // the caller carries, so `false` can lift an earlier refusal.
          ...(draft.noQuote !== undefined ? { noQuote: draft.noQuote } : {}),
          // Poll edits use the exact create shape. A server-side rejection
          // (4xx) propagates from `editNote` — never silently dropped.
          ...(draft.poll
            ? {
                poll: {
                  choices: draft.poll.choices,
                  multiple: draft.poll.multiple,
                  ...(draft.poll.expiredAfter != null
                    ? { expiredAfter: draft.poll.expiredAfter }
                    : {}),
                  ...(draft.poll.expiresAt != null ? { expiresAt: draft.poll.expiresAt } : {}),
                },
              }
            : {}),
        },
      );
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

    async votePoll(id, choices) {
      for (const choice of choices) {
        await call<undefined>("notes/polls/vote", { noteId: id, choice });
      }
    },

    // Textual `RE:` resolution: the `ap/show` lookup (with its
    // seen/lookup caches in `misskey/quote`) over this backend's transport —
    // family-routed here so the UI never picks a resolver by hand
    // (plan §3 Phase 3 item 4).
    resolveQuoteUri(uri: string): Promise<Post | null> {
      return resolveQuoteUri(call, uri);
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

    async me() {
      return adaptMe(await call<MeDetailed>("i", {}));
    },

    async account(ref) {
      const params: Record<string, unknown> = {};
      if (ref.id) params.userId = ref.id;
      if (ref.username) {
        params.username = ref.username;
        if (ref.host) params.host = ref.host;
      }
      return adaptAccount(await call<UserDetailed>("users/show", params));
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
      return callNotes("users/notes", params);
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
      >("users/reactions", {
        userId: id,
        limit,
        ...decodeCursor(opts.cursor ?? null),
      });
      return pageOf(rows ?? [], limit, (row): UserReaction => ({
        id: row.id,
        createdAt: row.createdAt,
        reaction: row.reaction,
        // The server hides some reacted posts: null, never faked.
        post: row.note ? adaptNote(row.note) : null,
      }));
    },

    async relationships(ids) {
      const rels = await call<UserRelation[]>("users/relation", { userIds: ids });
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
        return callNotes(opts.tag ? "notes/search-by-tag" : "notes/search", {
          ...(opts.tag ? { tag: query } : { query }),
          limit: opts.limit ?? DEFAULT_LIMIT,
          ...decodeCursor(opts.cursor ?? null),
        });
      },
      tags(tag: string, opts: PageOpts = {}) {
        return callNotes("notes/search-by-tag", {
          tag,
          limit: opts.limit ?? DEFAULT_LIMIT,
          ...decodeCursor(opts.cursor ?? null),
        });
      },
      async accounts(query: string, opts: PageOpts = {}) {
        const limit = opts.limit ?? DEFAULT_LIMIT;
        const rows = await call<UserLite[]>("users/search", { query, limit });
        return pageOf(rows ?? [], limit, adaptAccount);
      },
      /** `hashtags/search` (public, prefix match): the `#` autocomplete. */
      async suggestTags(query: string, opts: PageOpts = {}) {
        const rows = await call<string[]>("hashtags/search", {
          query,
          limit: opts.limit ?? 8,
        });
        return (rows ?? []).filter((t) => typeof t === "string" && t.length > 0);
      },
      /** `@` autocomplete is `users/search` (auth-required, like search). */
      async suggestAccounts(query: string, opts: PageOpts = {}) {
        const limit = opts.limit ?? 8;
        const rows = await call<UserLite[]>("users/search", { query, limit });
        return pageOf(rows ?? [], limit, adaptAccount);
      },
    },

    explore: {
      /** Pinned instance users + popular local users (reference-client
       * Explore: `pinned-users` + `users{state:alive,origin:local,
       * sort:+follower}`). Both public. */
      async users(opts: PageOpts = {}) {
        const limit = opts.limit ?? 10;
        const [pinnedRows, popularRows] = await Promise.all([
          call<UserDetailed[]>("pinned-users", {}),
          call<UserDetailed[]>("users", {
            state: "alive",
            origin: "local",
            sort: "+follower",
            limit,
          }),
        ]);
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
      async tags() {
        const rows = await call<Array<{ tag?: unknown; usersCount?: unknown }>>(
          "hashtags/trend",
          {},
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
        return callNotes("notes/featured", {
          limit,
          ...decodeCursor(opts.cursor ?? null),
        });
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
        const rows = await call<GroupedNotificationItem[]>("i/notifications-grouped", params);
        return pageOf(rows ?? [], limit, adaptGroupedNotification);
      }
      const rows = await call<NotificationItem[]>("i/notifications", params);
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
        // the picker.
        if (
          typeof entry?.name !== "string" ||
          typeof entry?.url !== "string" ||
          entry.name.length === 0 ||
          entry.url.length === 0
        ) {
          continue;
        }
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
      const uploadOpts: UploadOptions = {
        ...(opts.isSensitive !== undefined ? { isSensitive: opts.isSensitive } : {}),
        ...(opts.comment !== undefined ? { comment: opts.comment } : {}),
        ...(opts.folderId != null ? { folderId: opts.folderId } : {}),
        ...(opts.force !== undefined ? { force: opts.force } : {}),
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
      // No origin (tests, offline builders): no socket target, so no
      // handle — feeds keep working via paging + refresh. Pinetree has no
      // `/streaming` route: `supported: false` returns null the same way.
      if (!opts.origin) return null;
      return createStreamHandle({
        origin: opts.origin,
        token: opts.token ?? null,
        supported: flavor !== "pinetree",
      });
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
    lists,
    scheduled,
    serverDrafts,
    bookmarks,
    transfer,
  };

  async function listAccounts(
    endpoint: string,
    opts: PageOpts,
    extra: Record<string, unknown> = {},
  ): Promise<Page<Account>> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const rows = await call<UserLite[]>(endpoint, {
      ...extra,
      limit,
      ...decodeCursor(opts.cursor ?? null),
    });
    return pageOf(rows ?? [], limit, adaptAccount);
  }
}

// --- Wire-shaped helpers that are not worth a module ----------------------

function adaptServerDraft(raw: WireServerDraft): ServerDraft {
  return {
    id: raw.id,
    text: raw.text ?? null,
    cw: raw.cw ?? null,
    visibilityRaw: raw.visibility,
    visibleUserIds: raw.visibleUserIds,
    localOnly: raw.localOnly,
    mediaIds: raw.fileIds,
    replyId: raw.replyId ?? null,
    renoteId: raw.renoteId ?? null,
    scheduledAt: raw.scheduledAt ?? null,
    poll: raw.poll ?? undefined,
  };
}

function antennaBody(params: Omit<Antenna, "id">): Record<string, unknown> {
  return {
    name: params.name,
    src: params.src,
    userListId: params.userListId,
    keywords: params.keywords,
    excludeKeywords: params.excludeKeywords,
    users: params.users,
    caseSensitive: params.caseSensitive,
    localOnly: params.localOnly,
    excludeBots: params.excludeBots,
    withReplies: params.withReplies,
    withFile: params.withFile,
  };
}

function adaptAntenna(raw: Record<string, unknown>): Antenna {
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const strGroups = (v: unknown): string[][] =>
    Array.isArray(v)
      ? v
          .filter((g): g is unknown[] => Array.isArray(g))
          .map((g) => g.filter((x): x is string => typeof x === "string"))
      : [];
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
    src: (typeof raw.src === "string" ? raw.src : "all") as Antenna["src"],
    userListId: typeof raw.userListId === "string" ? raw.userListId : null,
    keywords: strGroups(raw.keywords),
    excludeKeywords: strGroups(raw.excludeKeywords),
    users: strArray(raw.users),
    caseSensitive: raw.caseSensitive === true,
    localOnly: raw.localOnly === true,
    excludeBots: raw.excludeBots === true,
    withReplies: raw.withReplies === true,
    withFile: raw.withFile === true,
  };
}

/**
 * Capabilities come from `core/detect.ts` (plan §2.1: detection plus a
 * flavour table — nothing unlocks on an unverified feature). The static
 * `buildMisskeyCapabilities` invention that was here first is gone.
 */
