import { createSignal, onMount, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { useAuth } from "../state/auth";
import Composer from "../components/Composer";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import NoteCard from "../components/NoteCard";

export default function NoteDetail() {
  const params = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [note, setNote] = createSignal<Note | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [reacting, setReacting] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [quoting, setQuoting] = createSignal(false);
  const [reposting, setReposting] = createSignal(false);
  const [reposted, setReposted] = createSignal(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setNote(await apiCall<Note>("notes/show", { noteId: params.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the note.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void load();
  });

  const toggleReaction = async (target: Note) => {
    if (!auth.token() || reacting()) return;
    setReacting(true);
    try {
      if (target.myReaction) {
        await apiCall<undefined>("notes/reactions/delete", { noteId: target.id });
        setNote((n) => (n && n.id === target.id ? { ...n, myReaction: null } : n));
      } else {
        await apiCall<undefined>("notes/reactions/create", { noteId: target.id, reaction: "❤️" });
        setNote((n) => (n && n.id === target.id ? { ...n, myReaction: "❤️" } : n));
      }
      // Refresh counts from the server without losing the note on failure.
      try {
        setNote(await apiCall<Note>("notes/show", { noteId: target.id }));
      } catch {
        // Keep the optimistic state.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction failed.");
    } finally {
      setReacting(false);
    }
  };

  const repost = async (target: Note) => {
    if (!auth.token() || reposting()) return;
    setReposting(true);
    try {
      await apiCall<CreatedNoteResponse>("notes/create", { renoteId: target.id });
      setReposted(true);
      window.setTimeout(() => setReposted(false), 2000);
      try {
        setNote(await apiCall<Note>("notes/show", { noteId: target.id }));
      } catch {
        // Keep current state; counts refresh on next load.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repost failed.");
    } finally {
      setReposting(false);
    }
  };

  const remove = async () => {
    const current = note();
    if (!current || deleting()) return;
    setDeleting(true);
    try {
      await apiCall<undefined>("notes/delete", { noteId: current.id });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the note.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const isOwn = () => {
    const current = note();
    return !!current && !!auth.me() && auth.me()!.id === current.userId;
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Note</h1>
        <button type="button" onClick={() => void load()} disabled={loading()}>Refresh</button>
      </div>
      <Show when={loading()} fallback={
        <Show when={error() && !note()} fallback={
          <Show when={note()}>
            {(current) => (
              <>
                <Show when={error()}>
                  <div class="state" role="alert">
                    <div class="errorbox">{error()}</div>
                  </div>
                </Show>
                <Show when={current().reply}>
                  <div class="pagehead"><h1>Replied to</h1></div>
                  <NoteCard note={current().reply!} />
                </Show>
                <NoteCard
                  note={current()}
                  onToggleReaction={auth.token() ? toggleReaction : undefined}
                  reacting={reacting()}
                  onRepost={auth.token() ? repost : undefined}
                  reposting={reposting()}
                  reposted={reposted()}
                  detail
                />
                <Show when={current().renote}>
                  <div class="pagehead"><h1>Renoted</h1></div>
                  <NoteCard note={current().renote!} />
                </Show>
                <Show when={auth.token()}>
                  <Composer replyId={current().id} onPosted={() => void load()} />
                  <div class="pager">
                    <button type="button" onClick={() => setQuoting((v) => !v)}>
                      {quoting() ? "Cancel quote" : "Quote this note"}
                    </button>
                  </div>
                  <Show when={quoting()}>
                    <Composer
                      renoteId={current().id}
                      onPosted={() => {
                        setQuoting(false);
                        void load();
                      }}
                    />
                  </Show>
                </Show>
                <Show when={isOwn()}>
                  <div class="pager">
                    <Show when={confirmDelete()} fallback={
                      <button type="button" onClick={() => setConfirmDelete(true)}>Delete my note</button>
                    }>
                      <button type="button" onClick={() => void remove()} disabled={deleting()}>
                        {deleting() ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </Show>
        }>
          <ErrorState message={error() ?? "Could not open the note."} onRetry={() => void load()} />
        </Show>
      }>
        <LoadingState label="Opening note…" />
      </Show>
      <div class="pager">
        <A class="action" href="/">Back to home</A>
      </div>
    </div>
  );
}
