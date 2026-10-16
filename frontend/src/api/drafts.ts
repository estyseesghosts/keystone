// Unsent-post drafts for the floating + inline composers. Drafts live in
// localStorage (per-backend keys, like tokens), capped so the list can't
// grow without bound. The payload covers the FULL composer state
// (attachments, poll, recipients, reply/renote context, scheduling,
// reaction acceptance, quote refusal) — restoring a draft restores the
// whole form, not just text. Anything with text, a warning, attachments,
// a poll, or scheduling counts as worth keeping; bare settings don't.

import { BACKEND_ID } from "./backend";
import type { NoteVisibility, ReactionAcceptance } from "./types";

export interface DraftPoll {
  choices: string[];
  multiple: boolean;
  expiry: number | null;
}

export interface DraftRecipient {
  id: string;
  username: string;
  host: string | null;
}

export interface DraftAttachment {
  id: string;
  name: string;
}

export interface DraftPayload {
  text: string;
  cw: string;
  visibility: NoteVisibility;
  localOnly: boolean;
  recipientIds?: string[];
  recipients?: DraftRecipient[];
  fileIds?: string[];
  attachedFiles?: DraftAttachment[];
  poll?: DraftPoll | null;
  replyId?: string;
  renoteId?: string;
  scheduledAt?: string | null;
  reactionAcceptance?: ReactionAcceptance | null;
  noQuote?: boolean;
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

/** True when the payload is worth keeping (prose, a warning, attachments,
 * a usable poll, or a schedule — bare settings alone never save). Pure. */
export function isKeepable(payload: DraftPayload): boolean {
  if (payload.text.trim().length > 0 || payload.cw.trim().length > 0) return true;
  if ((payload.fileIds ?? []).length > 0 || (payload.attachedFiles ?? []).length > 0) return true;
  if ((payload.scheduledAt ?? "") !== "") return true;
  const poll = payload.poll;
  if (poll && poll.choices.map((c) => c.trim()).filter((c) => c.length > 0).length >= 2) return true;
  return false;
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
