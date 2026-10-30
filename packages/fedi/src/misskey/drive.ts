// Misskey-family Drive (`drive/files/*`, `drive/folders/*`, `drive`).
//
// Contract notes:
// - listing sends no `folderId` for the Drive root: upstream defaults to
//   null, and omitted params can never trip Sharkey's unknown-field 400s.
// - caption edit is `drive/files/update` `comment`; `focus` has no
//   Misskey-family field and is dropped by the caller, never sent.
// - `sort` (`drive/files`) and `move-bulk` are newer upstream: probed
//   once per origin and cached (the `like.ts` pattern, DC-7). `sort` is
//   never sent once the verdict is `false` (Sharkey 400s unknown params);
//   `moveMany` falls back to per-file `updateFile` on a negative verdict.
// - folder listing sends `parentId` only when non-null (B2: nested
//   folders were unreachable).

import { ApiError } from "../core/errors";
import type { DriveApi, DriveSort } from "../core/backend";
import type { Page, Post } from "../core/models";
import type { DriveFolder as CoreDriveFolder } from "../core/backend";
import { adaptDriveFile, adaptDriveFolder, decodeCursor, pageOf } from "./adapt";
import { isUnsupportedError, type WireCall } from "./client";
import type { DriveFile, DriveFolder as WireDriveFolder } from "./wire";

const sortCache = new Map<string, boolean>();
const moveBulkCache = new Map<string, boolean>();

/** `drive/files` sort verdict by origin: true/false, or null unprobed. */
export function driveSortSupportFor(origin: string): boolean | null {
  return sortCache.has(origin) ? (sortCache.get(origin) as boolean) : null;
}

/** Test hook: drop the sort verdict cache. */
export function resetDriveSortSupportCache(): void {
  sortCache.clear();
}

/** `drive/files/move-bulk` verdict by origin: true/false, or null unprobed. */
export function driveMoveBulkSupportFor(origin: string): boolean | null {
  return moveBulkCache.has(origin) ? (moveBulkCache.get(origin) as boolean) : null;
}

/** Test hook: drop the move-bulk verdict cache. */
export function resetDriveMoveBulkSupportCache(): void {
  moveBulkCache.clear();
}

/** Test hook: seed a verdict. */
export function setDriveMoveBulkSupportFor(origin: string, supported: boolean): void {
  moveBulkCache.set(origin, supported);
}

function markSortVerdict(origin: string | null, supported: boolean): void {
  if (origin) sortCache.set(origin, supported);
}

function markMoveBulkVerdict(origin: string | null, supported: boolean): void {
  if (origin) moveBulkCache.set(origin, supported);
}

function isAbsentEndpoint(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (isUnsupportedError(err) || err.code === "UNKNOWN_API_ENDPOINT")
  );
}

/** Explicit sort probe: `drive/files {limit: 1, sort}` — a 400 param
 * rejection means the server has no `sort`; anything auth-shaped or a
 * success means the route exists. Never throws (null = inconclusive). */
export async function probeDriveSort(
  call: WireCall,
  origin: string | null,
): Promise<boolean | null> {
  try {
    await call<unknown[]>("drive/files", {limit: 1, sort: "-createdAt"});
  } catch (err) {
    if (isAbsentEndpoint(err)) {
      markSortVerdict(origin, false);
      return false;
    }
    if (err instanceof ApiError && err.status === 400) {
      markSortVerdict(origin, false);
      return false;
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 422)) {
      markSortVerdict(origin, true);
      return true;
    }
    return null;
  }
  markSortVerdict(origin, true);
  return true;
}

/** Explicit move-bulk probe: `move-bulk {fileIds: []}` — 404 means the
 * endpoint is absent; a validation error means it exists. Never throws. */
export async function probeDriveMoveBulk(
  call: WireCall,
  origin: string | null,
): Promise<boolean | null> {
  try {
    await call<unknown>("drive/files/move-bulk", {fileIds: []});
  } catch (err) {
    if (isAbsentEndpoint(err)) {
      markMoveBulkVerdict(origin, false);
      return false;
    }
    if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 422)) {
      markMoveBulkVerdict(origin, true);
      return true;
    }
    return null;
  }
  markMoveBulkVerdict(origin, true);
  return true;
}

const DEFAULT_LIMIT = 20;

/** Sort text the server accepts (kept next to the probe for the tests). */
export const DRIVE_SORTS: readonly DriveSort[] = [
  "+createdAt",
  "-createdAt",
  "+name",
  "-name",
  "+size",
  "-size",
];

interface DriveUsageWire {
  capacity?: unknown;
  usage?: unknown;
}

function asBytes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createDriveApi(
  call: WireCall,
  callNotes: (endpoint: string, params: Record<string, unknown>) => Promise<Page<Post>>,
  origin: string | null,
): DriveApi {
  async function filesWithSort(
    params: Record<string, unknown>,
    sort: DriveSort | undefined,
  ): Promise<DriveFile[]> {
    if (sort === undefined || (origin && driveSortSupportFor(origin) === false)) {
      const {sort: _dropped, ...rest} = params;
      void _dropped;
      return (await call<DriveFile[]>("drive/files", rest)) ?? [];
    }
    try {
      const items = (await call<DriveFile[]>("drive/files", params)) ?? [];
      // Implicit probe: the server accepted `sort`.
      if (sort !== undefined && origin) markSortVerdict(origin, true);
      return items;
    } catch (err) {
      // Implicit probe: a param rejection means no `sort` here — cache
      // it and retry once without the field, so the first sorted
      // listing still renders on older servers.
      const paramRejection =
        err instanceof ApiError && (err.status === 400 || isAbsentEndpoint(err));
      if (paramRejection && origin && driveSortSupportFor(origin) !== false) {
        markSortVerdict(origin, false);
        const {sort: _dropped, ...rest} = params;
        void _dropped;
        return (await call<DriveFile[]>("drive/files", rest)) ?? [];
      }
      throw err;
    }
  }

  return {
    async files(opts = {}) {
      const params: Record<string, unknown> = {
        limit: opts.limit ?? DEFAULT_LIMIT,
      };
      if (opts.type) params.type = opts.type;
      // Omitted means the Drive root upstream; an explicit null is the same
      // root and is never sent (Sharkey rejects empty/default fields).
      if (opts.folderId != null) params.folderId = opts.folderId;
      if (opts.sort !== undefined) params.sort = opts.sort;
      Object.assign(params, decodeCursor(opts.cursor ?? null));
      const items = await filesWithSort(params, opts.sort);
      return pageOf(items, (params.limit as number) ?? DEFAULT_LIMIT, adaptDriveFile);
    },
    async usage() {
      const res = await call<DriveUsageWire>("drive", {});
      return {
        capacity: asBytes(res?.capacity),
        usage: asBytes(res?.usage),
      };
    },
    async showFile(id) {
      return adaptDriveFile(await call<DriveFile>("drive/files/show", {fileId: id}));
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
      const params: Record<string, unknown> = {fileId: id};
      if (patch.name !== undefined) params.name = patch.name;
      if (patch.isSensitive !== undefined) params.isSensitive = patch.isSensitive;
      if (patch.comment !== undefined) params.comment = patch.comment;
      if (patch.folderId !== undefined) params.folderId = patch.folderId;
      return adaptDriveFile(await call<DriveFile>("drive/files/update", params));
    },
    async deleteFile(id) {
      await call<undefined>("drive/files/delete", {fileId: id});
    },
    async moveMany(fileIds, folderId) {
      const verdict = origin ? driveMoveBulkSupportFor(origin) : null;
      if (verdict !== false) {
        try {
          await call<undefined>("drive/files/move-bulk", {
            fileIds,
            ...(folderId != null ? {folderId} : {}),
          });
          if (origin) markMoveBulkVerdict(origin, true);
          return;
        } catch (err) {
          if (isAbsentEndpoint(err)) {
            if (origin) markMoveBulkVerdict(origin, false);
          } else {
            throw err;
          }
        }
      }
      // Fallback: per-file `updateFile` (older servers / Sharkey without
      // the endpoint). One failure rejects the whole move — the UI pools
      // and reports per item instead (DC-8).
      for (const fileId of fileIds) {
        await call<DriveFile>("drive/files/update", {
          fileId,
          ...(folderId != null ? {folderId} : {}),
        });
      }
    },
    isSortSupported() {
      return origin ? driveSortSupportFor(origin) : null;
    },
    isMoveBulkSupported() {
      return origin ? driveMoveBulkSupportFor(origin) : null;
    },
    // Drive folders (`drive/folders/*`, Misskey/Sharkey-family only —
    // verified absent on Pinetree, which keeps `drive: unsupported`).
    folders: {
      async list(opts) {
        const params: Record<string, unknown> = {
          limit: opts.limit ?? DEFAULT_LIMIT,
        };
        if (opts.parentId != null) params.folderId = opts.parentId;
        Object.assign(params, decodeCursor(opts.cursor ?? null));
        const items = await call<WireDriveFolder[]>("drive/folders", params);
        return pageOf(items ?? [], (params.limit as number) ?? DEFAULT_LIMIT, adaptDriveFolder);
      },
      async show(id) {
        const folder = adaptDriveFolder(await call<WireDriveFolder>("drive/folders/show", {folderId: id}));
        // Breadcrumb path: walk parents (bounded — a corrupt cycle ends
        // at the repeat). Tolerates missing parents (walk stops, honest
        // partial path instead of a failure).
        const path: CoreDriveFolder[] = [folder];
        const seen = new Set<string>([folder.id]);
        let parentId = folder.parentId;
        for (let depth = 0; depth < 20 && parentId != null; depth++) {
          if (seen.has(parentId)) break;
          seen.add(parentId);
          try {
            const parent = adaptDriveFolder(
              await call<WireDriveFolder>("drive/folders/show", {folderId: parentId}),
            );
            path.unshift(parent);
            parentId = parent.parentId;
          } catch {
            break;
          }
        }
        return {folder, path, filesCount: null, foldersCount: null};
      },
      async create(name, opts = {}) {
        return adaptDriveFolder(
          await call<WireDriveFolder>("drive/folders/create", {
            name,
            ...(opts.parentId != null ? {parentId: opts.parentId} : {}),
          }),
        );
      },
      async update(id, patch) {
        const params: Record<string, unknown> = {folderId: id};
        if (patch.name !== undefined) params.name = patch.name;
        if (patch.parentId !== undefined) params.parentId = patch.parentId;
        return adaptDriveFolder(await call<WireDriveFolder>("drive/folders/update", params));
      },
      async delete(id) {
        await call<undefined>("drive/folders/delete", {folderId: id});
      },
    },
  };
}
