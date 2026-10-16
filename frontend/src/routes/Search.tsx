import { createEffect, createSignal, For, Show } from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { apiCall, ApiError } from "../api/client";
import type { Note, UserLite } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName } from "../components/EmojiPicker";
import NoteCard from "../components/NoteCard";
import { NoteSkeletonList, RowSkeletonList } from "../components/Skeleton";

type Tab = "users" | "notes" | "tags";

/** Policy-aware search:
 * - users/search always (authenticated when signed in — Misskey requires it).
 * - notes/search-by-tag for hashtags (works with the scoped token).
 * - notes/search is implemented but instance-policy-dependent: a 400
 *   UNAVAILABLE means "disabled on this server", not "unsupported", and the
 *   UI says exactly that. */
export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTag = () =>
    typeof searchParams.tag === "string" ? searchParams.tag : "";
  const [tab, setTab] = createSignal<Tab>(initialTag() ? "tags" : "users");
  const [query, setQuery] = createSignal(initialTag());
  const [userResults, setUserResults] = createSignal<UserLite[]>([]);
  const [noteResults, setNoteResults] = createSignal<Note[]>([]);
  const [tagResults, setTagResults] = createSignal<Note[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [noteSearchDisabled, setNoteSearchDisabled] = createSignal(false);

  // Hashtag links route here (/search?tag=x). The router reuses this
  // component across tag clicks, so sync the form from the URL.
  createEffect(() => {
    const t = searchParams.tag;
    if (typeof t === "string" && t.length > 0) {
      setQuery(t);
      setTab("tags");
    }
  });

  const run = async () => {
    const q = query().trim().replace(/^#/, "");
    if (q.length === 0 || busy()) return;
    setBusy(true);
    setError(null);
    setNoteSearchDisabled(false);
    try {
      if (tab() === "users") {
        setUserResults(await apiCall<UserLite[]>("users/search", { query: q, limit: 20 }));
      } else if (tab() === "notes") {
        try {
          setNoteResults(await apiCall<Note[]>("notes/search", { query: q, limit: 20 }));
        } catch (err) {
          if (
            err instanceof ApiError &&
            err.status === 400 &&
            err.code === "UNAVAILABLE"
          ) {
            // Endpoint implemented, disabled by server policy.
            setNoteSearchDisabled(true);
            setNoteResults([]);
          } else {
            throw err;
          }
        }
      } else {
        setTagResults(
          await apiCall<Note[]>("notes/search-by-tag", { tag: q, limit: 20 }),
        );
        setSearchParams({ tag: q }, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div class="pagehead"><h1>Search</h1></div>
      <div class="pager" style={{ gap: "0.53em" }}>
        <button
          type="button"
          onClick={() => setTab("users")}
          aria-pressed={tab() === "users"}
          disabled={busy()}
        >
          Users
        </button>
        <button
          type="button"
          onClick={() => setTab("notes")}
          aria-pressed={tab() === "notes"}
          disabled={busy()}
        >
          Notes
        </button>
        <button
          type="button"
          onClick={() => setTab("tags")}
          aria-pressed={tab() === "tags"}
          disabled={busy()}
        >
          Tags
        </button>
      </div>
      <form
        class="row"
        style={{ padding: "0 1.07em 0.8em" }}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          type="text"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder={
            tab() === "users" ? "Username…" : tab() === "tags" ? "Tag (without #)…" : "Words in notes…"
          }
          aria-label="Search query"
          style={{ flex: 1 }}
        />
        <button type="submit" class="btn-primary" disabled={busy() || query().trim().length === 0}>
          {busy() ? "Searching…" : "Search"}
        </button>
      </form>
      <Show when={busy()}>
        <Show when={tab() === "users"} fallback={
          <NoteSkeletonList count={3} label="Searching…" />
        }>
          <RowSkeletonList count={3} label="Searching…" />
        </Show>
      </Show>
      <Show when={error()}>
        <div class="state" role="alert">
          <div class="errorbox">{error()}</div>
        </div>
      </Show>
      <Show when={noteSearchDisabled()}>
        <div class="state" role="status">
          <p>Note search is implemented on this server but disabled by its policy, so it cannot be used here.</p>
        </div>
      </Show>
      <Show when={tab() === "users"}>
        <div class="feed">
          <For each={userResults()}>
            {(u) => (
              <div class="drivefile">
                <div style={{ flex: 1 }}>
                  <A href={`/users/${u.id}`}><strong><DisplayName name={headNameOf(u)} packed={u.emojis} host={u.host} /></strong></A>
                  <Show when={hasRealDisplayName(u)}>
                    <div class="handle">{handleOf(u)}</div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={tab() === "notes"}>
        <div class="feed">
          <For each={noteResults()}>{(n) => <NoteCard note={n} />}</For>
        </div>
      </Show>
      <Show when={tab() === "tags"}>
        <div class="feed">
          <For each={tagResults()}>{(n) => <NoteCard note={n} />}</For>
        </div>
      </Show>
    </div>
  );
}
