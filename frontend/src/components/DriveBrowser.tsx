import { createSignal, For, onMount, Show } from "solid-js";
import { apiCall, isPermissionError, isUnsupportedError, uploadDriveFile } from "../api/client";
import type { DriveFile } from "../api/types";

const PAGE_SIZE = 20;

type TypeFilter = "all" | "image" | "video" | "audio" | "file";

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "All",
  image: "Images",
  video: "Videos",
  audio: "Audio",
  file: "Files",
};

interface PendingUpload {
  key: string;
  file: File;
  status: "uploading" | "error";
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DriveBrowserProps {
  /** When true, each file gets a Select toggle for attaching to a note. */
  selectMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (file: DriveFile) => void;
}

export default function DriveBrowser(props: DriveBrowserProps) {
  const [files, setFiles] = createSignal<DriveFile[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [failedMode, setFailedMode] = createSignal<"initial" | "older" | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [denied, setDenied] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [typeFilter, setTypeFilter] = createSignal<TypeFilter>("all");
  const [uploads, setUploads] = createSignal<PendingUpload[]>([]);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [mutatingId, setMutatingId] = createSignal<string | null>(null);

  const load = async (mode: "initial" | "older") => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = files();
      const req: Record<string, unknown> = { limit: PAGE_SIZE };
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const filter = typeFilter();
      if (filter !== "all") req.type = `${filter}/*`;
      const page = await apiCall<DriveFile[]>("drive/files", req);
      setUnsupported(false);
      setDenied(false);
      if (mode === "older") {
        const seen = new Set(current.map((f) => f.id));
        const fresh = page.filter((f) => !seen.has(f.id));
        if (fresh.length === 0) setExhausted(true);
        setFiles([...current, ...fresh]);
      } else {
        setFiles(page);
        setExhausted(false);
      }
      setFailedMode(null);
    } catch (err) {
      if (isUnsupportedError(err)) {
        // Pinetree has upload + serving but no listing endpoint: the
        // browser degrades to upload-only instead of erroring.
        setUnsupported(true);
      } else if (isPermissionError(err)) {
        setDenied(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not list Drive files.");
        setFailedMode(mode);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setBusy(false);
    }
  };

  const retry = () => void load(failedMode() ?? "initial");

  const setFilter = (filter: TypeFilter) => {
    if (filter === typeFilter()) return;
    setTypeFilter(filter);
    setFiles([]);
    setExhausted(false);
    void load("initial");
  };

  const runUpload = async (entry: PendingUpload) => {
    setUploads((list) =>
      list.map((u) => (u.key === entry.key ? { ...u, status: "uploading" as const, error: undefined } : u)),
    );
    try {
      const created = await uploadDriveFile<DriveFile>(entry.file);
      // Successful uploads are never silently lost: the new file leads the
      // list (when listing is supported) and stays selected for posting.
      setFiles((current) =>
        current.some((f) => f.id === created.id) ? current : [created, ...current],
      );
      setUploads((list) => list.filter((u) => u.key !== entry.key));
      if (props.selectMode) props.onToggleSelect?.(created);
    } catch (err) {
      setUploads((list) =>
        list.map((u) =>
          u.key === entry.key
            ? {
                ...u,
                status: "error" as const,
                error: isPermissionError(err)
                  ? "Upload denied: your session lacks Drive permission. Sign out and sign in again."
                  : err instanceof Error ? err.message : "Upload failed.",
              }
            : u,
        ),
      );
    }
  };

  const queueUploads = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const entries: PendingUpload[] = Array.from(fileList).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      status: "uploading" as const,
    }));
    setUploads((list) => [...entries, ...list]);
    for (const entry of entries) void runUpload(entry);
  };

  const remove = async (file: DriveFile) => {
    if (mutatingId() !== null) return;
    setMutatingId(file.id);
    try {
      await apiCall<undefined>("drive/files/delete", { fileId: file.id });
      setFiles((current) => current.filter((f) => f.id !== file.id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the file.");
    } finally {
      setMutatingId(null);
    }
  };

  const toggleSensitive = async (file: DriveFile) => {
    if (mutatingId() !== null) return;
    setMutatingId(file.id);
    try {
      const updated = await apiCall<DriveFile>("drive/files/update", {
        fileId: file.id,
        isSensitive: !file.isSensitive,
      });
      setFiles((current) => current.map((f) => (f.id === file.id ? updated : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the file.");
    } finally {
      setMutatingId(null);
    }
  };

  onMount(() => {
    void load("initial");
  });

  return (
    <div>
      <div class="row" style={{ padding: "12px 16px" }}>
        <label class="btn-primary" style={{ padding: "6px 12px", border: "1px solid var(--text)", "border-radius": "6px", cursor: "pointer" }}>
          Upload
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              queueUploads(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <select
          value={typeFilter()}
          onChange={(e) => setFilter(e.currentTarget.value as TypeFilter)}
          aria-label="Filter by media type"
        >
          <For each={Object.keys(TYPE_LABELS) as TypeFilter[]}>
            {(t) => <option value={t}>{TYPE_LABELS[t]}</option>}
          </For>
        </select>
        <span class="spacer" />
        <button type="button" onClick={() => void load("initial")} disabled={loading() || loadingMore()}>
          Refresh
        </button>
      </div>

      <Show when={uploads().length > 0}>
        <div style={{ padding: "0 16px" }}>
          <For each={uploads()}>
            {(u) => (
              <div class="drivefile" role={u.status === "error" ? "alert" : "status"}>
                <span>{u.file.name} ({formatSize(u.file.size)})</span>
                <Show when={u.status === "uploading"} fallback={
                  <>
                    <span class="err">{u.error}</span>
                    <button type="button" onClick={() => void runUpload(u)}>Retry</button>
                    <button
                      type="button"
                      onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                    >
                      Dismiss
                    </button>
                  </>
                }>
                  <span class="handle">Uploading…</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={denied()}>
        <div class="state" role="alert">
          <div class="errorbox">
            Your session lacks Drive permission. Sign out and sign in again to grant it, then retry.
          </div>
        </div>
      </Show>

      <Show when={unsupported()}>
        <div class="state" role="status">
          <p>This server supports uploads but not file listing, so previously uploaded files cannot be browsed here.</p>
        </div>
      </Show>

      <Show when={!unsupported() && !denied()}>
        <Show when={loading()}>
          <div class="state"><p>Loading Drive…</p></div>
        </Show>
        <Show when={!loading()}>
          <Show when={error() && files().length === 0}>
            <div class="state" role="alert">
              <div class="errorbox">{error()}</div>
              <button type="button" onClick={retry}>Try again</button>
            </div>
          </Show>
          <Show when={error() && files().length > 0}>
            <div class="state" role="alert">
              <div class="errorbox">{error()}</div>
              <button type="button" onClick={retry}>Try again</button>
            </div>
          </Show>
          <Show when={files().length === 0 && !error()}>
            <div class="state"><p>No files yet. Upload one above.</p></div>
          </Show>
          <div class="feed">
            <For each={files()}>
              {(file) => (
                <div class="drivefile">
                  <Show when={file.thumbnailUrl ?? (file.type.startsWith("image/") ? file.url : null)}>
                    {(src) => <img src={src()} alt="" loading="lazy" />}
                  </Show>
                  <div style={{ flex: 1 }}>
                    <div>{file.name}</div>
                    <div class="handle">
                      {file.type} · {formatSize(file.size)}
                      {file.isSensitive ? " · sensitive" : ""}
                    </div>
                  </div>
                  <Show when={props.selectMode}>
                    <button
                      type="button"
                      onClick={() => props.onToggleSelect?.(file)}
                      aria-pressed={props.selectedIds?.includes(file.id) ?? false}
                    >
                      {(props.selectedIds?.includes(file.id) ?? false) ? "Remove" : "Attach"}
                    </button>
                  </Show>
                  <button
                    type="button"
                    disabled={mutatingId() === file.id}
                    onClick={() => void toggleSensitive(file)}
                    title="Toggle sensitive flag"
                  >
                    {file.isSensitive ? "Unmark" : "Mark sensitive"}
                  </button>
                  <Show when={confirmDelete() === file.id} fallback={
                    <button type="button" onClick={() => setConfirmDelete(file.id)}>Delete</button>
                  }>
                    <button
                      type="button"
                      disabled={mutatingId() === file.id}
                      onClick={() => void remove(file)}
                    >
                      {mutatingId() === file.id ? "Deleting…" : "Confirm"}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={!exhausted() && files().length > 0}>
            <div class="pager">
              <button type="button" onClick={() => void load("older")} disabled={loadingMore()}>
                {loadingMore() ? "Loading…" : "Load older"}
              </button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
