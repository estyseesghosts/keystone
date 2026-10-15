import { createSignal, For, onMount, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { useAuth } from "../state/auth";
import Composer from "../components/Composer";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import NoteCard from "../components/NoteCard";

const REPLIES_PAGE_SIZE = 20;

type RepliesLoadMode = "initial" | "older";

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
  const [replies, setReplies] = createSignal<Note[]>([]);
  const [repliesLoading, setRepliesLoading] = createSignal(true);
  const [repliesLoadingMore, setRepliesLoadingMore] = createSignal(false);
  const [repliesBusy, setRepliesBusy] = createSignal(false);
  const [repliesError, setRepliesError] = createSignal<string | null>(null);
  const [repliesExhausted, setRepliesExhausted] = createSignal(false);
  const [repliesFailedMode, setRepliesFailedMode] = createSignal<RepliesLoadMode | null>(null);
  const [replyPosted, setReplyPosted] = createSignal(false);

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

  const loadReplies = async (mode: RepliesLoadMode) => {
    if (repliesBusy()) return;
    if (mode === "older" && repliesExhausted()) return;
    setRepliesBusy(true);
    if (mode === "initial") setRepliesLoading(true);
    else setRepliesLoadingMore(true);
    setRepliesError(null);
    try {
      const current = replies();
      const req: Record<string, unknown> = { noteId: params.id, limit: REPLIES_PAGE_SIZE };
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>("notes/replies", req);
      if (mode === "older") {
        const seen = new Set(current.map((n) => n.id));
        const fresh: Note[] = [];
        for (const n of page) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            fresh.push(n);
          }
        }
        if (fresh.length === 0) setRepliesExhausted(true);
        setReplies([...current, ...fresh]);
      } else {
        const seen = new Set<string>();
        setReplies(
          page.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          }),
        );
        setRepliesExhausted(false);
      }
      setRepliesFailedMode(null);
    } catch (err) {
      // A replies failure never touches the parent note; already-loaded
      // replies stay visible and retry reuses the same cursor.
      setRepliesError(err instanceof Error ? err.message : "Could not load replies.");
      setRepliesFailedMode(mode);
    } finally {
      setRepliesLoading(false);
      setRepliesLoadingMore(false);
      setRepliesBusy(false);
    }
  };

  const retryReplies = () => void loadReplies(repliesFailedMode() ?? "initial");

  onMount(() => {
    void load();
    void loadReplies("initial");
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
    // Persistent repost state: once reposted in this view, further clicks
    // are no-ops so no duplicate renote can be created.
    if (reposted()) return;
    setReposting(true);
    try {
      await apiCall<CreatedNoteResponse>("notes/create", { renoteId: target.id });
      setReposted(true);
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

  const onReplyPosted = (created: Note) => {
    setReplyPosted(true);
    setReplies((current) =>
      current.some((n) => n.id === created.id) ? current : [created, ...current],
    );
    setNote((n) => (n ? { ...n, repliesCount: n.repliesCount + 1 } : n));
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
                  <Composer replyId={current().id} onPosted={onReplyPosted} />
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
                <div class="pagehead"><h1>Replies</h1></div>
                <div class="state"><p>Direct replies (may be partial).</p></div>
                <Show when={replyPosted()}>
                  <div class="state" role="status"><p>Reply posted.</p></div>
                </Show>
                <Show when={repliesLoading()} fallback={
                  <>
                    <Show when={repliesError() && replies().length > 0}>
                      <div class="state" role="alert">
                        <div class="errorbox">{repliesError()}</div>
                        <button type="button" onClick={retryReplies}>Try again</button>
                      </div>
                    </Show>
                    <Show when={repliesError() && replies().length === 0}>
                      <ErrorState
                        message={repliesError() ?? "Could not load replies."}
                        onRetry={retryReplies}
                      />
                    </Show>
                    <Show when={replies().length > 0}>
                      <div class="feed">
                        <For each={replies()}>
                          {(reply) => <NoteCard note={reply} />}
                        </For>
                      </div>
                      <Show when={!repliesExhausted()}>
                        <div class="pager">
                          <button
                            type="button"
                            onClick={() => void loadReplies("older")}
                            disabled={repliesLoadingMore()}
                          >
                            {repliesLoadingMore() ? "Loading…" : "Load older replies"}
                          </button>
                        </div>
                      </Show>
                    </Show>
                    <Show when={!repliesError() && replies().length === 0}>
                      <div class="state"><p>No replies yet.</p></div>
                    </Show>
                  </>
                }>
                  <LoadingState label="Loading replies…" />
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
