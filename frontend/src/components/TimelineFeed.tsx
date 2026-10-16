import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { apiCall, ApiError } from "../api/client";
import type { CreatedNoteResponse, Note } from "../api/types";
import { appearNoteOf, collapseReposts, withReaction } from "../api/types";
import { computeFeedThreadLinks } from "../api/thread";
import {
  captureNote,
  subscribeChannel,
  useStreamState,
  STREAMING_SUPPORTED,
} from "../api/stream";
import type { ChannelHandle } from "../api/stream";
import { useAuth } from "../state/auth";
import Composer from "./Composer";
import ErrorState from "./ErrorState";
import InfiniteSentinel from "./InfiniteSentinel";
import NoteCard from "./NoteCard";
import { NoteSkeletonList } from "./Skeleton";
import StreamBadge from "./StreamBadge";

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

/** Feed endpoint -> streaming channel. Unknown endpoints get no socket. */
function channelFor(
  endpoint: string,
  extraParams?: Record<string, unknown>,
): { channel: string; params?: Record<string, unknown>; needsAuth: boolean } | null {
  if (endpoint === "notes/timeline")
    return { channel: "homeTimeline", needsAuth: true };
  if (endpoint === "notes/local-timeline")
    return { channel: "localTimeline", needsAuth: false };
  if (endpoint === "notes/global-timeline")
    return { channel: "globalTimeline", needsAuth: false };
  if (endpoint === "antennas/notes") {
    const antennaId = extraParams?.antennaId;
    if (typeof antennaId === "string" && antennaId)
      return { channel: "antenna", params: { antennaId }, needsAuth: true };
  }
  return null;
}

function isNoteLike(value: unknown): value is Note {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

// Only the newest notes get live capture: reactions/poll/deletion updates
// for notes far down the list arrive via the next refresh instead.
const CAPTURE_LIMIT = 50;

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
  const [quotingId, setQuotingId] = createSignal<string | null>(null);
  // The quote target (original id) for the open composer. Tracked
  // separately because the composer is keyed by the feed item the user
  // acted on: several items can share one target (a repost wrapper and
  // the original), and only the acted-on item shows the composer.
  const [quoteTargetId, setQuoteTargetId] = createSignal<string | null>(null);
  const [channelHandle, setChannelHandle] = createSignal<ChannelHandle | null>(null);
  const [streamNonce, setStreamNonce] = createSignal(0);
  const stream = useStreamState();

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
    setQuotingId(null);
    setQuoteTargetId(null);
    void load("initial");
  });

  // Live updates (Stage A). The socket only *adds* events: paging +
  // refresh above work with no socket, and every insert dedupes by id
  // inside the updater, so a streamed note racing a pending API response
  // can never appear twice.
  const insertStreamedNote = (note: Note) => {
    setNotes((current) =>
      current.some((n) => n.id === note.id) ? current : [note, ...current],
    );
  };

  createEffect(() => {
    const fingerprint = JSON.stringify({
      endpoint: props.endpoint,
      extra: props.extraParams ?? {},
    });
    const token = auth.token();
    streamNonce();
    void fingerprint;
    // Untracked: this effect *sets* the handle, so reading it tracked
    // would retrigger the effect forever.
    untrack(() => channelHandle())?.dispose();
    setChannelHandle(null);
    if (!STREAMING_SUPPORTED) return;
    const spec = channelFor(props.endpoint, props.extraParams);
    if (!spec) return;
    if (spec.needsAuth && !token) return;
    setChannelHandle(
      subscribeChannel(
        spec.channel,
        spec.params,
        {
          onEvent: (type, body) => {
            if (type === "note" && isNoteLike(body)) insertStreamedNote(body);
          },
        },
        token,
      ),
    );
  });

  // Live capture for the newest visible notes: reactions/poll votes
  // reconcile from the server, deletions remove the note in place.
  const captured = new Map<string, () => void>();
  let captureToken: string | null | undefined = undefined;
  let capturePrimed = false;
  createEffect(() => {
    const token = auth.token();
    const ids = notes()
      .slice(0, CAPTURE_LIMIT)
      .map((n) => n.id);
    const wanted = new Set(ids);
    if (capturePrimed && token !== captureToken) {
      // Session changed (sign-in/out): captures hold the old token, so
      // release everything and recapture below under the new one.
      for (const release of captured.values()) release();
      captured.clear();
    }
    captureToken = token;
    capturePrimed = true;
    for (const [id, release] of [...captured]) {
      if (!wanted.has(id)) {
        release();
        captured.delete(id);
      }
    }
    for (const id of ids) {
      if (!captured.has(id)) {
        captured.set(
          id,
          captureNote(
            id,
            (update) => {
              if (update.type === "deleted") {
                setNotes((current) => current.filter((n) => n.id !== id));
                captured.get(id)?.();
                captured.delete(id);
              } else {
                void refreshNote(id);
              }
            },
            auth.token(),
          ),
        );
      }
    }
  });

  onCleanup(() => {
    untrack(() => channelHandle())?.dispose();
    setChannelHandle(null);
    for (const release of captured.values()) release();
    captured.clear();
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

  // Repost collapsing: when the loaded items contain an original plus one
  // or more pure reposts of it, only the first repost (feed order) shows;
  // the original and later copies hide. Quotes never collapse — they carry
  // their own commentary and are separate notes. The raw `notes` array
  // keeps every item (paging cursors and reconciliation use it); this memo
  // only decides visibility and banner names, so `<For>` row identity is
  // untouched and no card remounts on collapse changes.
  const collapse = createMemo(() => collapseReposts(notes()));

  // Stable row identity: ids are plain strings that never change across
  // server reconciliation, so a refreshed note updates its row in place
  // instead of remounting the whole card (no flicker, no lost popup or
  // composer state on like/unlike). Rows resolve the current object
  // through `byId` on every read.
  const feedIndex = createMemo(() => {
    const byId = new Map<string, Note>();
    for (const n of notes()) byId.set(n.id, n);
    return { ids: [...byId.keys()], byId };
  });

  // Avatar-column thread links (reference-client behavior): adjacent
  // visible rows where the newer directly replies to the older share one
  // connected column, so a reply directly under its parent reads as one
  // thread instead of two loose posts. Computed on the post-collapse
  // visible order — hidden repost copies never break a run — and purely
  // from `replyId`, so quotes/renotes alone never link.
  const visibleIds = createMemo(() =>
    feedIndex().ids.filter((id) => collapse().reps.has(id)),
  );
  const threadLinks = createMemo(() => {
    const byId = feedIndex().byId;
    const ordered: Note[] = [];
    for (const id of visibleIds()) {
      const n = byId.get(id);
      if (n) ordered.push(n);
    }
    return computeFeedThreadLinks(ordered);
  });
  const linkById = createMemo(() => {
    const ids = visibleIds();
    const links = threadLinks();
    const m = new Map<string, { above: boolean; below: boolean }>();
    ids.forEach((id, i) =>
      m.set(id, {
        above: links.connectedAbove[i] ?? false,
        below: links.connectedBelow[i] ?? false,
      }),
    );
    return m;
  });

  const setReaction = async (note: Note, reaction: string | null) => {
    // Set-semantics: the caller's desired end state. The update applies
    // locally first (instant, no disabled flash), then runs delete (the
    // server rejects reacting twice with ALREADY_REACTED) + create, then
    // reconciles from the server. In-flight clicks are ignored by the
    // guard above — controls never take a disabled style mid-flight.
    if (!auth.token() || reactingId() !== null) return;
    const current = note.myReaction;
    if (!current && !reaction) return;
    if (current === reaction) return;
    setReactingId(note.id);
    setNotes((items) =>
      items.map((n) => (n.id === note.id ? withReaction(n, reaction) : n)),
    );
    try {
      if (current) {
        await apiCall<undefined>("notes/reactions/delete", { noteId: note.id });
      }
      if (reaction) {
        await apiCall<undefined>("notes/reactions/create", { noteId: note.id, reaction });
      }
      await refreshNote(note.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaction failed.");
      // Roll the optimistic update back to server truth.
      await refreshNote(note.id);
    } finally {
      setReactingId(null);
    }
  };

  const quote = (wrapperId: string, target: Note) => {
    if (!auth.token()) return;
    // Toggle the inline quote composer under the acted-on item only;
    // quoting a repost targets the original, exactly like a fresh repost
    // would. The composer key is the wrapper id so other copies of the
    // same original never open a second composer.
    if (quotingId() === wrapperId) {
      setQuotingId(null);
      setQuoteTargetId(null);
    } else {
      setQuotingId(wrapperId);
      setQuoteTargetId(target.id);
    }
  };

  const onQuoted = (created: Note) => {
    setQuotingId(null);
    setQuoteTargetId(null);
    setNotes((current) => [created, ...current]);
  };

  const unrepost = async (note: Note) => {
    if (!auth.token() || repostingId() !== null) return;
    // notes/unrenote takes the ORIGINAL note's id and deletes my renotes
    // of it (verified against Misskey notes/unrenote.ts). Callers pass the
    // displayed note, which is already the original for pure reposts.
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
    // no-op, so double clicks can never create duplicates. `note` is the
    // displayed (original) note — renoting a pure-renote wrapper is
    // rejected by the server, so the card never passes one.
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
        <StreamBadge channelStatus={() => channelHandle()?.status() ?? "disabled"} />
        <Show when={stream.status() === "error"}>
          <button type="button" onClick={() => setStreamNonce((n) => n + 1)}>
            Retry live updates
          </button>
        </Show>
        <button type="button" onClick={() => void load("refresh")} disabled={loading() || loadingMore()}>
          Refresh
        </button>
      </div>

      <Show when={props.showComposer && auth.token()}>
        <Composer onPosted={(created) => setNotes((current) => [created, ...current])} />
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
                <For each={feedIndex().ids}>
                  {(id) => {
                    // One reactive scope per stable id: `note()` always
                    // resolves the latest reconciled object, and `target()`
                    // derives from it, so counts/reactions update without
                    // ever remounting this row.
                    const note = () => feedIndex().byId.get(id)!;
                    // Actions always target the displayed note: for a pure
                    // repost that is the renoted original (repost state is
                    // keyed by original id).
                    const target = createMemo(() => appearNoteOf(note()));
                    // Thread-column flags for this row (post-collapse visible
                    // order): linked-below is the child, linked-above its
                    // parent. Reactive reads relink on streaming inserts
                    // without remounting the row.
                    const link = () => linkById().get(id);
                    const linkedAbove = () => link()?.above ?? false;
                    const linkedBelow = () => link()?.below ?? false;
                    const inThread = () => linkedAbove() || linkedBelow();
                    return (
                      // Collapsed copies (hidden originals, non-first
                      // reposts) render nothing; the representative reads
                      // the collapse memo reactively in place.
                      <Show when={collapse().reps.has(id)}>
                        <>
                          <div
                            class="feed-row"
                            classList={{
                              "feed-row-thread": inThread(),
                              "feed-row-first": linkedBelow() && !linkedAbove(),
                              "feed-row-last": linkedAbove() && !linkedBelow(),
                              "feed-row-middle": linkedAbove() && linkedBelow(),
                            }}
                          >
                            <NoteCard
                              note={note()}
                              onToggleReaction={auth.token() ? setReaction : undefined}
                              onRepost={auth.token() ? repost : undefined}
                              onUnrepost={auth.token() ? unrepost : undefined}
                              onQuote={auth.token() ? () => quote(id, target()) : undefined}
                              reposting={repostingId() === target().id}
                              reposted={repostedIds().includes(target().id)}
                              renoters={collapse().renotersByRep.get(id)}
                              onChanged={() => void refreshNote(id)}
                            />
                          </div>
                          <Show when={quotingId() === id}>
                            <Composer renoteId={quoteTargetId() ?? target().id} onPosted={onQuoted} />
                          </Show>
                        </>
                      </Show>
                    );
                  }}
                </For>
              </div>
              <Show when={!exhausted()} fallback={
                <div class="state" role="status"><p>You're caught up.</p></div>
              }>
                <Show when={loadingMore()}>
                  <NoteSkeletonList count={2} label="Loading older notes…" />
                </Show>
                <InfiniteSentinel
                  canLoad={() =>
                    !busy() && !loading() && !exhausted() && !unsupported() && notes().length > 0
                  }
                  onLoad={() => void load("older")}
                />
              </Show>
            </Show>
            <Show when={!error() && notes().length === 0}>
              <div class="state"><p>No notes yet.</p></div>
            </Show>
          </>
        }>
          <NoteSkeletonList label={`Loading ${props.title.toLowerCase()}…`} />
        </Show>
      </Show>
    </div>
  );
}
