import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { apiCall, ApiError } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { useAuth } from "../state/auth";
import Composer from "./Composer";
import ErrorState from "./ErrorState";
import LoadingState from "./LoadingState";
import NoteCard from "./NoteCard";

export interface TimelineFeedProps {
  endpoint: string;
  title: string;
  showComposer: boolean;
  /** Extra params merged into every page request (e.g. { antennaId }). */
  extraParams?: Record<string, unknown>;
  /** When set, a 404 from the server renders this honest message instead of an error. */
  unsupportedMessage?: string;
}

const PAGE_SIZE = 20;

type LoadMode = "initial" | "older" | "refresh";

export default function TimelineFeed(props: TimelineFeedProps) {
  const auth = useAuth();
  const [notes, setNotes] = createSignal<Note[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<LoadMode | null>(null);
  const [reactingId, setReactingId] = createSignal<string | null>(null);
  const [repostingId, setRepostingId] = createSignal<string | null>(null);
  const [repostedIds, setRepostedIds] = createSignal<string[]>([]);

  const load = async (mode: LoadMode) => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = notes();
      const params: Record<string, unknown> = {
        limit: PAGE_SIZE,
        ...(props.extraParams ?? {}),
      };
      if (mode === "older" && current.length > 0) {
        params.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>(props.endpoint, params);
      setUnsupported(false);
      if (mode === "older") {
        // Merge with dedupe by note id; a page that contributes zero new
        // ids means the server has nothing older to offer.
        const seen = new Set(current.map((n) => n.id));
        const fresh: Note[] = [];
        for (const n of page) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            fresh.push(n);
          }
        }
        if (fresh.length === 0) setExhausted(true);
        setNotes([...current, ...fresh]);
      } else {
        const seen = new Set<string>();
        setNotes(
          page.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          }),
        );
        setExhausted(false);
      }
      setFailedMode(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && props.unsupportedMessage) {
        setUnsupported(true);
      } else {
        // Pagination failures keep the already-loaded notes on screen; the
        // failed mode is remembered so "Try again" retries the same cursor.
        setError(err instanceof Error ? err.message : "Could not load the timeline.");
        setFailedMode(mode);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setBusy(false);
    }
  };

  const retry = () => void load(failedMode() ?? "refresh");

  onMount(() => {
    void load("initial");
  });

  // The router may reuse this feed for a different source (e.g.
  // /antennas/a -> /antennas/b): when the endpoint or extra params change
  // by value, reset and reload instead of showing the previous feed.
  let firstParamsRun = true;
  createEffect(() => {
    const fingerprint = JSON.stringify({
      endpoint: props.endpoint,
      extra: props.extraParams ?? {},
    });
    if (firstParamsRun) {
      firstParamsRun = false;
      return;
    }
    setNotes([]);
    setExhausted(false);
    setFailedMode(null);
    setUnsupported(false);
    void load("initial");
  });

  const refreshNote = async (id: string) => {
    // Reconcile interaction state from the server (counts, myReaction,
    // renoteCount). A refresh failure keeps the current state — the next
    // load corrects it.
    try {
      const fresh = await apiCall<Note>("notes/show", { noteId: id });
      setNotes((current) => current.map((n) => (n.id === id ? fresh : n)));
    } catch {
      // Keep current state.
    }
  };

  const toggleReaction = async (note: Note, reaction: string | null) => {
    if (!auth.token() || reactingId() !== null) return;
    setReactingId(note.id);
    try {
      if (reaction === null || note.myReaction) {
        await apiCall<undefined>("notes/reactions/delete", { noteId: note.id });
        setNotes((current) =>
          current.map((n) => {
            if (n.id !== note.id || !n.myReaction) return n;
            const prev = n.myReaction;
            const count = Math.max(0, (n.reactions[prev] ?? 1) - 1);
            const reactions = { ...n.reactions };
            if (count === 0) delete reactions[prev];
            else reactions[prev] = count;
            return { ...n, myReaction: null, reactions, reactionCount: Math.max(0, n.reactionCount - 1) };
          }),
        );
      } else {
        await apiCall<undefined>("notes/reactions/create", { noteId: note.id, reaction });
        setNotes((current) =>
          current.map((n) => {
            if (n.id !== note.id || n.myReaction) return n;
            return {
              ...n,
              myReaction: reaction,
              reactions: { ...n.reactions, [reaction]: (n.reactions[reaction] ?? 0) + 1 },
              reactionCount: n.reactionCount + 1,
            };
          }),
        );
      }
      await refreshNote(note.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction failed.");
    } finally {
      setReactingId(null);
    }
  };

  const prependNote = (note: Note) => {
    setNotes((current) => [note, ...current]);
  };

  const unrepost = async (note: Note) => {
    if (!auth.token() || repostingId() !== null) return;
    // notes/unrenote takes the ORIGINAL note's id and deletes my renotes
    // of it (verified against Misskey notes/unrenote.ts).
    if (!repostedIds().includes(note.id)) return;
    setRepostingId(note.id);
    try {
      await apiCall<undefined>("notes/unrenote", { noteId: note.id });
      setRepostedIds((ids) => ids.filter((id) => id !== note.id));
      setNotes((current) => [
        ...current.map((n) =>
          n.id === note.id ? { ...n, renoteCount: Math.max(0, n.renoteCount - 1) } : n,
        ),
      ]);
      await refreshNote(note.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo repost failed.");
    } finally {
      setRepostingId(null);
    }
  };

  const repost = async (note: Note) => {
    if (!auth.token() || repostingId() !== null) return;
    // Persistent repost state: a note already reposted in this view is a
    // no-op, so double clicks can never create duplicates.
    if (repostedIds().includes(note.id)) return;
    setRepostingId(note.id);
    try {
      const res = await apiCall<CreatedNoteResponse>("notes/create", { renoteId: note.id });
      setNotes((current) => [
        res.createdNote,
        ...current.map((n) => (n.id === note.id ? { ...n, renoteCount: n.renoteCount + 1 } : n)),
      ]);
      setRepostedIds((ids) => (ids.includes(note.id) ? ids : [...ids, note.id]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repost failed.");
    } finally {
      setRepostingId(null);
    }
  };

  return (
    <div>
      <div class="pagehead">
        <h1>{props.title}</h1>
        <button type="button" onClick={() => void load("refresh")} disabled={loading() || loadingMore()}>
          Refresh
        </button>
      </div>

      <Show when={props.showComposer && auth.token()}>
        <Composer onPosted={prependNote} />
      </Show>

      <Show when={unsupported()}>
        <div class="state" role="status">
          <div class="errorbox">{props.unsupportedMessage}</div>
        </div>
      </Show>

      <Show when={!unsupported()}>
        <Show when={loading()} fallback={
          <>
            <Show when={error() && notes().length > 0}>
              <div class="state" role="alert">
                <div class="errorbox">{error()}</div>
                <button type="button" onClick={retry}>Try again</button>
              </div>
            </Show>
            <Show when={error() && notes().length === 0}>
              <ErrorState message={error() ?? "Could not load the timeline."} onRetry={retry} />
            </Show>
            <Show when={notes().length > 0}>
              <div class="feed">
                <For each={notes()}>
                  {(note) => (
                    <NoteCard
                      note={note}
                      onToggleReaction={auth.token() ? toggleReaction : undefined}
                      reacting={reactingId() === note.id}
                      onRepost={auth.token() ? repost : undefined}
                      onUnrepost={auth.token() ? unrepost : undefined}
                      reposting={repostingId() === note.id}
                      reposted={repostedIds().includes(note.id)}
                      onChanged={() => void refreshNote(note.id)}
                    />
                  )}
                </For>
              </div>
              <Show when={!exhausted()} fallback={
                <div class="state" role="status"><p>You're caught up.</p></div>
              }>
                <div class="pager">
                  <button type="button" onClick={() => void load("older")} disabled={loadingMore()}>
                    {loadingMore() ? "Loading…" : "Load older"}
                  </button>
                </div>
              </Show>
            </Show>
            <Show when={!error() && notes().length === 0}>
              <div class="state"><p>No notes yet.</p></div>
            </Show>
          </>
        }>
          <LoadingState label={`Loading ${props.title.toLowerCase()}…`} />
        </Show>
      </Show>
    </div>
  );
}
