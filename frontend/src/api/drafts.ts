// Unsent-post drafts for the floating composer. Drafts live in
// localStorage (per-backend keys, like tokens — a draft naming local
// users never leaks across backends), capped so the list can't grow
// without bound. Anything with text or a warning counts as worth
// keeping; bare settings don't.

import { BACKEND_ID } from "./backend";
import type { NoteVisibility } from "./types";

export interface DraftPayload {
  text: string;
  cw: string;
  visibility: NoteVisibility;
  localOnly: boolean;
}

export interface Draft extends DraftPayload {
  id: string;
  createdAt: number;
}

/** Maximum stored drafts per backend (oldest go first). */
export const MAX_DRAFTS = 20;

const keyFor = () => `keystone_drafts_${BACKEND_ID}`;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** True when the payload is worth keeping (prose or a warning — bare
 * settings alone never save). Pure. */
export function isKeepable(payload: DraftPayload): boolean {
  return payload.text.trim().length > 0 || payload.cw.trim().length > 0;
}

/** Newest-first, capped. Pure — the unit-checked core of the store. */
export function pruneDrafts(drafts: Draft[]): Draft[] {
  return [...drafts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_DRAFTS);
}

function readAll(): Draft[] {
  try {
    const raw = localStorage.getItem(keyFor());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is Draft =>
        typeof d === "object" &&
        d !== null &&
        typeof (d as Draft).id === "string" &&
        typeof (d as Draft).text === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(drafts: Draft[]): void {
  try {
    localStorage.setItem(keyFor(), JSON.stringify(pruneDrafts(drafts)));
  } catch {
    // Storage unavailable: drafts last for this session only.
  }
}

export function listDrafts(): Draft[] {
  return pruneDrafts(readAll());
}

export function saveDraft(payload: DraftPayload): Draft | null {
  if (!isKeepable(payload)) return null;
  const draft: Draft = { ...payload, id: newId(), createdAt: Date.now() };
  const all = readAll();
  all.push(draft);
  writeAll(all);
  return draft;
}

export function deleteDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}
