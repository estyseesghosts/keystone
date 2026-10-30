// Misskey-family Pages (`pages/*`, `users/pages`, `i/pages`,
// `i/page-likes`, pin via `i/update`). Pure wire module (clips.ts
// pattern): injected `WireCall`, tolerant adapt (never throws), exact
// serialize, error mapping by string code first, UUID prefix second.
//
// Wire reference: `docs/pages-clips.md` §4 (Misskey), `docs/pinetree-
// pages-clips.md` §1 (Pinetree divergences: `i/pages` + `i/page-likes`
// 404, moderator cannot update — `NO_SUCH_PAGE` on foreign update).

import {ApiError} from "../core/errors";
import type {PageDraft, PageOpts, PagePatch} from "../core/backend";
import type {
  Account,
  Cursor,
  Media,
  Page,
  PageBlock,
  PageFont,
  PageModel,
} from "../core/models";
import {adaptAccount, adaptDriveFile, decodeCursor, pageOf} from "./adapt";
import type {DriveFile, UserLite} from "./wire";
import type {WireCall} from "./client";

/** Packed page block (all fields optional — the adapter coerces). */
export interface WirePageBlock {
  id?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

/** Packed Misskey page (all fields optional — the adapter coerces). */
export interface WirePage {
  id?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  userId?: unknown;
  user?: unknown;
  content?: unknown;
  variables?: unknown;
  title?: unknown;
  name?: unknown;
  summary?: unknown;
  hideTitleWhenPinned?: unknown;
  alignCenter?: unknown;
  font?: unknown;
  script?: unknown;
  eyeCatchingImageId?: unknown;
  eyeCatchingImage?: unknown;
  attachedFiles?: unknown;
  likedCount?: unknown;
  isLiked?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Known block field names (everything else rides `extra` for the
 * byte-equal serialize round-trip — PG-3). */
const BLOCK_OWN_FIELDS: Record<string, readonly string[]> = {
  text: ["id", "type", "text"],
  section: ["id", "type", "title", "children"],
  image: ["id", "type", "fileId"],
  note: ["id", "type", "note", "detailed"],
};

function extraOf(raw: Record<string, unknown>, kind: string): Record<string, unknown> | undefined {
  const owned = BLOCK_OWN_FIELDS[kind] ?? ["id", "type"];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!owned.includes(k)) extra[k] = v;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function childBlocks(value: unknown): PageBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map(adaptPageBlock);
}

/** Wire block → domain. Never throws: odd fields coerce, unknown types
 * survive verbatim as `kind: 'unknown'` (PG-3). */
export function adaptPageBlock(raw: unknown): PageBlock {
  const row = asRecord(raw);
  const id = asStringOrEmpty(row.id);
  const type = asString(row.type);
  if (type === "text") {
    const block: PageBlock = {kind: "text", id, text: asStringOrEmpty(row.text)};
    const extra = extraOf(row, "text");
    if (extra) block.extra = extra;
    return block;
  }
  if (type === "section") {
    const block: PageBlock = {
      kind: "section",
      id,
      title: asStringOrEmpty(row.title),
      children: childBlocks(row.children),
    };
    const extra = extraOf(row, "section");
    if (extra) block.extra = extra;
    return block;
  }
  if (type === "image") {
    const fileId = row.fileId;
    const block: PageBlock = {kind: "image", id, fileId: typeof fileId === "string" ? fileId : null};
    const extra = extraOf(row, "image");
    if (extra) block.extra = extra;
    return block;
  }
  if (type === "note") {
    const note = row.note;
    const block: PageBlock = {
      kind: "note",
      id,
      noteId: typeof note === "string" ? note : null,
      detailed: row.detailed === true,
    };
    const extra = extraOf(row, "note");
    if (extra) block.extra = extra;
    return block;
  }
  return {kind: "unknown", id, type: type ?? "unknown", raw: row};
}

/** Domain block → wire block. `unknown` rides verbatim; known kinds keep
 * their `extra` fields so adapt→serialize round-trips byte-equal. */
export function serializePageBlock(block: PageBlock): Record<string, unknown> {
  switch (block.kind) {
    case "text":
      return {id: block.id, type: "text", text: block.text, ...block.extra};
    case "section":
      return {
        id: block.id,
        type: "section",
        title: block.title,
        children: block.children.map(serializePageBlock),
        ...block.extra,
      };
    case "image":
      return {id: block.id, type: "image", fileId: block.fileId, ...block.extra};
    case "note":
      return {id: block.id, type: "note", note: block.noteId, detailed: block.detailed, ...block.extra};
    case "unknown":
      return {...block.raw};
  }
}

/** Degraded author when the pack omits the user (documented, never
 * thrown — the page still renders; the handle reads empty). */
function degradedAuthor(userId: string): Account {
  return adaptAccount({
    id: userId,
    name: null,
    username: "",
    host: null,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: "unknown",
  } as UserLite);
}

/** Packed page → domain. Never throws: odd fields coerce, `isLiked`
 * absent stays `undefined` (authed-only pack), unknown blocks survive. */
export function adaptPage(raw: WirePage, origin: string | null): PageModel {
  const row = asRecord(raw);
  const id = asStringOrEmpty(row.id);
  const userId = asStringOrEmpty(row.userId);
  const user = row.user;
  const author =
    typeof user === "object" && user !== null
      ? adaptAccount(user as UserLite)
      : degradedAuthor(userId);
  const username = author.username;
  const font: PageFont = row.font === "serif" ? "serif" : "sans-serif";
  const eyeCatchingImage =
    typeof row.eyeCatchingImage === "object" && row.eyeCatchingImage !== null
      ? adaptDriveFile(row.eyeCatchingImage as DriveFile)
      : null;
  const attached: unknown[] = Array.isArray(row.attachedFiles) ? row.attachedFiles : [];
  const content: unknown[] = Array.isArray(row.content) ? row.content : [];
  const likedCount = typeof row.likedCount === "number" && Number.isFinite(row.likedCount) ? row.likedCount : 0;
  const script = asString(row.script);
  return {
    id,
    createdAt: asStringOrEmpty(row.createdAt),
    updatedAt: asStringOrEmpty(row.updatedAt),
    author,
    title: asStringOrEmpty(row.title),
    name: asStringOrEmpty(row.name),
    summary: asString(row.summary),
    font,
    alignCenter: row.alignCenter === true,
    hideTitleWhenPinned: row.hideTitleWhenPinned === true,
    eyeCatchingImageId: asString(row.eyeCatchingImageId),
    eyeCatchingImage,
    attachedFiles: attached
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .map(f => adaptDriveFile(f as unknown as DriveFile)),
    blocks: content.map(adaptPageBlock),
    likedCount,
    isLiked: typeof row.isLiked === "boolean" ? row.isLiked : undefined,
    hasLegacyScript: script !== null && script.trim() !== "",
    url:
      origin != null && username !== ""
        ? `${origin}/@${username}/pages/${asStringOrEmpty(row.name)}`
        : `/@${username}/pages/${asStringOrEmpty(row.name)}`,
  };
}

/** Wire error match: string code first, documented UUID prefix second
 * (forks may surface either; plan §2). */
interface PageErrorMap {
  codes: string[];
  code: string;
  message: string;
}

const PAGE_ERROR_MAP: PageErrorMap[] = [
  {codes: ["NO_SUCH_PAGE", "222120c0", "66aefd3c"], code: "errors.pages.notFound", message: "Page not found or not visible."},
  {codes: ["NAME_ALREADY_EXISTS", "4650348e", "2298a392"], code: "errors.pages.nameTaken", message: "A page with this URL already exists."},
  {codes: ["NO_SUCH_FILE", "b7b9748e"], code: "errors.pages.fileMissing", message: "The selected file could not be found on the server."},
  {codes: ["YOUR_PAGE"], code: "errors.pages.ownPage", message: "You cannot like your own page."},
  {codes: ["ALREADY_LIKED"], code: "errors.pages.alreadyLiked", message: "You already liked this page."},
  {codes: ["NOT_LIKED"], code: "errors.pages.notLiked", message: "You have not liked this page."},
  {codes: ["ACCESS_DENIED", "d0017699"], code: "errors.pages.accessDenied", message: "You do not have permission to do that."},
];

/** Rethrow a page-endpoint failure as a typed `errors.pages.*` error,
 * matching the wire string code first, the documented UUID prefix
 * second. Anything else (rate limits, network, unknown codes) rethrows
 * untouched — never swallowed, never reworded. */
export function mapPageError(err: unknown): never {
  if (err instanceof ApiError) {
    const code = typeof err.code === "string" ? err.code : "";
    for (const entry of PAGE_ERROR_MAP) {
      if (entry.codes.some(c => code === c || (code.length > c.length && code.startsWith(c)))) {
        throw new ApiError(entry.message, err.status, entry.code, err.kind, {status: err.status});
      }
    }
  }
  throw err;
}

async function callPage<T>(call: WireCall, endpoint: string, params: Record<string, unknown>): Promise<T> {
  try {
    return await call<T>(endpoint, params);
  } catch (err) {
    mapPageError(err);
  }
}

function pageParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** `pages/show` by id, or by local username + name. */
export async function showPage(
  call: WireCall,
  origin: string | null,
  ref: {id: string} | {username: string; name: string},
): Promise<PageModel> {
  const params = "id" in ref ? {pageId: ref.id} : {username: ref.username, name: ref.name};
  return adaptPage(await callPage<WirePage>(call, "pages/show", params), origin);
}

/** `pages/create` (PG-4: `script: ''` + `variables: []` always sent). */
export async function createPage(
  call: WireCall,
  origin: string | null,
  draft: PageDraft,
): Promise<PageModel> {
  const params = pageParams({
    title: draft.title,
    name: draft.name,
    content: draft.content.map(serializePageBlock),
    variables: draft.variables,
    script: "",
    summary: draft.summary,
    eyeCatchingImageId: draft.eyeCatchingImageId,
    font: draft.font,
    alignCenter: draft.alignCenter,
    hideTitleWhenPinned: draft.hideTitleWhenPinned,
  });
  return adaptPage(await callPage<WirePage>(call, "pages/create", params), origin);
}

/** `pages/update` with a partial patch — only present keys are sent, and
 * `script`/`variables` are never sent (PG-4). `summary`/`eyeCatchingImageId`
 * accept `null` to clear; `undefined` leaves the field untouched. */
export async function updatePage(call: WireCall, pageId: string, patch: PagePatch): Promise<void> {
  const params = pageParams({
    pageId,
    title: patch.title,
    name: patch.name,
    content: patch.content?.map(serializePageBlock),
    summary: patch.summary,
    eyeCatchingImageId: patch.eyeCatchingImageId,
    font: patch.font,
    alignCenter: patch.alignCenter,
    hideTitleWhenPinned: patch.hideTitleWhenPinned,
  });
  await callPage<undefined>(call, "pages/update", params);
}

/** `pages/delete` (owner or moderator). */
export async function deletePage(call: WireCall, pageId: string): Promise<void> {
  await callPage<undefined>(call, "pages/delete", {pageId});
}

/** `pages/like` / `pages/unlike` (never the viewer's own — the server
 * refuses with `YOUR_PAGE`). */
export async function likePage(call: WireCall, pageId: string): Promise<void> {
  await callPage<undefined>(call, "pages/like", {pageId});
}

/** `pages/unlike`. */
export async function unlikePage(call: WireCall, pageId: string): Promise<void> {
  await callPage<undefined>(call, "pages/unlike", {pageId});
}

/** `pages/featured` (single fetch, ≤10). */
export async function featuredPages(call: WireCall, origin: string | null): Promise<PageModel[]> {
  const items = await callPage<WirePage[]>(call, "pages/featured", {});
  return (Array.isArray(items) ? items : []).map(p => adaptPage(p, origin));
}

/** `users/pages` (public, paged). */
export async function pagesByUser(
  call: WireCall,
  origin: string | null,
  userId: string,
  opts?: PageOpts,
): Promise<Page<PageModel>> {
  const limit = opts?.limit ?? 20;
  const items = await callPage<WirePage[]>(call, "users/pages", {
    userId,
    limit,
    ...decodeCursor(opts?.cursor ?? null),
  });
  return pageOf(items ?? [], limit, p => adaptPage(p, origin));
}

/** `i/pages` (own, paged). Absent on Pinetree (404s). */
export async function myPages(
  call: WireCall,
  origin: string | null,
  opts?: PageOpts,
): Promise<Page<PageModel>> {
  const limit = opts?.limit ?? 20;
  const items = await callPage<WirePage[]>(call, "i/pages", {
    limit,
    ...decodeCursor(opts?.cursor ?? null),
  });
  return pageOf(items ?? [], limit, p => adaptPage(p, origin));
}

interface WirePageLike {
  id?: unknown;
  page?: unknown;
}

/** `i/page-likes` (own likes, paged `{id, page}` rows). Absent on Pinetree. */
export async function likedPages(
  call: WireCall,
  origin: string | null,
  opts?: PageOpts,
): Promise<Page<{id: string; page: PageModel}>> {
  const limit = opts?.limit ?? 20;
  const items = await callPage<WirePageLike[]>(call, "i/page-likes", {
    limit,
    ...decodeCursor(opts?.cursor ?? null),
  });
  return pageOf(Array.isArray(items) ? items : [], limit, row => ({
    id: asStringOrEmpty((row as Record<string, unknown>).id),
    page: adaptPage(((row as Record<string, unknown>).page ?? {}) as WirePage, origin),
  }));
}

/** Pin/unpin via `i/update {pinnedPageId}` (`null` clears). */
export async function pinPage(call: WireCall, pageId: string | null): Promise<void> {
  await callPage<unknown>(call, "i/update", {pinnedPageId: pageId});
}
