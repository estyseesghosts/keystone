// Unsent-post drafts for the floating + inline composers. Drafts live in
// the injected `KeyValueStore` (per-session keys), capped so the list can't
// grow without bound. The payload covers the FULL composer state
// (attachments, poll, recipients, reply/renote context, scheduling,
// reaction acceptance, quote refusal) — restoring a draft restores the
// whole form, not just text. Anything with text, a warning, attachments,
// a poll, or scheduling counts as worth keeping; bare settings don't.

import type { KeyValueStore } from "../core/sessions";
import type { ReactionAcceptance } from "../core/backend";

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
  /** Wire visibility value verbatim (`public`/`home`/`followers`/
   * `specified`) — composed values round-trip unchanged. */
  visibility: string;
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

// Session-scoped (plan Phase 2 slice (d)): drafts belong to the account
// being composed as, not to a backend build. Storage rides the injected
// `KeyValueStore` (pure-TS rule: no `localStorage`); the app passes MMKV
// (slice 2.5), tests pass `createMemoryStore()`. The legacy per-backend
// list is carried over once via `carryLegacyDrafts` (best-effort, so no
// draft is silently lost) — the app calls it at boot with its known
// legacy key, mirroring the 2.1 `removeLegacyKeys` pattern.
export const DRAFTS_KEY_PREFIX = "keystone_drafts_";

export function draftsKeyFor(sessionId: string): string {
  return `${DRAFTS_KEY_PREFIX}${sessionId}`;
}

export function carryLegacyDrafts(
  store: KeyValueStore,
  sessionId: string,
  legacyKey: string,
): void {
  try {
    const target = draftsKeyFor(sessionId);
    if (store.getItem(target) !== null) return;
    const legacy = store.getItem(legacyKey);
    if (legacy === null) return;
    store.setItem(target, legacy);
    store.removeItem(legacyKey);
  } catch {
    // Storage unavailable: drafts last for this process only.
  }
}

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

function readAll(store: KeyValueStore, sessionId: string): Draft[] {
  try {
    const raw = store.getItem(draftsKeyFor(sessionId));
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

function writeAll(store: KeyValueStore, sessionId: string, drafts: Draft[]): void {
  try {
    store.setItem(draftsKeyFor(sessionId), JSON.stringify(pruneDrafts(drafts)));
  } catch {
    // Storage unavailable: drafts last for this process only.
  }
}

export function listDrafts(store: KeyValueStore, sessionId: string): Draft[] {
  return pruneDrafts(readAll(store, sessionId));
}

export function saveDraft(
  store: KeyValueStore,
  sessionId: string,
  payload: DraftPayload,
): Draft | null {
  if (!isKeepable(payload)) return null;
  const draft: Draft = { ...payload, id: newId(), createdAt: Date.now() };
  const all = readAll(store, sessionId);
  all.push(draft);
  writeAll(store, sessionId, all);
  return draft;
}

export function deleteDraft(store: KeyValueStore, sessionId: string, id: string): void {
  writeAll(store, sessionId, readAll(store, sessionId).filter((d) => d.id !== id));
}
