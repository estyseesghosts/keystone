import { createSignal, For, Show } from "solid-js";
import { apiCall, apiCallPublic } from "../api/client";
import { IS_MISSKEY_FAMILY } from "../api/backend";
import type {
  CreatedNoteResponse,
  DriveFile,
  Note,
  NoteVisibility,
  UserLite,
} from "../api/types";
import DriveBrowser from "./DriveBrowser";

const FALLBACK_LIMIT = 3000;
const VISIBILITIES: NoteVisibility[] = ["public", "home", "followers", "specified"];

// Server-advertised text limit (meta.maxNoteTextLength, 3000 on all three
// local backends), fetched once and cached. Falls back safely when meta is
// unreachable so the composer never blocks on it.
let cachedLimit: number | null = null;
async function textLimit(): Promise<number> {
  if (cachedLimit !== null) return cachedLimit;
  try {
    const meta = await apiCallPublic<{ maxNoteTextLength?: number }>("meta", {});
    cachedLimit =
      typeof meta.maxNoteTextLength === "number" && meta.maxNoteTextLength > 0
        ? meta.maxNoteTextLength
        : FALLBACK_LIMIT;
  } catch {
    cachedLimit = FALLBACK_LIMIT;
  }
  return cachedLimit;
}

const POLL_EXPIRIES: { label: string; seconds: number | null }[] = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "No expiry", seconds: null },
];

function RecipientPicker(props: {
  recipients: UserLite[];
  onAdd: (user: UserLite) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<UserLite[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);

  const search = async () => {
    const q = query().trim();
    if (q.length === 0 || searching()) return;
    setSearching(true);
    setSearchError(null);
    try {
      // Authenticated search: Misskey requires a credential here.
      const users = await apiCall<UserLite[]>("users/search", { query: q, limit: 5 });
      setResults(users);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div class="field">
      <label>Recipients (specified visibility)</label>
      <Show when={props.recipients.length > 0}>
        <div class="chips">
          <For each={props.recipients}>
            {(u) => (
              <span class="chip">
                @{u.username}{u.host ? `@${u.host}` : ""}
                <button type="button" onClick={() => props.onRemove(u.id)} aria-label={`Remove ${u.username}`}>×</button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="row">
        <input
          type="text"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search users…"
          aria-label="Search users to add"
        />
        <button type="button" disabled={searching() || query().trim().length === 0} onClick={() => void search()}>
          {searching() ? "Searching…" : "Search"}
        </button>
      </div>
      <Show when={searchError()}>
        <div class="err" role="alert">{searchError()}</div>
      </Show>
      <Show when={results().length > 0}>
        <div class="feed">
          <For each={results()}>
            {(u) => (
              <div class="drivefile">
                <span>@{u.username}{u.host ? `@${u.host}` : ""}</span>
                <button
                  type="button"
                  disabled={props.recipients.some((r) => r.id === u.id)}
                  onClick={() => props.onAdd(u)}
                >
                  Add
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function Composer(props: {
  replyId?: string;
  renoteId?: string;
  onPosted: (note: Note) => void;
}) {
  const [text, setText] = createSignal("");
  const [cw, setCw] = createSignal("");
  const [showCw, setShowCw] = createSignal(false);
  const [visibility, setVisibility] = createSignal<NoteVisibility>("public");
  const [recipients, setRecipients] = createSignal<UserLite[]>([]);
  const [localOnly, setLocalOnly] = createSignal(false);
  const [limit, setLimit] = createSignal(FALLBACK_LIMIT);
  const [attached, setAttached] = createSignal<DriveFile[]>([]);
  const [showAttach, setShowAttach] = createSignal(false);
  const [usePoll, setUsePoll] = createSignal(false);
  const [choices, setChoices] = createSignal<string[]>(["", ""]);
  const [multiple, setMultiple] = createSignal(false);
  const [expiry, setExpiry] = createSignal<number | null>(86400);
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  void textLimit().then(setLimit);

  const pollChoices = () => choices().map((c) => c.trim()).filter((c) => c.length > 0);
  const pollValid = () => usePoll() && pollChoices().length >= 2;
  const remaining = () => limit() - text().length;
  const canPost = () =>
    !posting() &&
    text().length <= limit() &&
    (text().trim().length > 0 || attached().length > 0 || pollValid() || !!props.renoteId) &&
    (visibility() !== "specified" || recipients().length > 0);

  const toggleAttach = (file: DriveFile) => {
    setAttached((current) =>
      current.some((f) => f.id === file.id)
        ? current.filter((f) => f.id !== file.id)
        : [...current, file],
    );
  };

  const post = async () => {
    if (!canPost()) return;
    setPosting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        visibility: visibility(),
        ...(text().trim() ? { text: text().trim() } : {}),
        ...(showCw() && cw().trim() ? { cw: cw().trim().slice(0, 100) } : {}),
        ...(visibility() === "specified"
          ? { visibleUserIds: recipients().map((r) => r.id) }
          : {}),
        ...(localOnly() ? { localOnly: true } : {}),
        ...(props.replyId ? { replyId: props.replyId } : {}),
        ...(props.renoteId ? { renoteId: props.renoteId } : {}),
        ...(attached().length > 0 ? { fileIds: attached().map((f) => f.id) } : {}),
        ...(pollValid()
          ? {
              poll: {
                choices: pollChoices(),
                multiple: multiple(),
                ...(expiry() !== null ? { expiredAfter: expiry() } : {}),
              },
            }
          : {}),
      };
      const res = await apiCall<CreatedNoteResponse>("notes/create", body);
      // Clear only on success: after a recoverable error the text,
      // settings, and completed uploads are all preserved for retry.
      setText("");
      setCw("");
      setShowCw(false);
      setVisibility("public");
      setRecipients([]);
      setLocalOnly(false);
      setAttached([]);
      setShowAttach(false);
      setUsePoll(false);
      setChoices(["", ""]);
      setError(null);
      props.onPosted(res.createdNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the note.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div class="composer">
      <textarea
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={props.replyId ? "Write a reply…" : props.renoteId ? "Add a comment…" : "What's happening?"}
        maxlength={limit()}
        aria-label={props.replyId ? "Reply text" : props.renoteId ? "Quote comment" : "Note text"}
      />
      <Show when={showCw()}>
        <input
          type="text"
          value={cw()}
          onInput={(e) => setCw(e.currentTarget.value)}
          placeholder="Content warning"
          maxlength={100}
          aria-label="Content warning"
        />
      </Show>
      <Show when={attached().length > 0}>
        <div class="chips">
          <For each={attached()}>
            {(f) => (
              <span class="chip">
                {f.name}
                <button type="button" onClick={() => toggleAttach(f)} aria-label={`Remove ${f.name}`}>×</button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={showAttach()}>
        <DriveBrowser
          selectMode
          selectedIds={attached().map((f) => f.id)}
          onToggleSelect={toggleAttach}
        />
      </Show>
      <Show when={usePoll() && IS_MISSKEY_FAMILY}>
        <div class="field">
          <label>Poll (2–10 options)</label>
          <For each={choices()}>
            {(choice, i) => (
              <div class="row">
                <input
                  type="text"
                  value={choice}
                  onInput={(e) =>
                    setChoices((list) => list.map((c, j) => (j === i() ? e.currentTarget.value : c)))
                  }
                  placeholder={`Option ${i() + 1}`}
                  maxlength={50}
                  aria-label={`Poll option ${i() + 1}`}
                />
                <button
                  type="button"
                  disabled={choices().length <= 2}
                  onClick={() => setChoices((list) => list.filter((_, j) => j !== i()))}
                  aria-label={`Remove option ${i() + 1}`}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={choices().length < 10}>
            <button type="button" onClick={() => setChoices((list) => [...list, ""])}>
              Add option
            </button>
          </Show>
          <div class="row">
            <label>
              <input type="checkbox" checked={multiple()} onChange={(e) => setMultiple(e.currentTarget.checked)} />
              Multiple choice
            </label>
            <select
              value={expiry() === null ? "never" : String(expiry())}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setExpiry(v === "never" ? null : Number(v));
              }}
              aria-label="Poll expiry"
            >
              <For each={POLL_EXPIRIES}>
                {(o) => (
                  <option value={o.seconds === null ? "never" : String(o.seconds)}>{o.label}</option>
                )}
              </For>
            </select>
          </div>
        </div>
      </Show>
      <Show when={visibility() === "specified"}>
        <RecipientPicker
          recipients={recipients()}
          onAdd={(u) => setRecipients((r) => (r.some((x) => x.id === u.id) ? r : [...r, u]))}
          onRemove={(id) => setRecipients((r) => r.filter((x) => x.id !== id))}
        />
      </Show>
      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
      <div class="row">
        <select
          value={visibility()}
          onChange={(e) => setVisibility(e.currentTarget.value as NoteVisibility)}
          aria-label="Visibility"
        >
          <For each={VISIBILITIES}>{(v) => <option value={v}>{v}</option>}</For>
        </select>
        <label title="Visible only on this server">
          <input type="checkbox" checked={localOnly()} onChange={(e) => setLocalOnly(e.currentTarget.checked)} />
          Local
        </label>
        <button type="button" onClick={() => setShowCw((v) => !v)} aria-pressed={showCw()}>
          CW
        </button>
        <button type="button" onClick={() => setShowAttach((v) => !v)} aria-pressed={showAttach()}>
          Media{attached().length > 0 ? ` (${attached().length})` : ""}
        </button>
        <Show when={IS_MISSKEY_FAMILY} fallback={
          <span class="handle" title="This server rejects polls">No polls here</span>
        }>
          <button type="button" onClick={() => setUsePoll((v) => !v)} aria-pressed={usePoll()}>
            Poll
          </button>
        </Show>
        <span class="spacer" />
        <span class="count">{remaining()}</span>
        <button type="button" class="btn-primary" disabled={!canPost()} onClick={post}>
          {posting() ? "Posting…" : props.replyId ? "Reply" : props.renoteId ? "Quote" : "Post"}
        </button>
      </div>
    </div>
  );
}
