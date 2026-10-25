// Misskey-family Drive (`drive/files/*`, `drive/folders/*`) — moved out
// of `backend.ts` (D3.1) with no behavior change.
//
// Contract notes (kept from the backend block):
// - listing sends no `folderId` for the Drive root: upstream defaults to
//   null, and omitted params can never trip Sharkey's unknown-field 400s.
// - caption edit is `drive/files/update` `comment`; `focus` has no
//   Misskey-family field and is dropped by the caller, never sent.

import type { DriveApi } from "../core/backend";
import type { Page, Post } from "../core/models";
import { adaptDriveFile, adaptDriveFolder, decodeCursor, pageOf } from "./adapt";
import type { WireCall } from "./client";
import type { DriveFile, DriveFolder as WireDriveFolder } from "./wire";

export function createDriveApi(
  call: WireCall,
  callNotes: (endpoint: string, params: Record<string, unknown>) => Promise<Page<Post>>,
): DriveApi {
  const DEFAULT_LIMIT = 20;
  return {
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
}
