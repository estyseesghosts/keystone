import { createSignal, For, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { apiCall, isPermissionError, isUnsupportedError, uploadDriveFile } from "../api/client";
import type { DriveFile } from "../api/types";

const PAGE_SIZE = 20;

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

function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Duration in seconds when the server packed one (rare), else null.
 * Audio/video rows refine this from the element's own metadata. */
function packedDurationSec(file: DriveFile): number | null {
  const raw: unknown = file.properties?.["duration"];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** Best-effort audio tags from packed properties; every field optional. */
function audioTags(file: DriveFile): { title?: string; artist?: string; album?: string } {
  const props: Record<string, unknown> = file.properties ?? {};
  const pick = (key: string): string | undefined => {
    const value: unknown = props[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return { title: pick("title"), artist: pick("artist"), album: pick("album") };
}

const isImageFile = (file: DriveFile): boolean => file.type.startsWith("image/");
const isVideoFile = (file: DriveFile): boolean => file.type.startsWith("video/");
const isAudioFile = (file: DriveFile): boolean => file.type.startsWith("audio/");

export interface DriveBrowserProps {
  /** When true, each file gets a Select toggle for attaching to a note. */
  selectMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (file: DriveFile) => void;
}

interface ManageProps {
  file: DriveFile;
  selectMode?: boolean;
  selected: boolean;
  mutating: boolean;
  confirmingDelete: boolean;
  onToggleSelect: () => void;
  onToggleSensitive: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function Section(props: { title: string; count: number; children: JSX.Element }) {
  return (
    <section class="drivesec" aria-label={`${props.title} (${props.count})`}>
      <h2 class="drivesec-head">
        {props.title} <span class="handle">({props.count})</span>
      </h2>
      {props.children}
    </section>
  );
}

/** Compact per-file actions shared by tiles and rows. */
function ManageButtons(props: ManageProps) {
  return (
    <>
      <Show when={props.selectMode}>
        <button type="button" onClick={props.onToggleSelect} aria-pressed={props.selected}>
          {props.selected ? "Remove" : "Attach"}
        </button>
      </Show>
      <button
        type="button"
        disabled={props.mutating}
        onClick={props.onToggleSensitive}
        title="Toggle sensitive flag"
      >
        {props.file.isSensitive ? "Unmark" : "Mark sensitive"}
      </button>
      <Show when={props.confirmingDelete} fallback={
        <button type="button" onClick={props.onAskDelete}>Delete</button>
      }>
        <button type="button" disabled={props.mutating} onClick={props.onConfirmDelete}>
          {props.mutating ? "Deleting…" : "Confirm"}
        </button>
        <button type="button" onClick={props.onCancelDelete}>Cancel</button>
      </Show>
    </>
  );
}

function ImageTile(props: ManageProps) {
  const thumb = () => props.file.thumbnailUrl ?? props.file.url;
  const view = () => {
    if (props.selectMode) props.onToggleSelect();
    else window.open(props.file.url, "_blank", "noopener");
  };
  return (
    <figure class={props.selected ? "tile tile-selected" : "tile"}>
      <button
        type="button"
        class="tile-view"
        onClick={view}
        aria-label={props.selectMode ? `Select ${props.file.name}` : `Open ${props.file.name} in full`}
        aria-pressed={props.selectMode ? props.selected : undefined}
        title={props.file.name}
      >
        <img src={thumb()} alt={props.file.name} loading="lazy" />
        <Show when={props.selected}>
          <span class="tile-badge" aria-hidden="true">✓</span>
        </Show>
      </button>
      <figcaption class="tile-actions">
        <ManageButtons {...props} />
      </figcaption>
    </figure>
  );
}

function VideoTile(props: ManageProps) {
  const [playing, setPlaying] = createSignal(false);
  const thumb = () => props.file.thumbnailUrl ?? props.file.url;
  const duration = () => {
    const sec = packedDurationSec(props.file);
    return sec === null ? null : formatDuration(sec);
  };
  return (
    <figure class={props.selected ? "tile tile-selected" : "tile"}>
      <Show when={playing()} fallback={
        <button
          type="button"
          class="tile-view"
          onClick={() => (props.selectMode ? props.onToggleSelect() : setPlaying(true))}
          aria-label={props.selectMode ? `Select ${props.file.name}` : `Play ${props.file.name}`}
          aria-pressed={props.selectMode ? props.selected : undefined}
          title={props.file.name}
        >
          <img src={thumb()} alt={props.file.name} loading="lazy" />
          <span class="tile-play" aria-hidden="true">▶</span>
          <Show when={duration()}>
            {(text) => <span class="tile-duration" aria-hidden="true">{text()}</span>}
          </Show>
          <Show when={props.selected}>
            <span class="tile-badge" aria-hidden="true">✓</span>
          </Show>
        </button>
      }>
        <video controls autoplay preload="metadata" src={props.file.url} />
        <div class="tile-actions">
          <button type="button" onClick={() => setPlaying(false)}>Close preview</button>
          <ManageButtons {...props} />
        </div>
      </Show>
      <Show when={!playing()}>
        <figcaption class="tile-actions">
          <ManageButtons {...props} />
        </figcaption>
      </Show>
    </figure>
  );
}

function AudioRow(props: ManageProps) {
  const [duration, setDuration] = createSignal<number | null>(packedDurationSec(props.file));
  const tags = () => audioTags(props.file);
  const byline = () => {
    const parts: string[] = [];
    if (tags().artist) parts.push(tags().artist!);
    if (tags().album) parts.push(tags().album!);
    parts.push(props.file.type);
    parts.push(formatSize(props.file.size));
    if (props.file.isSensitive) parts.push("sensitive");
    return parts.join(" · ");
  };
  return (
    <div class="audiorow">
      <div class="audio-main">
        <div class="audio-title">{tags().title ?? props.file.name}</div>
        <div class="handle">{byline()}</div>
        <Show when={props.file.comment}>
          <div class="handle">{props.file.comment}</div>
        </Show>
        <audio
          controls
          preload="metadata"
          src={props.file.url}
          onLoadedMetadata={(e) => {
            const seconds = e.currentTarget.duration;
            if (Number.isFinite(seconds)) setDuration(seconds);
          }}
        >
          Your browser cannot play this audio ({props.file.name})
        </audio>
        <Show when={duration() !== null}>
          <div class="handle">Duration {formatDuration(duration()!)}</div>
        </Show>
      </div>
      <div class="audio-actions">
        <ManageButtons {...props} />
      </div>
    </div>
  );
}

function FileRow(props: ManageProps) {
  const file = () => props.file;
  return (
    <div class="drivefile">
      <Show when={file().thumbnailUrl ?? (isImageFile(file()) ? file().url : null)}>
        {(src) => <img src={src()} alt="" loading="lazy" />}
      </Show>
      <div style={{ flex: 1 }}>
        <div>{file().name}</div>
        <div class="handle">
          {file().type} · {formatSize(file().size)}
          {file().isSensitive ? " · sensitive" : ""}
        </div>
      </div>
      <ManageButtons {...props} />
    </div>
  );
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
      // No server-side type filter: every page is grouped client-side into
      // Images / Videos / Audio / Files below.
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

  const images = () => files().filter(isImageFile);
  const videos = () => files().filter(isVideoFile);
  const audios = () => files().filter(isAudioFile);
  const others = () => files().filter((f) => !isImageFile(f) && !isVideoFile(f) && !isAudioFile(f));

  const manageFor = (file: DriveFile): ManageProps => ({
    file,
    selectMode: props.selectMode,
    selected: props.selectedIds?.includes(file.id) ?? false,
    mutating: mutatingId() === file.id,
    confirmingDelete: confirmDelete() === file.id,
    onToggleSelect: () => props.onToggleSelect?.(file),
    onToggleSensitive: () => void toggleSensitive(file),
    onAskDelete: () => setConfirmDelete(file.id),
    onCancelDelete: () => setConfirmDelete(null),
    onConfirmDelete: () => void remove(file),
  });

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
          <Show when={images().length > 0}>
            <Section title="Images" count={images().length}>
              <div class="mosaic">
                <For each={images()}>{(file) => <ImageTile {...manageFor(file)} />}</For>
              </div>
            </Section>
          </Show>
          <Show when={videos().length > 0}>
            <Section title="Videos" count={videos().length}>
              <div class="mosaic">
                <For each={videos()}>{(file) => <VideoTile {...manageFor(file)} />}</For>
              </div>
            </Section>
          </Show>
          <Show when={audios().length > 0}>
            <Section title="Audio" count={audios().length}>
              <For each={audios()}>{(file) => <AudioRow {...manageFor(file)} />}</For>
            </Section>
          </Show>
          <Show when={others().length > 0}>
            <Section title="Files" count={others().length}>
              <For each={others()}>{(file) => <FileRow {...manageFor(file)} />}</For>
            </Section>
          </Show>
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
