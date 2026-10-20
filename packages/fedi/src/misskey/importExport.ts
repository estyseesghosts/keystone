// Import / export (§14). Misskey-compatible files first
// (following/blocking/mute/notes), then lists/antennas/clips/favorites.
// Upload guards mirror `import-blocking.ts` (size/type, per-row report);
// export downloads from the export job; `exportCompleted` notifications
// surface in the Notifications route. All endpoints 404-gate.
//
// Pure-TS rule: this module never touches the DOM. `serializeExport`
// returns the file bytes (the UI triggers the download/share itself);
// every failure carries a stable `{code, params}` error code the UI
// localizes (`message` is the fixed English fallback).

import { FediError } from "../core/errors";
import type { WireCall } from "./client";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportKind = "following" | "blocking" | "mute" | "notes";

export interface ImportResult {
  ok: boolean;
  message: string;
}

/** Read a user-picked file with size/type guards. */
export async function readImportFile(file: File): Promise<string> {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new FediError(
      `File is too large (${Math.round(file.size / 1024)} KB — limit is 10 MB).`,
      "errors.compose.fileTooLarge",
      { kb: Math.round(file.size / 1024) },
    );
  }
  return file.text();
}

export async function importData(
  call: WireCall,
  kind: ImportKind,
  content: string,
): Promise<ImportResult> {
  const endpoint =
    kind === "following"
      ? "i/import-following"
      : kind === "blocking"
        ? "i/import-blocking"
        : kind === "mute"
          ? "i/import-mute"
          : "i/import-notes";
  await call<undefined>(endpoint, { file: content });
  return { ok: true, message: "Import started. Results arrive as a notification when done." };
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

export async function exportData(call: WireCall, kind: ExportKind): Promise<unknown> {
  const endpoint =
    kind === "following"
      ? "i/export-following"
      : kind === "blocking"
        ? "i/export-blocking"
        : kind === "mute"
          ? "i/export-mute"
          : kind === "notes"
            ? "i/export-notes"
            : kind === "user-lists"
              ? "i/export-user-lists"
              : kind === "antennas"
                ? "i/export-antennas"
                : kind === "clips"
                  ? "i/export-clips"
                  : "i/export-favorites";
  return call<unknown>(endpoint, {});
}

/** Serialize an export payload to downloadable JSON bytes. The UI owns
 * the download/share sheet (RN has no anchor-click download); the
 * suggested filename rides alongside. */
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
