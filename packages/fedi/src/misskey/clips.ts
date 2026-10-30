// Clips (Misskey-family): a user's named note collections. The note menu's
// Clip row lists the viewer's clips and adds the note to one
// (`clips/list`, `clips/add-note`). Scoped tokens need read:account to
// list and write:account to create/update/delete/add/remove — Keystone
// requests `read:clips`/`write:clips`, which no upstream clip endpoint
// declares. Harmless (B4): the endpoints use the account scopes already
// requested, so no scope change ships in this plan.

import { FediError } from "../core/errors";
import type { WireCall } from "./client";
import type { ClipSummary, PageOpts } from "../core/backend";
import type { Account, Page, Post } from "../core/models";
import { adaptAccount, adaptNote, decodeCursor, pageOf } from "./adapt";
import { isUnsupportedError } from "./client";
import type { Note, UserLite } from "./wire";
import { ApiError } from "../core/errors";

export type { ClipSummary };

export interface PackedClip {
  id?: unknown;
  name?: unknown;
  isPublic?: unknown;
  description?: unknown;
  notesCount?: unknown;
  lastClippedAt?: unknown;
  createdAt?: unknown;
  user?: unknown;
  userId?: unknown;
}

const CLIP_ERROR_MAP: Array<{ codes: string[]; code: string; message: string }> = [
  {codes: ["ALREADY_CLIPPED"], code: "errors.clips.alreadyClipped", message: "That post is already in the clip."},
  {codes: ["TOO_MANY_CLIP_NOTES"], code: "errors.clips.tooManyNotes", message: "That clip is full."},
  {codes: ["NO_SUCH_CLIP"], code: "errors.clips.noSuchClip", message: "That clip no longer exists."},
];

/** Rethrow a clip-endpoint failure as a typed `errors.clips.*` error.
 * Anything else rethrows untouched. */
export function mapClipError(err: unknown): never {
  if (err instanceof ApiError && typeof err.code === "string") {
    for (const row of CLIP_ERROR_MAP) {
      if (row.codes.includes(err.code)) {
        throw new FediError(row.message, row.code);
      }
    }
  }
  throw err;
}

function adaptOwner(user: unknown, userId: unknown): Account | null {
  if (typeof user === "object" && user !== null) {
    try {
      return adaptAccount(user as UserLite);
    } catch {
      return null;
    }
  }
  void userId;
  return null;
}

export function adaptClipSummary(raw: PackedClip): ClipSummary {
  const out: ClipSummary = {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
  };
  if (typeof raw.isPublic === "boolean") out.isPublic = raw.isPublic;
  if (typeof raw.description === "string" || raw.description === null) {
    out.description = raw.description;
  }
  if (typeof raw.notesCount === "number") out.notesCount = raw.notesCount;
  if (typeof raw.lastClippedAt === "string" || raw.lastClippedAt === null) {
    out.lastClippedAt = raw.lastClippedAt;
  }
  if (typeof raw.createdAt === "string") out.createdAt = raw.createdAt;
  const owner = adaptOwner(raw.user, raw.userId);
  if (owner) {
    out.owner = owner;
  }
  return out;
}

const DEFAULT_LIMIT = 20;

export async function listClips(
  call: WireCall,
  opts: PageOpts = {},
): Promise<Page<ClipSummary>> {
  const params: Record<string, unknown> = {limit: opts.limit ?? DEFAULT_LIMIT};
  Object.assign(params, decodeCursor(opts.cursor ?? null));
  const items = await call<PackedClip[]>("clips/list", params);
  return pageOf(items ?? [], (params.limit as number) ?? DEFAULT_LIMIT, adaptClipSummary);
}

/** One clip (`clips/show`); null on 404 (the screen renders not-found). */
export async function showClip(call: WireCall, clipId: string): Promise<ClipSummary | null> {
  try {
    const raw = await call<PackedClip>("clips/show", {clipId});
    if (!raw || typeof raw !== "object") return null;
    return adaptClipSummary(raw);
  } catch (err) {
    if (isUnsupportedError(err)) return null;
    throw err;
  }
}

export async function addNoteToClip(
  call: WireCall,
  clipId: string,
  noteId: string,
): Promise<void> {
  try {
    await call<undefined>("clips/add-note", {clipId, noteId});
  } catch (err) {
    mapClipError(err);
  }
}

export async function removeNoteFromClip(
  call: WireCall,
  clipId: string,
  noteId: string,
): Promise<void> {
  try {
    await call<undefined>("clips/remove-note", {clipId, noteId});
  } catch (err) {
    mapClipError(err);
  }
}

export async function createClip(
  call: WireCall,
  name: string,
  opts: { isPublic?: boolean; description?: string | null } = {},
): Promise<ClipSummary> {
  const created = await call<PackedClip>("clips/create", {
    name,
    ...(opts.isPublic !== undefined ? {isPublic: opts.isPublic} : {}),
    ...(opts.description !== undefined ? {description: opts.description} : {}),
  });
  return adaptClipSummary(created ?? {});
}

/**
 * Full-body update (DC-6/B1): always sends `name`, `isPublic` and
 * `description` — the server applies `description || null`, so omitting
 * it would wipe an existing description.
 */
export async function updateClip(
  call: WireCall,
  clipId: string,
  patch: { name: string; isPublic: boolean; description: string | null },
): Promise<ClipSummary> {
  const updated = await call<PackedClip>("clips/update", {
    clipId,
    name: patch.name,
    isPublic: patch.isPublic,
    description: patch.description,
  });
  return adaptClipSummary(updated ?? {});
}

export async function deleteClip(call: WireCall, clipId: string): Promise<void> {
  await call<undefined>("clips/delete", {clipId});
}

export async function listClipsContaining(
  call: WireCall,
  noteId: string,
): Promise<ClipSummary[]> {
  const items = await call<PackedClip[]>("notes/clips", {noteId});
  return (items ?? []).map(adaptClipSummary);
}

export async function adaptClipNotes(
  call: WireCall,
  clipId: string,
  opts: PageOpts & { search?: string } = {},
): Promise<Page<Post>> {
  const params: Record<string, unknown> = {
    clipId,
    limit: opts.limit ?? DEFAULT_LIMIT,
    ...decodeCursor(opts.cursor ?? null),
  };
  if (opts.search !== undefined) params.search = opts.search;
  const items = await call<Note[]>("clips/notes", params);
  return pageOf(items ?? [], (params.limit as number) ?? DEFAULT_LIMIT, adaptNote);
}
