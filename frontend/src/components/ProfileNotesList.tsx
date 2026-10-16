// Per-tab profile notes list (`docs/profile-handoff.md` §4).
// Mirrors the `ReplyList` per-branch pattern: each mounted instance owns
// its loading / error / cursor / dedupe / exhaustion state, so tab
// switches never mix cursors. The parent renders only the active tab's
// instance (a full reset on switch — explicitly allowed by the handoff).
//
// Tabs 1:1 with Misskey's own profile tabs (Featured omitted — see below):
// - Posts: top-level incl. quotes, no renotes, no replies
//   (`withReplies: false, withRenotes: false` — server-exact).
// - All posts: replies + renotes included (`withReplies: true`,
//   `withRenotes` left at its server default true — server-exact).
// - Media: NOT exclusionary. The server 400s `withReplies + withFiles`
//   together, so this pages the RAW items (`withReplies: true,
//   `withRenotes: true`) and filters `files.length > 0` at render.
//   The cursor comes from the raw last id; exhaustion fires on
//   raw-empty/all-duplicate (same convergence pattern as `mergeNotes`).
//   Pure reposts carry no files so they drop out naturally; quotes with
//   media stay.
//
// Featured (pinned) is NOT rendered: no pinned-note field was confirmed
// in the endpoint source reviewed, `UserDetailed` packs no pinned ids,
// and this machine has no live backend to probe `users/show` for one.
// Per the handoff, the tab ships absent (never faked) until Pinetree or
// a verified source lands it as its own slice.
//
// Pinetree still 404s `users/notes`: each tab keeps the honest
// unavailable state (per-tab, not page-level).

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiCall, isUnsupportedError } from "../api/client";
import type { Note } from "../api/types";
import { mergeNotes } from "../api/thread";
import ErrorState from "./ErrorState";
import InfiniteSentinel from "./InfiniteSentinel";
import NoteCard from "./NoteCard";
import { NoteSkeletonList } from "./Skeleton";

export type ProfileTab = "posts" | "all" | "media";

const PROFILE_NOTES_PAGE_SIZE = 20;

type ProfileNotesLoadMode = "initial" | "older";

function paramsFor(tab: ProfileTab, userId: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    userId,
    limit: PROFILE_NOTES_PAGE_SIZE,
  };
  if (tab === "posts") {
    base.withReplies = false;
    base.withRenotes = false;
  } else if (tab === "all") {
    base.withReplies = true;
  } else {
    base.withReplies = true;
    base.withRenotes = true;
  }
  return base;
}

export default function ProfileNotesList(props: { userId: string; tab: ProfileTab }) {
  const [raw, setRaw] = createSignal<Note[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<ProfileNotesLoadMode | null>(null);

  // Generation guard: a reset (new user or tab) invalidates in-flight
  // pages so a slow response can never write into the wrong tab.
  let seq = 0;

  const visible = createMemo(() => {
    const items = raw();
    if (props.tab === "media") {
      return items.filter((n) => (n.files?.length ?? 0) > 0);
    }
    return items;
  });

  const load = async (userId: string, tab: ProfileTab, mode: ProfileNotesLoadMode) => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    const my = seq;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = raw();
      const req = paramsFor(tab, userId);
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>("users/notes", req);
      if (my !== seq) return;
      setUnsupported(false);
      const { merged, freshCount } = mergeNotes(current, page);
      // A page of only-duplicates means the cursor is stuck: stop
      // instead of paging the same window forever (media filtering
      // happens at render, so the cursor always advances on raw ids).
      if (mode === "older" && freshCount === 0) setExhausted(true);
      setRaw(merged);
      setFailedMode(null);
    } catch (err) {
      if (my !== seq) return;
      if (isUnsupportedError(err)) {
        setUnsupported(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not load notes.");
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
    const id = props.userId;
    if (id) void load(id, props.tab, failedMode() ?? "initial");
  };

  // Reload when the user or tab changes. Identity-compared so action
  // reconciliations (new note objects, same ids) never wipe the list.
  let loadedFor: string | null = null;
  createEffect(() => {
    const key = `${props.userId}::${props.tab}`;
    if (!props.userId || key === loadedFor) return;
    loadedFor = key;
    seq++;
    setRaw([]);
    setExhausted(false);
    setError(null);
    setUnsupported(false);
    setFailedMode(null);
    void load(props.userId, props.tab, "initial");
  });

  const emptyLabel = () =>
    props.tab === "media" ? "No media yet." : "No notes yet.";

  return (
    <Show when={unsupported()} fallback={
      <Show when={loading()} fallback={
        <>
          <Show when={error() && raw().length > 0}>
            <div class="state" role="alert">
              <div class="errorbox">{error()}</div>
              <button type="button" onClick={retry}>Try again</button>
            </div>
          </Show>
          <Show when={error() && raw().length === 0}>
            <ErrorState
              message={error() ?? "Could not load notes."}
              onRetry={retry}
            />
          </Show>
          <Show when={visible().length > 0}>
            <div class="feed">
              <For each={visible()}>
                {(n) => <NoteCard note={n} />}
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
                  !busy() && !loading() && !exhausted()
                  && !unsupported() && raw().length > 0
                }
                onLoad={() => void load(props.userId, props.tab, "older")}
              />
            </Show>
          </Show>
          <Show when={!error() && visible().length === 0}>
            <div class="state"><p>{emptyLabel()}</p></div>
          </Show>
        </>
      }>
        <NoteSkeletonList label="Loading notes…" />
      </Show>
    }>
      <div class="state" role="status">
        <p>Notes are not available on this server.</p>
      </div>
    </Show>
  );
}
