// Scheduled notes (§6). Misskey-family `notes/schedule/*`: create takes the
// normal `notes/create` body plus `scheduledAt` (ISO string); list/delete
// page by id cursors. 404-gated: unsupported backends keep the composer
// scheduling control disabled with reason.

import type { WireCall } from "./client";
import type { ScheduledNote as WireScheduledNote } from "./wire";

/** Wire body + `scheduledAt` — the backend builds the body; this module
 * only forwards it. */
export type ScheduleCreateParams = Record<string, unknown> & { scheduledAt: string };

export async function createScheduledNote(
  call: WireCall,
  params: ScheduleCreateParams,
): Promise<WireScheduledNote> {
  return call<WireScheduledNote>("notes/schedule/create", { ...params });
}

export async function listScheduledNotes(
  call: WireCall,
  limit = 20,
  untilId?: string,
): Promise<WireScheduledNote[]> {
  return call<WireScheduledNote[]>("notes/schedule/list", {
    limit,
    ...(untilId ? { untilId } : {}),
  });
}

export async function deleteScheduledNote(
  call: WireCall,
  scheduleId: string,
): Promise<void> {
  await call<undefined>("notes/schedule/delete", { scheduleId });
}

/** Parse a `datetime-local` input value into an ISO string, or null when
 * empty/invalid. Pure. */
export function parseScheduledAt(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** True when the ISO instant lies in the future (backend MUST_BE_IN_FUTURE
 * mirrors this client-side). Pure. */
export function isFutureInstant(iso: string, now = Date.now()): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > now;
}
