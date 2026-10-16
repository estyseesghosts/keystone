import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { apiCall, ApiError } from "../api/client";
import type { MeDetailed, Note, UserDetailed, UserLite } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import InfiniteSentinel from "../components/InfiniteSentinel";
import NoteCard from "../components/NoteCard";
import { NoteSkeletonList, ProfileSkeleton, RowSkeletonList } from "../components/Skeleton";
import ProfileEditor from "../components/ProfileEditor";

const PROFILE_NOTES_PAGE_SIZE = 20;
const FOLLOW_PAGE_SIZE = 20;

type ProfileNotesLoadMode = "initial" | "older" | "refresh";
type FollowLoadMode = "initial" | "older";

function FollowList(props: { userId: string; mode: "followers" | "following" }) {
  const [users, setUsers] = createSignal<UserLite[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<FollowLoadMode | null>(null);

  const load = async (mode: FollowLoadMode) => {
    if (busy()) return;
    const older = mode === "older";
    if (older && exhausted()) return;
    setBusy(true);
    if (older) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const current = users();
      const req: Record<string, unknown> = {
        userId: props.userId,
        limit: FOLLOW_PAGE_SIZE,
      };
      if (older && current.length > 0) req.untilId = current[current.length - 1].id;
      const endpoint = props.mode === "followers" ? "users/followers" : "users/following";
      const page = await apiCall<UserLite[]>(endpoint, req);
      if (older) {
        const seen = new Set(current.map((u) => u.id));
        const fresh = page.filter((u) => !seen.has(u.id));
        if (fresh.length === 0) setExhausted(true);
        setUsers([...current, ...fresh]);
      } else {
        setUsers(page);
        setExhausted(false);
      }
      setFailedMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this list.");
      setFailedMode(mode);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setBusy(false);
    }
  };

  const retry = () => void load(failedMode() ?? "initial");

  onMount(() => {
    void load("initial");
  });

  return (
    <Show when={loading()} fallback={
      <>
        <Show when={error()}>
          <div class="state" role="alert">
            <div class="errorbox">{error()}</div>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        </Show>
        <Show when={users().length === 0 && !error()}>
          <div class="state"><p>None yet.</p></div>
        </Show>
        <div class="feed">
          <For each={users()}>
            {(u) => (
              <div class="notif">
                <A class="action" href={`/users/${u.id}`}>
                  {displayNameOf(u)} ({handleOf(u)})
                </A>
              </div>
            )}
          </For>
        </div>
        <Show when={loadingMore()}>
          <RowSkeletonList count={2} label={`Loading older ${props.mode}…`} />
        </Show>
        <Show when={!exhausted() && users().length > 0} fallback={
          <Show when={users().length > 0}>
            <div class="state" role="status"><p>You're caught up.</p></div>
          </Show>
        }>
          <InfiniteSentinel
            canLoad={() =>
              !busy() && !loading() && !exhausted() && users().length > 0
            }
            onLoad={() => void load("older")}
          />
        </Show>
      </>
    }>
      <RowSkeletonList count={3} label={`Loading ${props.mode}…`} />
    </Show>
  );
}

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
  const [showFollowers, setShowFollowers] = createSignal(false);
  const [showFollowing, setShowFollowing] = createSignal(false);
  const [editing, setEditing] = createSignal(false);

  const load = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      // Authenticated fetch when signed in: follow/pending flags are only
      // packed with a credential.
      setUser(await apiCall<UserDetailed>("users/show", { userId: id }));
    } catch (err) {
      setUser(null);
      setError(err instanceof Error ? err.message : "Could not load the profile.");
    } finally {
      setLoading(false);
    }
  };

  const loadNotes = async (id: string, mode: ProfileNotesLoadMode) => {
    if (notesBusy()) return;
    if (mode === "older" && notesExhausted()) return;
    setNotesBusy(true);
    if (mode === "initial") setNotesLoading(true);
    else setNotesLoadingMore(true);
    setNotesError(null);
    try {
      const current = userNotes();
      const req: Record<string, unknown> = {
        userId: id,
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

  const retryNotes = () => void loadNotes(params.id ?? "", notesFailedMode() ?? "refresh");

  const resetForId = (id: string) => {
    if (!id) return;
    // Direct navigation /users/a -> /users/b reuses this component.
    setUser(null);
    setUserNotes([]);
    setNotesExhausted(false);
    setNotesFailedMode(null);
    setShowFollowers(false);
    setShowFollowing(false);
    setEditing(false);
    void load(id);
    void loadNotes(id, "initial");
  };

  onMount(() => {
    resetForId(params.id ?? "");
  });

  createEffect(() => {
    const id = params.id ?? "";
    if (!id) return;
    const current = user();
    if (!loading() && current && current.id !== id) resetForId(id);
    if (!loading() && !current && !error()) resetForId(id);
  });

  /** Re-derive follow state from the server after every write. A successful
   * following/create on a locked account yields a PENDING request, not an
   * accepted follow — so the button state always comes from users/show,
   * never from optimism. */
  const refreshUser = async () => {
    const id = params.id ?? "";
    if (!id) return;
    try {
      setUser(await apiCall<UserDetailed>("users/show", { userId: id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the profile.");
    }
  };

  const setFollow = async (follow: boolean) => {
    const current = user();
    if (!current || busy()) return;
    setBusy(true);
    try {
      await apiCall<UserDetailed>(
        follow ? "following/create" : "following/delete",
        { userId: current.id },
      );
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow action failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    const current = user();
    if (!current || busy()) return;
    setBusy(true);
    try {
      await apiCall<undefined>("following/requests/cancel", { userId: current.id });
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the follow request.");
    } finally {
      setBusy(false);
    }
  };

  const isSelf = () => !!auth.me() && auth.me()!.id === params.id;
  const canFollow = () => !!auth.token() && !isSelf();

  const followState = (): "following" | "pending" | "none" => {
    const current = user();
    if (!current) return "none";
    if (current.isFollowing) return "following";
    if (current.hasPendingFollowRequestFromYou) return "pending";
    return "none";
  };

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
                    <Show when={current().isLocked}>
                      <div class="handle">Locked account</div>
                    </Show>
                    <Show when={current().description}>
                      <p class="bio">{current().description}</p>
                    </Show>
                    <div class="stats">
                      <span>{current().notesCount} notes</span>
                      <span>{current().followingCount} following</span>
                      <span>{current().followersCount} followers</span>
                    </div>
                    <Show when={canFollow()}>
                      <Show when={followState() === "following"} fallback={
                        <Show when={followState() === "pending"} fallback={
                          <button type="button" disabled={busy()} onClick={() => void setFollow(true)}>
                            Follow
                          </button>
                        }>
                          <span class="handle" role="status">Follow request pending</span>
                          <button type="button" disabled={busy()} onClick={() => void cancelRequest()}>
                            Cancel request
                          </button>
                        </Show>
                      }>
                        <button type="button" disabled={busy()} onClick={() => void setFollow(false)}>
                          Unfollow
                        </button>
                      </Show>
                    </Show>
                    <Show when={isSelf()}>
                      <button type="button" onClick={() => setEditing((v) => !v)}>
                        {editing() ? "Close editor" : "Edit profile"}
                      </button>
                      <Show when={editing() && auth.me()}>
                        <ProfileEditor
                          me={auth.me()!}
                          onSaved={(updated) => {
                            setEditing(false);
                            setUser((u) => (u ? { ...u, ...updated } : u));
                            // Keep the session user in sync so a reopened
                            // editor shows the saved values.
                            void auth.refreshMe().catch(() => {
                              // Non-fatal: the profile view already shows
                              // the server response.
                            });
                          }}
                        />
                      </Show>
                    </Show>
                  </div>
                </div>
                <div class="pager">
                  <button type="button" onClick={() => { setShowFollowers((v) => !v); setShowFollowing(false); }}>
                    {showFollowers() ? "Hide followers" : "Followers"}
                  </button>
                  <button type="button" onClick={() => { setShowFollowing((v) => !v); setShowFollowers(false); }}>
                    {showFollowing() ? "Hide following" : "Following"}
                  </button>
                </div>
                <Show when={showFollowers()}>
                  <div class="pagehead"><h1>Followers</h1></div>
                  <FollowList userId={current().id} mode="followers" />
                </Show>
                <Show when={showFollowing()}>
                  <div class="pagehead"><h1>Following</h1></div>
                  <FollowList userId={current().id} mode="following" />
                </Show>
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
                          <Show when={notesLoadingMore()}>
                            <NoteSkeletonList count={2} label="Loading older notes…" />
                          </Show>
                          <InfiniteSentinel
                            canLoad={() =>
                              !notesBusy() && !notesLoading() && !notesExhausted()
                              && !notesUnsupported() && userNotes().length > 0
                            }
                            onLoad={() => void loadNotes(current().id, "older")}
                          />
                        </Show>
                      </Show>
                      <Show when={!notesError() && userNotes().length === 0}>
                        <div class="state"><p>No notes yet.</p></div>
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
              </>
            )}
          </Show>
        }>
          <ErrorState message={error() ?? "Could not load the profile."} onRetry={() => void load(params.id ?? "")} />
        </Show>
      }>
        <ProfileSkeleton label="Loading profile…" />
      </Show>
    </div>
  );
}
