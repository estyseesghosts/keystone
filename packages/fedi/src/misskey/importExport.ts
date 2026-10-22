// Import / export (§14) — upstream shapes, not the v1 wire guesses.
//
// IMPORT. Misskey's `i/import-*` endpoints take `{ fileId }` naming a file
// already in the viewer's Drive (`i/import-following.ts` paramDef:
// `required: ['fileId']`). They do NOT take the file body. Sending
// `{ file: rawText }` fails param validation before the job is queued, so
// the import flow here is two steps: multipart upload through the existing
// Drive seam (`drive/files/create`), then `i/import-*` with the returned id.
// The upload is the caller's client (`transport.upload`) so the module
// stays pure TS and the multipart wiring lives in one place (`client.ts`).
//
// EXPORT. Every `i/export-*` endpoint only ENQUEUES a queue job
// (`QueueService.createExport*Job`) and answers with an empty body. The
// file arrives later as an `exportCompleted` notification. `i/export-notes`
// is additionally limited to one request per day upstream. So `exportData`
// never awaits or fabricates a payload: it reports the queued job, its rate
// window, and the notification to watch. A fork that answers with a body
// gets an honest `status: "payload"` result instead — never the notes
// shape by assumption.
//
// Upload guards mirror `import-blocking.ts` (10 MB size cap); the file type
// is the server's decision (UNEXPECTED_FILE_TYPE / TOO_BIG_FILE come back
// as ApiError) because pickers report application/octet-stream for valid
// CSVs.
//
// Pure-TS rule: this module never touches the DOM. `serializeExport`
// returns the file bytes (the UI triggers the download/share itself);
// every failure carries a stable `{code, params}` error code the UI
// localizes (`message` is the fixed English fallback).

import { FediError } from "../core/errors";
import type { WireCall } from "./client";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportKind = "following" | "blocking" | "mute" | "notes";

/** `mute` maps to upstream `i/import-muting` (there is no `import-mute`);
 * `notes` is kept for forks that carry the endpoint — stock Misskey 404s
 * and the transport surfaces that as an honest unsupported error. */
export const IMPORT_ENDPOINTS: Record<ImportKind, string> = {
  following: "i/import-following",
  blocking: "i/import-blocking",
  mute: "i/import-muting",
  notes: "i/import-notes",
};

/** Concrete step names for the settings row. No byte percentage: fetch has
 * no upload-progress event in React Native, and a fake spinner percentage
 * would be dishonest. */
export type ImportPhase = "uploading" | "submitting" | "done";

export interface ImportProgress {
  phase: ImportPhase;
}

export interface ImportOptions {
  /** Called as the flow moves between steps (see `ImportPhase`). */
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportResult {
  ok: true;
  /** Endpoint that accepted the job. */
  endpoint: string;
  /** Drive file id the import job now references. */
  fileId: string;
  /** English fallback; the UI localizes around the phase, not this text. */
  message: string;
}

/** The two transport calls an import needs: the session-bound client's
 * `call` (Drive upload is multipart, never JSON). A `MisskeyClient` or a
 * `MisskeyTransport` satisfies this structurally. */
export interface ImportTransport {
  call: WireCall;
  upload<T>(file: File, opts?: { isSensitive?: boolean; comment?: string }): Promise<T>;
}

/** Size guard before any network I/O. The file type is the server's call:
 * pickers report application/octet-stream for valid CSVs, and upstream
 * answers UNEXPECTED_FILE_TYPE / TOO_BIG_FILE as an `ApiError` we surface
 * unchanged. */
export function assertImportFileSize(file: File): void {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new FediError(
      `File is too large (${Math.round(file.size / 1024)} KB — limit is 10 MB).`,
      "errors.compose.fileTooLarge",
      { kb: Math.round(file.size / 1024) },
    );
  }
}

function importMessage(kind: ImportKind): string {
  if (kind === "following") {
    return "Import queued. The server applies the file in the background; check your following list in a moment.";
  }
  if (kind === "blocking") {
    return "Import queued. The server applies the file in the background; check your blocked accounts in a moment.";
  }
  if (kind === "mute") {
    return "Import queued. The server applies the file in the background; check your muted accounts in a moment.";
  }
  return "Import queued. The server imports the file in the background; imported posts appear as they are created.";
}

/**
 * Upload `file` to Drive, then ask the server to import it by id.
 *
 * Throws before uploading when the size guard fails. Upload/API failures
 * propagate unchanged (the transport's `FediError`/`ApiError` codes), so
 * the UI can distinguish "file too large", "server said NO_SUCH_FILE", a
 * 403 permission error, and a 404 unsupported endpoint.
 */
export async function importData(
  transport: ImportTransport,
  kind: ImportKind,
  file: File,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const endpoint = IMPORT_ENDPOINTS[kind];
  assertImportFileSize(file);

  opts.onProgress?.({ phase: "uploading" });
  const uploaded = await transport.upload<{ id?: unknown }>(file);
  const fileId = typeof uploaded?.id === "string" ? uploaded.id : "";
  if (!fileId) {
    throw new FediError(
      "The server did not return the uploaded file.",
      "errors.shape.uploadedFile",
    );
  }

  opts.onProgress?.({ phase: "submitting" });
  await transport.call<undefined>(endpoint, { fileId });
  opts.onProgress?.({ phase: "done" });

  return { ok: true, endpoint, fileId, message: importMessage(kind) };
}

export type ExportKind =
  | "following"
  | "blocking"
  | "mute"
  | "notes"
  | "user-lists"
  | "antennas"
  | "clips"
  | "favorites";

export const EXPORT_ENDPOINTS: Record<ExportKind, string> = {
  following: "i/export-following",
  blocking: "i/export-blocking",
  mute: "i/export-mute",
  notes: "i/export-notes",
  "user-lists": "i/export-user-lists",
  antennas: "i/export-antennas",
  clips: "i/export-clips",
  favorites: "i/export-favorites",
};

/** Upstream rate limits (`meta.limit`) per export endpoint. */
export const EXPORT_RATE_LIMITS: Record<
  ExportKind,
  { max: number; window: "minute" | "hour" | "day" }
> = {
  following: { max: 1, window: "hour" },
  blocking: { max: 1, window: "hour" },
  mute: { max: 1, window: "hour" },
  notes: { max: 1, window: "day" },
  "user-lists": { max: 1, window: "minute" },
  antennas: { max: 1, window: "hour" },
  clips: { max: 1, window: "day" },
  favorites: { max: 1, window: "day" },
};

export interface ExportQueuedResult {
  /** The POST only queued a job; there is no payload yet. */
  status: "queued";
  endpoint: string;
  /** Where the finished file arrives. */
  delivery: "notification";
  notificationType: "exportCompleted";
  rateLimit: { max: number; window: "minute" | "hour" | "day" };
  message: string;
}

export interface ExportPayloadResult {
  /** A fork answered with a body — hand it to `serializeExport`. */
  status: "payload";
  endpoint: string;
  payload: unknown;
}

export type ExportResult = ExportQueuedResult | ExportPayloadResult;

/** Human-readable rate window for the honest queued message. */
export function exportRateLimitText(kind: ExportKind): string {
  const { max, window } = EXPORT_RATE_LIMITS[kind];
  if (max !== 1) return `up to ${max} per ${window}`;
  return window === "minute" ? "once a minute" : window === "hour" ? "once an hour" : "once a day";
}

/**
 * Enqueue an export job. Resolves as soon as the server answers — no
 * payload wait, no polling. The completed file is delivered as an
 * `exportCompleted` notification; for `notes` that is the only delivery
 * path (and the endpoint is limited to one request per day).
 *
 * A 429 from the endpoint is a real server error and propagates; the queued
 * result already carries the window so the UI can explain the limit before
 * the tap.
 */
export async function exportData(call: WireCall, kind: ExportKind): Promise<ExportResult> {
  const endpoint = EXPORT_ENDPOINTS[kind];
  const payload = await call<unknown>(endpoint, {});
  const rateLimit = EXPORT_RATE_LIMITS[kind];

  // Upstream answers 204/empty (undefined here). Anything else is a fork
  // that returns data directly; report it as a payload, never as queued.
  if (payload !== undefined && payload !== null) {
    return { status: "payload", endpoint, payload };
  }

  const message = `Export queued (${exportRateLimitText(
    kind,
  )}). Misskey builds the file in the background and sends an exportCompleted notification when it is ready.`;

  return {
    status: "queued",
    endpoint,
    delivery: "notification",
    notificationType: "exportCompleted",
    rateLimit,
    message,
  };
}

/** Serialize an export payload to downloadable JSON bytes. Only valid for
 * an `ExportPayloadResult` — never use this to "await" a queued notes
 * export (that endpoint returns no file). The UI owns the download/share
 * sheet (RN has no anchor-click download); the suggested filename rides
 * alongside. */
export function serializeExport(
  filename: string,
  payload: unknown,
): { filename: string; mimeType: string; text: string } {
  return {
    filename,
    mimeType: "application/json",
    text: JSON.stringify(payload, null, 2),
  };
}
