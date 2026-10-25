// Account data import/export (clickstone §2.3): Misskey-family
// Drive-upload-then-import plus enqueue-only exports (`TransferApi`).
//
// Split from `core/backend.ts` (repair D3.2) — behavior-preserving move.
// `backend.ts` re-exports everything here so no importer changes.
//
// Pure TS: no framework imports, no globals (enforced by `no-ui-in-fedi`).

// --- Import / export (clickstone §2.3) ---------------------------------------

/** Import families the Misskey-family `i/import-*` endpoints serve. `mute`
 * maps to upstream `i/import-muting` (there is no `i/import-mute`);
 * `notes` is a Sharkey/fork endpoint — stock Misskey 404s and the
 * transport surfaces that as the honest unsupported error. */
export type TransferImportKind = "following" | "blocking" | "mute" | "notes";

/** Export families the Misskey-family `i/export-*` endpoints enqueue. */
export type TransferExportKind =
  | "following"
  | "blocking"
  | "mute"
  | "notes"
  | "user-lists"
  | "antennas"
  | "clips"
  | "favorites";

/** Concrete import steps (no byte percentage: fetch has no upload
 * progress in React Native, and a fake percentage would be dishonest). */
export type TransferPhase = "uploading" | "submitting" | "done";

export interface TransferImportResult {
  ok: true;
  endpoint: string;
  /** Drive file id the import job now references. */
  fileId: string;
  /** English fallback; the UI localizes around the phase, not this text. */
  message: string;
}

export interface TransferExportQueued {
  /** The POST only queued a job; there is no payload yet. */
  status: "queued";
  endpoint: string;
  /** Where the finished file arrives. */
  delivery: "notification";
  notificationType: "exportCompleted";
  rateLimit: { max: number; window: "minute" | "hour" | "day" };
  message: string;
}

export interface TransferExportPayload {
  /** A fork answered with a body — never a queued notes shape by guess. */
  status: "payload";
  endpoint: string;
  payload: unknown;
}

export type TransferExportResult = TransferExportQueued | TransferExportPayload;

/** Misskey-family `exportCompleted` `exportedEntity` token per export
 * kind (verified against the local Misskey + Sharkey checkouts'
 * `Export*ProcessorService` files — display matching only, never routed
 * on). */
export const TRANSFER_EXPORT_ENTITY: Record<TransferExportKind, string> = {
  following: "following",
  blocking: "blocking",
  mute: "muting",
  notes: "note",
  "user-lists": "userList",
  antennas: "antenna",
  clips: "clip",
  favorites: "favorite",
};

/** Human-readable rate window for an enqueued export. */
export function transferExportRateLimitText(rateLimit: {
  max: number;
  window: "minute" | "hour" | "day";
}): string {
  const { max, window } = rateLimit;
  if (max !== 1) return `up to ${max} per ${window}`;
  return window === "minute" ? "once a minute" : window === "hour" ? "once an hour" : "once a day";
}

/**
 * Account data portability (clickstone §2.3). Optional like every
 * capability-gated member: the Misskey family provides it
 * (Drive-upload-then-`{fileId}` imports, enqueue-only exports whose file
 * arrives as an `exportCompleted` notification); the Mastodon family has
 * no MastoAPI import/export (server-side CSV through the instance UI —
 * verified absent in the local Mastodon checkout) and leaves this
 * member undefined, so the UI disables those rows with a reason.
 */
export interface TransferApi {
  /**
   * Upload `file` to Drive, then ask the server to import it by id.
   * Throws before any network I/O when the size guard fails; upload/API
   * failures propagate (the transport's `FediError`/`ApiError` codes) so
   * the UI can distinguish "file too large", a 403 permission error, and
   * a 404 unsupported endpoint.
   */
  importFile(
    kind: TransferImportKind,
    file: File,
    opts?: { onPhase?: (phase: TransferPhase) => void },
  ): Promise<TransferImportResult>;
  /**
   * Enqueue an export job. Resolves as soon as the server answers — no
   * payload wait, no polling. The completed file is delivered as an
   * `exportCompleted` notification; a 429 from the endpoint propagates.
   */
  exportList(kind: TransferExportKind): Promise<TransferExportResult>;
}
