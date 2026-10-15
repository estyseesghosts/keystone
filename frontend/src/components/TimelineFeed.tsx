import { createSignal, For, onMount, Show } from "solid-js";
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
  /** When set, a 404 from the server renders this honest message instead of an error. */
  unsupportedMessage?: string;
}

const PAGE_SIZE = 20;

export default function TimelineFeed(props: TimelineFeedProps) {
  const auth = useAuth();
  const [notes, setNotes] = createSignal<Note[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [reactingId, setReactingId] = createSignal<string | null>(null);
  const [repostingId, setRepostingId] = createSignal<string | null>(null);
  const [repostedIds, setRepostedIds] = createSignal<string[]>([]);

  const load = async (mode: "initial" | "older" | "refresh") => {
    if (busy()) return;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = notes();
      const params: Record<string, unknown> = { limit: PAGE_SIZE };
      if (mode === "older" && current.length > 0) {
        params.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>(props.endpoint, params);
      setUnsupported(false);
      setNotes(mode === "older" ? [...current, ...page] : page);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && props.unsupportedMessage) {
        setUnsupported(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not load the timeline.");
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setBusy(false);
    }
  };

  onMount(() => {
    void load("initial");
  });

  const toggleReaction = async (note: Note) => {
    if (!auth.token() || reactingId() !== null) return;
    setReactingId(note.id);
    try {
      if (note.myReaction) {
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
        await apiCall<undefined>("notes/reactions/create", { noteId: note.id, reaction: "❤️" });
        setNotes((current) =>
          current.map((n) => {
            if (n.id !== note.id || n.myReaction) return n;
            return {
              ...n,
              myReaction: "❤️",
              reactions: { ...n.reactions, "❤️": (n.reactions["❤️"] ?? 0) + 1 },
              reactionCount: n.reactionCount + 1,
            };
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction failed.");
    } finally {
      setReactingId(null);
    }
  };

  const prependNote = (note: Note) => {
    setNotes((current) => [note, ...current]);
  };

  const repost = async (note: Note) => {
    if (!auth.token() || repostingId() !== null) return;
    setRepostingId(note.id);
    try {
      const res = await apiCall<CreatedNoteResponse>("notes/create", { renoteId: note.id });
      setNotes((current) => [
        res.createdNote,
        ...current.map((n) => (n.id === note.id ? { ...n, renoteCount: n.renoteCount + 1 } : n)),
      ]);
      setRepostedIds((ids) => [...ids, note.id]);
      window.setTimeout(() => {
        setRepostedIds((ids) => ids.filter((id) => id !== note.id));
      }, 2000);
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
                <button type="button" onClick={() => void load("refresh")}>Try again</button>
              </div>
            </Show>
            <Show when={error() && notes().length === 0}>
              <ErrorState message={error() ?? "Could not load the timeline."} onRetry={() => void load("refresh")} />
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
                      reposting={repostingId() === note.id}
                      reposted={repostedIds().includes(note.id)}
                    />
                  )}
                </For>
              </div>
              <div class="pager">
                <button type="button" onClick={() => void load("older")} disabled={loadingMore()}>
                  {loadingMore() ? "Loading…" : "Load older"}
                </button>
              </div>
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
