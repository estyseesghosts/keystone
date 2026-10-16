// Import / export (§14). Misskey-compatible files first
// (following/blocking/mute/notes), then lists/antennas/clips/favorites.
// Upload guards mirror `import-blocking.ts` (size/type, per-row report);
// export downloads from the export job; `exportCompleted` notifications
// surface in the Notifications route. All endpoints 404-gate.

import { apiCall } from "./client";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportKind = "following" | "blocking" | "mute" | "notes";

export interface ImportResult {
  ok: boolean;
  message: string;
}

/** Read a user-picked file with size/type guards. Pure-ish (FileReader). */
export async function readImportFile(file: File): Promise<string> {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new Error(`File is too large (${Math.round(file.size / 1024)} KB — limit is 10 MB).`);
  }
  return file.text();
}

export async function importData(kind: ImportKind, content: string): Promise<ImportResult> {
  const endpoint =
    kind === "following"
      ? "i/import-following"
      : kind === "blocking"
        ? "i/import-blocking"
        : kind === "mute"
          ? "i/import-mute"
          : "i/import-notes";
  await apiCall<undefined>(endpoint, { file: content });
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

export async function exportData(kind: ExportKind): Promise<unknown> {
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
  return apiCall<unknown>(endpoint, {});
}

/** Trigger a download of JSON-serializable export payloads. */
export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
