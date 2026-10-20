// Clips (Misskey-family): a user's named note collections. The note menu's
// Clip row lists the viewer's clips and adds the note to one
// (`clips/list`, `clips/add-note`). Scoped tokens need read:clips to list
// and write:clips to create/update/delete/add/remove.
//
// Unverified against a live server (2026-10-17): wired for the owner's
// live-server test. Pinetree is not wired here.

import type { WireCall } from "./client";
import type { ClipSummary } from "../core/backend";

export type { ClipSummary };

interface PackedClip {
  id?: unknown;
  name?: unknown;
  isPublic?: unknown;
  description?: unknown;
  notesCount?: unknown;
}

function adaptClipSummary(raw: PackedClip): ClipSummary {
  const out: ClipSummary = {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
  };
  if (typeof raw.isPublic === "boolean") out.isPublic = raw.isPublic;
  if (typeof raw.description === "string" || raw.description === null) {
    out.description = raw.description;
  }
  if (typeof raw.notesCount === "number") out.notesCount = raw.notesCount;
  return out;
}

export async function listClips(call: WireCall): Promise<ClipSummary[]> {
  const items = await call<PackedClip[]>("clips/list", { limit: 100 });
  return (items ?? []).map(adaptClipSummary);
}

export async function addNoteToClip(
  call: WireCall,
  clipId: string,
  noteId: string,
): Promise<void> {
  await call<undefined>("clips/add-note", { clipId, noteId });
}

export async function removeNoteFromClip(
  call: WireCall,
  clipId: string,
  noteId: string,
): Promise<void> {
  await call<undefined>("clips/remove-note", { clipId, noteId });
}

export async function createClip(
  call: WireCall,
  name: string,
  opts: { isPublic?: boolean; description?: string | null } = {},
): Promise<ClipSummary> {
  const created = await call<PackedClip>("clips/create", {
    name,
    ...(opts.isPublic !== undefined ? { isPublic: opts.isPublic } : {}),
    ...(opts.description !== undefined ? { description: opts.description } : {}),
  });
  return adaptClipSummary(created ?? {});
}

export async function updateClip(
  call: WireCall,
  clipId: string,
  patch: { name?: string; isPublic?: boolean; description?: string | null },
): Promise<ClipSummary> {
  const updated = await call<PackedClip>("clips/update", { clipId, ...patch });
  return adaptClipSummary(updated ?? {});
}

export async function deleteClip(call: WireCall, clipId: string): Promise<void> {
  await call<undefined>("clips/delete", { clipId });
}

export async function listClipsContaining(
  call: WireCall,
  noteId: string,
): Promise<ClipSummary[]> {
  const items = await call<PackedClip[]>("notes/clips", { noteId });
  return (items ?? []).map(adaptClipSummary);
}
