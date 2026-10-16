// Branched replies for the note detail view (`docs/replies.md`). Each
// `ReplyList` fetches and pages the DIRECT children of one parent via
// `notes/replies` and owns its loading / error / cursor / dedupe state,
// so a failure in one branch never replaces or hides another. A
// `ReplyBranch` renders one child card plus its lazily-loaded child
// list. The tree derives from `Note.replyId` only — `renoteId` alone
// never creates a reply edge, and an embedded quote is never a child.

import { createEffect, createSignal, For, Show } from "solid-js";
import { apiCall, isUnsupportedError } from "../api/client";
import type { Note } from "../api/types";
import { appearNoteOf } from "../api/types";
import {
  mergeNotes,
  REPLIES_PAGE_SIZE,
  THREAD_MAX_DEPTH,
} from "../api/thread";
import NoteCard from "./NoteCard";
import ErrorState from "./ErrorState";
import InfiniteSentinel from "./InfiniteSentinel";
import { NoteSkeletonList } from "./Skeleton";

type PageMode = "initial" | "older";

export interface ReplyListProps {
  /** The parent whose direct children load here (wrapper or original —
   * the displayed/original id is always queried: the server lists no
   * replies for a pure-repost wrapper id). */
  parent: Note;
  /** Nesting level of the items in this list: the root list is 0, each
   * nested level adds one. Bounds the visual indent only. */
  depth?: number;
  /** Note ids on the path from the thread root through the parent
   * (parent inclusive): the cycle guard, never fetched through. */
  pathIds: string[];
  /** Locally created notes to show first (root list only): a successful
   * post appears instantly without refetching the branch, and dedupes
   * harmlessly once a server page contains the same id. */
  injected?: Note[];
}

export default function ReplyList(props: ReplyListProps) {
  const depth = () => props.depth ?? 0;
  const parentId = () => appearNoteOf(props.parent).id;
  const [items, setItems] = createSignal<Note[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<PageMode | null>(null);

  const visible = () => {
    const extra = props.injected ?? [];
    if (extra.length === 0) return items();
    const seen = new Set(items().map((n) => n.id));
    return [...extra.filter((n) => !seen.has(n.id)), ...items()];
  };

  // Generation guard: a reset (new parent) invalidates in-flight pages
  // so a slow response can never write into the wrong branch.
  let seq = 0;

  const loadPage = async (id: string, mode: PageMode) => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    const my = seq;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = items();
      const req: Record<string, unknown> = {
        noteId: id,
        limit: REPLIES_PAGE_SIZE,
      };
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>("notes/replies", req);
      if (my !== seq) return;
      const { merged, freshCount } = mergeNotes(current, page);
      // A page of only-duplicates means the cursor is stuck: stop instead
      // of paging the same window forever. Otherwise keep the current
      // paging behavior — a later page decides exhaustion.
      if (mode === "older" && freshCount === 0) setExhausted(true);
      setItems(merged);
      setFailedMode(null);
    } catch (err) {
      if (my !== seq) return;
      if (isUnsupportedError(err)) {
        setUnsupported(true);
      } else {
        // A branch failure never touches sibling branches or the parent
        // note; loaded replies stay visible and retry reuses the cursor.
        setError(err instanceof Error ? err.message : "Could not load replies.");
        setFailedMode(mode);
      }
    } finally {
      if (my === seq) {
        setLoading(false);
        setLoadingMore(false);
        setBusy(false);
      }
    }
  };

  const retry = () => {
    const id = parentId();
    if (id) void loadPage(id, failedMode() ?? "initial");
  };

  // Reload when the queried parent changes. Identity-compared: action
  // reconciliations replace the note object without changing its id, and
  // must not wipe the loaded branch.
  let loadedFor: string | null = null;
  createEffect(() => {
    const id = parentId();
    if (!id || id === loadedFor) return;
    loadedFor = id;
    seq++;
    setItems([]);
    setExhausted(false);
    setError(null);
    setUnsupported(false);
    setFailedMode(null);
    void loadPage(id, "initial");
  });

  return (
    <Show
      when={!unsupported()}
      fallback={
        <div class="state">
          <p>Replies aren't available on this server.</p>
        </div>
      }
    >
      <Show
        when={!loading()}
        fallback={<NoteSkeletonList count={2} label="Loading replies…" />}
      >
        <Show when={error() && items().length > 0}>
          <div class="state" role="alert">
            <div class="errorbox">{error()}</div>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        </Show>
        <Show when={error() && items().length === 0}>
          <ErrorState
            message={error() ?? "Could not load replies."}
            onRetry={retry}
          />
        </Show>
        <Show when={visible().length > 0}>
          <div class={depth() === 0 ? "feed" : "reply-nested"}>
            <For each={visible()}>
              {(child) => (
                <ReplyBranch
                  note={child}
                  depth={depth()}
                  pathIds={props.pathIds}
                />
              )}
            </For>
          </div>
          <Show
            when={!exhausted()}
            fallback={
              <div class="state" role="status">
                <p>You're caught up.</p>
              </div>
            }
          >
            <Show when={loadingMore()}>
              <NoteSkeletonList count={2} label="Loading older replies…" />
            </Show>
            <InfiniteSentinel
              canLoad={() =>
                !busy() &&
                !loading() &&
                !exhausted() &&
                items().length > 0
              }
              onLoad={() => void loadPage(parentId(), "older")}
            />
          </Show>
        </Show>
        <Show when={!error() && visible().length === 0}>
          <div class="state">
            <p>No replies yet.</p>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

/** One child note plus its expandable child list. The card stays
 * read-only (as before): its time and reply-count links open the note's
 * own detail view, where the full actions are available. */
export function ReplyBranch(props: {
  note: Note;
  depth: number;
  pathIds: string[];
}) {
  const shown = () => appearNoteOf(props.note);
  // A server echo of an id already above us never expands: the card
  // still links to its detail view, but no branch recurses into a loop.
  const cycled = () => props.pathIds.includes(shown().id);
  const tooDeep = () => props.depth >= THREAD_MAX_DEPTH;
  const [expanded, setExpanded] = createSignal(false);
  const childPath = () => [...props.pathIds, shown().id];
  const count = () => shown().repliesCount;

  return (
    <div class="reply-branch">
      <NoteCard note={props.note} showReplyContext={false} />
      <Show when={!cycled() && !tooDeep()}>
        <div class="reply-toggle-row">
          <button
            type="button"
            class="reply-toggle"
            aria-expanded={expanded()}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded()
              ? "Hide replies"
              : count() > 0
                ? `Show replies (${count()})`
                : "Show replies"}
          </button>
        </div>
        <Show when={expanded()}>
          <ReplyList
            parent={props.note}
            depth={props.depth + 1}
            pathIds={childPath()}
          />
        </Show>
      </Show>
      <Show when={!cycled() && tooDeep()}>
        <div class="state" role="status">
          <p>Thread is too deep to expand here.</p>
        </div>
      </Show>
    </div>
  );
}
