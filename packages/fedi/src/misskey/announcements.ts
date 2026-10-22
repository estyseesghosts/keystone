// Announcements (Misskey family, clickstone §1.12): the instance's notices.
//
// Endpoints (verified against the local Misskey backend checkout,
// `packages/backend/src/server/api/endpoints/`, 2026-10-22):
//   announcements            limit/sinceId/untilId/isActive (public, paged)
//   announcements/show       announcementId                 (public, one row)
//   i/read-announcement      announcementId                 (auth, write:account)
//
// There is no `announcements/dismiss` in this Misskey version (nor in
// Sharkey/Catodon, which share the endpoint list): the reference client's
// announcements page and dialog both call `i/read-announcement`. The
// `AnnouncementsApi.dismiss` name is kept as the domain verb ("mark this
// notice read"); the wire call is the verified endpoint.
//
// The packed row (`AnnouncementEntityService.pack`) carries `title`, MFM
// `text`, `imageUrl`, `icon`, `display`, `needConfirmationToRead`,
// `silence`, `forYou` and — only for an authenticated caller — `isRead`.
// Fields the screen cannot honestly render are dropped; `isRead` stays
// `null` when absent (never fabricated as `false`).

import type { Announcement, AnnouncementIcon } from "../core/backend";
import type { Content } from "../core/models";
import type { WireCall } from "./client";

/** Packed `Announcement` as the API answers it. */
export interface PackedAnnouncement {
  id?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  title?: unknown;
  text?: unknown;
  imageUrl?: unknown;
  icon?: unknown;
  needConfirmationToRead?: unknown;
  isRead?: unknown;
}

const ICONS: readonly AnnouncementIcon[] = ["info", "warning", "error", "success"];

/** MFM body → core `Content`. Misskey announcement text IS MFM (the
 * reference client renders it with the MFM component), so the screen
 * parses it through the one allow-listed AST. */
function announcementContent(text: unknown): Content {
  const mfm = typeof text === "string" ? text : "";
  return {
    mfm: mfm.length > 0 ? mfm : undefined,
    plain: mfm,
  };
}

/** Adapt one packed announcement. Unknown severity strings become `null`
 * (never a guessed label); `isRead` stays `null` when the server did not
 * report it (signed out). */
export function adaptAnnouncement(raw: PackedAnnouncement): Announcement {
  const icon = ICONS.includes(raw.icon as AnnouncementIcon)
    ? (raw.icon as AnnouncementIcon)
    : null;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.title === "string" && raw.title.length > 0 ? raw.title : null,
    content: announcementContent(raw.text),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.length > 0 ? raw.imageUrl : null,
    icon,
    needConfirmationToRead: raw.needConfirmationToRead === true,
    startsAt: null,
    endsAt: null,
    allDay: false,
    isRead: typeof raw.isRead === "boolean" ? raw.isRead : null,
  };
}

export async function listAnnouncements(
  call: WireCall,
  params: Record<string, unknown>,
): Promise<Announcement[]> {
  const rows = await call<PackedAnnouncement[]>("announcements", params);
  return (rows ?? []).map(adaptAnnouncement);
}

/** `i/read-announcement` — marks the notice read for this account. */
export async function readAnnouncement(
  call: WireCall,
  announcementId: string,
): Promise<void> {
  await call<undefined>("i/read-announcement", { announcementId });
}
