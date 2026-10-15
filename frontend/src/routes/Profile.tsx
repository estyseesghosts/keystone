import { createSignal, For, onMount, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { apiCall, ApiError } from "../api/client";
import type { Note, UserDetailed } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import NoteCard from "../components/NoteCard";

const PROFILE_NOTES_PAGE_SIZE = 20;

type ProfileNotesLoadMode = "initial" | "older" | "refresh";

export default function Profile() {
  const params = useParams();
  const auth = useAuth();
  const [user, setUser] = createSignal<UserDetailed | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [userNotes, setUserNotes] = createSignal<Note[]>([]);
  const [notesLoading, setNotesLoading] = createSignal(true);
  const [notesLoadingMore, setNotesLoadingMore] = createSignal(false);
  const [notesBusy, setNotesBusy] = createSignal(false);
  const [notesError, setNotesError] = createSignal<string | null>(null);
  const [notesUnsupported, setNotesUnsupported] = createSignal(false);
  const [notesExhausted, setNotesExhausted] = createSignal(false);
  const [notesFailedMode, setNotesFailedMode] = createSignal<ProfileNotesLoadMode | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUser(await apiCall<UserDetailed>("users/show", { userId: params.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the profile.");
    } finally {
      setLoading(false);
    }
  };

  const loadNotes = async (mode: ProfileNotesLoadMode) => {
    if (notesBusy()) return;
    if (mode === "older" && notesExhausted()) return;
    setNotesBusy(true);
    if (mode === "initial") setNotesLoading(true);
    else setNotesLoadingMore(true);
    setNotesError(null);
    try {
      const current = userNotes();
      const req: Record<string, unknown> = {
        userId: params.id,
        limit: PROFILE_NOTES_PAGE_SIZE,
        withReplies: false,
      };
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<Note[]>("users/notes", req);
      setNotesUnsupported(false);
      if (mode === "older") {
        const seen = new Set(current.map((n) => n.id));
        const fresh: Note[] = [];
        for (const n of page) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            fresh.push(n);
          }
        }
        if (fresh.length === 0) setNotesExhausted(true);
        setUserNotes([...current, ...fresh]);
      } else {
        const seen = new Set<string>();
        setUserNotes(
          page.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          }),
        );
        setNotesExhausted(false);
      }
      setNotesFailedMode(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Some servers do not implement users/notes; say so neutrally
        // instead of showing an error.
        setNotesUnsupported(true);
      } else {
        setNotesError(err instanceof Error ? err.message : "Could not load notes.");
        setNotesFailedMode(mode);
      }
    } finally {
      setNotesLoading(false);
      setNotesLoadingMore(false);
      setNotesBusy(false);
    }
  };

  const retryNotes = () => void loadNotes(notesFailedMode() ?? "refresh");

  onMount(() => {
    void load();
    void loadNotes("initial");
  });

  const setFollow = async (follow: boolean) => {
    const current = user();
    if (!current || busy()) return;
    setBusy(true);
    try {
      const updated = await apiCall<UserDetailed>(
        follow ? "following/create" : "following/delete",
        { userId: current.id },
      );
      // The follow endpoints return the followee as UserLite; keep our
      // detailed view and flip the follow flag explicitly.
      setUser((u) => (u ? { ...u, ...updated, isFollowing: follow } : u));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow action failed.");
    } finally {
      setBusy(false);
    }
  };

  const isSelf = () => !!auth.me() && auth.me()!.id === params.id;
  const canFollow = () => !!auth.token() && !isSelf();

  return (
    <div>
      <div class="pagehead"><h1>Profile</h1></div>
      <Show when={loading()} fallback={
        <Show when={error() && !user()} fallback={
          <Show when={user()}>
            {(current) => (
              <>
                <Show when={error()}>
                  <div class="state" role="alert">
                    <div class="errorbox">{error()}</div>
                  </div>
                </Show>
                <div class="profile">
                  <Show
                    when={current().avatarUrl}
                    fallback={<div class="avatar-fallback" aria-hidden="true">{displayNameOf(current()).slice(0, 1).toUpperCase()}</div>}
                  >
                    <img class="avatar" src={current().avatarUrl!} alt="" />
                  </Show>
                  <div style={{ flex: 1 }}>
                    <h2>{displayNameOf(current())}</h2>
                    <div class="handle">{handleOf(current())}</div>
                    <Show when={current().description}>
                      <p class="bio">{current().description}</p>
                    </Show>
                    <div class="stats">
                      <span>{current().notesCount} notes</span>
                      <span>{current().followingCount} following</span>
                      <span>{current().followersCount} followers</span>
                    </div>
                    <Show when={canFollow()}>
                      <Show when={current().isFollowing} fallback={
                        <button type="button" disabled={busy()} onClick={() => void setFollow(true)}>
                          Follow
                        </button>
                      }>
                        <button type="button" disabled={busy()} onClick={() => void setFollow(false)}>
                          Unfollow
                        </button>
                      </Show>
                    </Show>
                  </div>
                </div>
                <div class="pagehead"><h1>Notes</h1></div>
                <Show when={notesUnsupported()} fallback={
                  <Show when={notesLoading()} fallback={
                    <>
                      <Show when={notesError() && userNotes().length > 0}>
                        <div class="state" role="alert">
                          <div class="errorbox">{notesError()}</div>
                          <button type="button" onClick={retryNotes}>Try again</button>
                        </div>
                      </Show>
                      <Show when={notesError() && userNotes().length === 0}>
                        <ErrorState
                          message={notesError() ?? "Could not load notes."}
                          onRetry={retryNotes}
                        />
                      </Show>
                      <Show when={userNotes().length > 0}>
                        <div class="feed">
                          <For each={userNotes()}>
                            {(n) => <NoteCard note={n} />}
                          </For>
                        </div>
                        <Show when={!notesExhausted()} fallback={
                          <div class="state" role="status"><p>You're caught up.</p></div>
                        }>
                          <div class="pager">
                            <button
                              type="button"
                              onClick={() => void loadNotes("older")}
                              disabled={notesLoadingMore()}
                            >
                              {notesLoadingMore() ? "Loading…" : "Load older"}
                            </button>
                          </div>
                        </Show>
                      </Show>
                      <Show when={!notesError() && userNotes().length === 0}>
                        <div class="state"><p>No notes yet.</p></div>
                      </Show>
                    </>
                  }>
                    <LoadingState label="Loading notes…" />
                  </Show>
                }>
                  <div class="state" role="status">
                    <p>Notes are not available on this server.</p>
                  </div>
                </Show>
              </>
            )}
          </Show>
        }>
          <ErrorState message={error() ?? "Could not load the profile."} onRetry={() => void load()} />
        </Show>
      }>
        <LoadingState label="Loading profile…" />
      </Show>
    </div>
  );
}
