import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { appearNoteOf, withReaction } from "../api/types";
import { captureNote } from "../api/stream";
import { useAuth } from "../state/auth";
import Composer from "../components/Composer";
import ErrorState from "../components/ErrorState";
import NoteCard from "../components/NoteCard";
import { NoteSkeletonList } from "../components/Skeleton";

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

  const load = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setNote(await apiCall<Note>("notes/show", { noteId: id }));
    } catch (err) {
      setNote(null);
      setError(err instanceof Error ? err.message : "Could not open the note.");
    } finally {
      setLoading(false);
    }
  };

  const loadReplies = async (id: string, mode: RepliesLoadMode) => {
    if (repliesBusy()) return;
    if (mode === "older" && repliesExhausted()) return;
    setRepliesBusy(true);
    if (mode === "initial") setRepliesLoading(true);
    else setRepliesLoadingMore(true);
    setRepliesError(null);
    try {
      const current = replies();
      const req: Record<string, unknown> = { noteId: id, limit: REPLIES_PAGE_SIZE };
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

  const retryReplies = () => void loadReplies(params.id ?? "", repliesFailedMode() ?? "initial");

  const resetForId = (id: string) => {
    if (!id) return;
    // Direct navigation /notes/a -> /notes/b reuses this component: reset
    // page-specific state and reload instead of relying on mount only.
    setNote(null);
    setReplies([]);
    setRepliesExhausted(false);
    setReposted(false);
    setQuoting(false);
    setConfirmDelete(false);
    setReplyPosted(false);
    setRepliesFailedMode(null);
    void load(id);
    void loadReplies(id, "initial");
  };

  onMount(() => {
    resetForId(params.id ?? "");
  });

  // The router reuses this component when only :id changes: reload the
  // note, replies, and page-specific state instead of relying on mount.
  createEffect(() => {
    const id = params.id ?? "";
    if (!id) return;
    const current = note();
    if (!loading() && current && current.id !== id) resetForId(id);
    if (!loading() && !current && !error()) resetForId(id);
  });

  const refresh = () => {
    const current = note();
    if (current) void load(current.id);
  };

  // Quiet server reconciliation for streamed updates (no loading flash).
  const refreshQuiet = async (id: string) => {
    try {
      setNote(await apiCall<Note>("notes/show", { noteId: id }));
    } catch {
      // Keep current state; the next refresh corrects it.
    }
  };

  // Live capture for the open note: reactions/poll votes re-read the note
  // from the server, deletion switches to an explicit deleted state.
  // Replies have no streaming channel — the replies list still refreshes
  // manually.
  let capturedFor: string | null = null;
  let capturedToken: string | null | undefined = undefined;
  let releaseCapture: (() => void) | null = null;
  createEffect(() => {
    const id = params.id ?? "";
    const token = auth.token();
    if (!id) return;
    if (id === capturedFor && token === capturedToken) return;
    releaseCapture?.();
    releaseCapture = null;
    capturedFor = id;
    capturedToken = token;
    releaseCapture = captureNote(
      id,
      (update) => {
        if (update.type === "deleted") {
          setNote(null);
          setError("This note was deleted.");
        } else {
          void refreshQuiet(id);
        }
      },
      token,
    );
  });

  onCleanup(() => {
    releaseCapture?.();
    releaseCapture = null;
    capturedFor = null;
    capturedToken = undefined;
  });

  const refreshPage = async () => {
    // Reload the opened note by page id: actions target the displayed
    // (original) note, but the page itself stays on what was opened.
    const id = note()?.id ?? params.id;
    if (!id) return;
    try {
      setNote(await apiCall<Note>("notes/show", { noteId: id }));
    } catch {
      // Keep current state; counts refresh on next load.
    }
  };

  const setReaction = async (target: Note, reaction: string | null) => {
    // Set-semantics with an optimistic local update (instant, no disabled
    // flash), then delete (the server rejects reacting twice) + create,
    // then reconcile. In-flight clicks are ignored by the guard above.
    if (!auth.token() || reacting()) return;
    const current = target.myReaction;
    if (!current && !reaction) return;
    if (current === reaction) return;
    setReacting(true);
    setNote((n) => (n && n.id === target.id ? withReaction(n, reaction) : n));
    try {
      if (current) {
        await apiCall<undefined>("notes/reactions/delete", { noteId: target.id });
      }
      if (reaction) {
        await apiCall<undefined>("notes/reactions/create", { noteId: target.id, reaction });
      }
      await refreshPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction failed.");
      await refreshPage();
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
      await refreshPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repost failed.");
    } finally {
      setReposting(false);
    }
  };

  const unrepost = async (target: Note) => {
    if (!auth.token() || reposting()) return;
    if (!reposted()) return;
    setReposting(true);
    try {
      await apiCall<undefined>("notes/unrenote", { noteId: target.id });
      setReposted(false);
      await refreshPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo repost failed.");
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
        <button type="button" onClick={refresh} disabled={loading()}>Refresh</button>
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
                  onToggleReaction={auth.token() ? setReaction : undefined}
                  onRepost={auth.token() ? repost : undefined}
                  onUnrepost={auth.token() ? unrepost : undefined}
                  onQuote={auth.token() ? () => setQuoting(true) : undefined}
                  reposting={reposting()}
                  reposted={reposted()}
                  onChanged={refresh}
                  detail
                />
                {/* Quotes render inside the card above via NoteBody's embedded
                  quote card; a second full card here would duplicate it. */}
                <Show when={auth.token()}>
                  <Composer replyId={appearNoteOf(current()).id} onPosted={onReplyPosted} />
                  <Show when={quoting()}>
                    <div class="pager">
                      <button type="button" onClick={() => setQuoting(false)}>
                        Cancel quote
                      </button>
                    </div>
                    <Composer
                      renoteId={appearNoteOf(current()).id}
                      onPosted={() => {
                        setQuoting(false);
                        refresh();
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
                            onClick={() => void loadReplies(current().id, "older")}
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
                  <NoteSkeletonList count={2} label="Loading replies…" />
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
          <ErrorState message={error() ?? "Could not open the note."} onRetry={refresh} />
        </Show>
      }>
        <NoteSkeletonList count={1} label="Opening note…" />
      </Show>
      <div class="pager">
        <A class="action" href="/">Back to home</A>
      </div>
    </div>
  );
}
