import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { apiCall, isUnsupportedError } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { appearNoteOf, withReaction } from "../api/types";
import {
  CONVERSATION_PAGE_SIZE,
  MAX_ANCESTOR_WALK,
  orderAncestors,
} from "../api/thread";
import { captureNote } from "../api/stream";
import { useAuth } from "../state/auth";
import Composer from "../components/Composer";
import ErrorState from "../components/ErrorState";
import NoteCard from "../components/NoteCard";
import ReplyList from "../components/ReplyList";
import { NoteSkeletonList } from "../components/Skeleton";

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
  const [replyPosted, setReplyPosted] = createSignal(false);
  // Ancestor chain above the selected note (oldest-first), loaded from
  // `notes/conversation` for the displayed/original note.
  const [ancestors, setAncestors] = createSignal<Note[]>([]);
  const [ancestorsLoading, setAncestorsLoading] = createSignal(true);
  const [ancestorsError, setAncestorsError] = createSignal<string | null>(null);
  const [ancestorsIncomplete, setAncestorsIncomplete] = createSignal(false);
  // Locally posted replies render first in the root list without
  // refetching the branch (see `ReplyList` `injected`).
  const [injected, setInjected] = createSignal<Note[]>([]);

  // Route generation: a navigation invalidates every in-flight request
  // for the previous id so delayed responses can never overwrite the
  // newly selected thread.
  let routeSeq = 0;

  const load = async (id: string) => {
    const my = routeSeq;
    setLoading(true);
    setError(null);
    try {
      const found = await apiCall<Note>("notes/show", { noteId: id });
      if (my !== routeSeq) return;
      setNote(found);
      void loadAncestors(appearNoteOf(found), found, my);
    } catch (err) {
      if (my !== routeSeq) return;
      setNote(null);
      setError(err instanceof Error ? err.message : "Could not open the note.");
    } finally {
      if (my === routeSeq) setLoading(false);
    }
  };

  const loadAncestors = async (displayed: Note, pageNote: Note, my: number) => {
    setAncestorsLoading(true);
    setAncestorsError(null);
    try {
      const seen = new Set<string>();
      const collected: Note[] = [];
      let offset = 0;
      for (;;) {
        const page = await apiCall<Note[]>("notes/conversation", {
          noteId: displayed.id,
          limit: CONVERSATION_PAGE_SIZE,
          offset,
        });
        if (my !== routeSeq) return;
        let grew = false;
        for (const n of page) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            collected.push(n);
            grew = true;
          }
        }
        if (page.length < CONVERSATION_PAGE_SIZE) break;
        // A server that ignores `offset` repeats the same page: stop
        // instead of looping forever. The walk itself is bounded too.
        if (!grew || collected.length >= MAX_ANCESTOR_WALK) break;
        offset += page.length;
      }
      if (my !== routeSeq) return;
      const ordered = orderAncestors(displayed.replyId, collected);
      setAncestors(ordered.ancestors);
      setAncestorsIncomplete(ordered.incomplete);
    } catch (err) {
      if (my !== routeSeq) return;
      if (isUnsupportedError(err)) {
        // No conversation endpoint on this server: fall back to the
        // one-level parent packed on `notes/show`, as before.
        const parent = pageNote.reply;
        setAncestors(parent ? [parent] : []);
        setAncestorsIncomplete(
          !!displayed.replyId && (!parent || !!parent.replyId),
        );
      } else {
        // An ancestor failure never touches the selected note; retry
        // reloads only the context.
        setAncestorsError(
          err instanceof Error ? err.message : "Could not load reply context.",
        );
      }
    } finally {
      if (my === routeSeq) setAncestorsLoading(false);
    }
  };

  const retryAncestors = () => {
    const current = note();
    if (current) void loadAncestors(appearNoteOf(current), current, routeSeq);
  };

  const resetForId = (id: string) => {
    if (!id) return;
    // Direct navigation /notes/a -> /notes/b reuses this component: bump
    // the generation, reset page-specific state, and reload instead of
    // relying on mount only.
    routeSeq++;
    setNote(null);
    setAncestors([]);
    setAncestorsIncomplete(false);
    setAncestorsError(null);
    setInjected([]);
    setReposted(false);
    setQuoting(false);
    setConfirmDelete(false);
    setReplyPosted(false);
    void load(id);
  };

  // The router reuses this component when only :id changes, so the
  // route param itself drives (re)loading — not mount, and not the
  // loaded note. Any :id change resets immediately (bumping the
  // generation, which discards in-flight responses for the old id), so
  // a slow request can never paint the previous thread.
  let loadedRoute: string | null = null;
  createEffect(() => {
    const id = params.id ?? "";
    if (!id || id === loadedRoute) return;
    loadedRoute = id;
    resetForId(id);
  });

  const refresh = () => {
    // Manual refresh is the fallback for remote changes: reload the
    // selected note, its ancestors, and (by remount) its reply branches.
    const id = params.id ?? "";
    if (id) resetForId(id);
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
    // A successful post appears instantly at the top of the root branch
    // (newest-first) without disturbing loaded branches; the composer
    // already targets the displayed note's id as `replyId`.
    setReplyPosted(true);
    setInjected((current) =>
      current.some((n) => n.id === created.id) ? current : [created, ...current],
    );
    setNote((n) => (n ? { ...n, repliesCount: n.repliesCount + 1 } : n));
  };

  // Ids from the thread root through the displayed note (inclusive): the
  // root branch's cycle guard. Ancestors render oldest-first above.
  const threadPath = () => {
    const current = note();
    if (!current) return [];
    return [
      ...ancestors().map((a) => appearNoteOf(a).id),
      appearNoteOf(current).id,
    ];
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
                <Show
                  when={
                    ancestorsLoading() ||
                    ancestors().length > 0 ||
                    ancestorsError()
                  }
                >
                  <div class="pagehead">
                    <h1>Thread</h1>
                  </div>
                </Show>
                <Show when={ancestorsLoading() && ancestors().length === 0}>
                  <NoteSkeletonList count={1} label="Loading reply context…" />
                </Show>
                <Show when={ancestors().length > 0}>
                  <div class="feed thread-ancestors">
                    <For each={ancestors()}>
                      {(ancestor) => (
                        <NoteCard note={ancestor} foldText={false} />
                      )}
                    </For>
                  </div>
                </Show>
                <Show
                  when={
                    !ancestorsLoading() &&
                    !ancestorsError() &&
                    ancestorsIncomplete()
                  }
                >
                  <div class="state" role="status">
                    <p>Earlier reply context unavailable.</p>
                  </div>
                </Show>
                <Show when={ancestorsError()}>
                  <ErrorState
                    message={
                      ancestorsError() ?? "Could not load reply context."
                    }
                    onRetry={retryAncestors}
                  />
                </Show>
                <NoteCard
                  note={current()}
                  onToggleReaction={auth.token() ? setReaction : undefined}
                  onRepost={auth.token() ? repost : undefined}
                  onUnrepost={auth.token() ? unrepost : undefined}
                  onQuote={auth.token() ? () => setQuoting(true) : undefined}
                  reposting={reposting()}
                  reposted={reposted()}
                  onChanged={refreshPage}
                  detail
                  foldText={false}
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
                <div class="state">
                  <p>
                    Every direct reply, newest first. Expand a reply to
                    see its own replies, or open it for its full thread.
                  </p>
                </div>
                <Show when={replyPosted()}>
                  <div class="state" role="status"><p>Reply posted.</p></div>
                </Show>
                <ReplyList
                  parent={current()}
                  pathIds={threadPath()}
                  injected={injected()}
                />
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
