// Personal favorites (slice 4). Lists `i/favorites` newest first with
// cursor paging, and removes a favorite (`notes/favorites/delete`). Rows
// reuse NoteCard, so the post options menu works here too. Adding a
// favorite lives in the note menu.

import { createSignal, For, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import { isUnsupportedError } from "../api/client";
import { FAVORITES_PAGE, listFavorites, removeFavorite, type FavoriteRow } from "../api/favorites";
import { useAuth } from "../state/auth";
import NoteCard from "../components/NoteCard";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";

export default function Favorites() {
  const auth = useAuth();
  const [rows, setRows] = createSignal<FavoriteRow[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [more, setMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [removing, setRemoving] = createSignal<string | null>(null);

  const fail = (err: unknown, fallback: string) => {
    if (isUnsupportedError(err)) setUnsupported(true);
    else setError(err instanceof Error ? err.message : fallback);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listFavorites();
      setRows(page);
      setMore(page.length === FAVORITES_PAGE);
    } catch (err) {
      fail(err, "Could not load favorites.");
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    const last = rows()[rows().length - 1];
    if (!last || loading()) return;
    setLoading(true);
    try {
      const page = await listFavorites(last.id);
      setRows((list) => [...list, ...page]);
      setMore(page.length === FAVORITES_PAGE);
    } catch (err) {
      fail(err, "Could not load older favorites.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (row: FavoriteRow) => {
    if (removing() !== null) return;
    setRemoving(row.id);
    try {
      await removeFavorite(row.note.id);
      setRows((list) => list.filter((r) => r.id !== row.id));
    } catch (err) {
      fail(err, "Could not remove the favorite.");
    } finally {
      setRemoving(null);
    }
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  return (
    <div>
      <div class="pagehead">
        <h1>Favorites</h1>
        <Show when={auth.token() && !unsupported()}>
          <button type="button" onClick={() => void load()} disabled={loading()}>
            Refresh
          </button>
        </Show>
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show
          when={auth.token()}
          fallback={
            <div class="state">
              <p>You need to sign in to see your favorites.</p>
              <A href="/login">Sign in</A>
            </div>
          }
        >
          <Show
            when={!unsupported()}
            fallback={
              <div class="state">
                <p>Favorites are not available on this server.</p>
              </div>
            }
          >
            <Show when={!(loading() && rows().length === 0)} fallback={<LoadingState />}>
              <Show when={!(error() && rows().length === 0)} fallback={
                <ErrorState message={error() ?? "Could not load favorites."} onRetry={() => void load()} />
              }>
                <Show when={rows().length > 0} fallback={
                  <div class="state"><p>No favorites yet. Use a post's options menu to add one.</p></div>
                }>
                  <Show when={error()}>
                    <div class="state" role="alert">
                      <div class="errorbox">{error()}</div>
                    </div>
                  </Show>
                  <div class="feed">
                    <For each={rows()}>
                      {(row) => (
                        <div>
                          <NoteCard note={row.note} />
                          <div class="row">
                            <button
                              type="button"
                              disabled={removing() !== null}
                              onClick={() => void remove(row)}
                            >
                              Remove from favorites
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={more()}>
                    <div class="row">
                      <button type="button" disabled={loading()} onClick={() => void loadOlder()}>
                        {loading() ? "Loading…" : "Load older"}
                      </button>
                    </div>
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
