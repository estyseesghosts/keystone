import { createEffect, createSignal, onMount, Show } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { UserDetailed } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { DisplayName } from "../components/EmojiPicker";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import FollowList from "../components/FollowList";
import MfmRenderer from "../components/MfmRenderer";
import ProfileNotesList from "../components/ProfileNotesList";
import type { ProfileTab } from "../components/ProfileNotesList";
import { ProfileSkeleton } from "../components/Skeleton";
import ProfileEditor from "../components/ProfileEditor";

export default function Profile() {
  const params = useParams();
  const auth = useAuth();
  const [user, setUser] = createSignal<UserDetailed | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  // Default tab: Posts. Featured ships absent: no pinned-note source was
  // confirmed (no field in the endpoint source reviewed, none packed on
  // `UserDetailed`, no live backend on this machine to probe
  // `users/show` for one) — never faked, per the handoff.
  const [tab, setTab] = createSignal<ProfileTab>("posts");

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

  const resetForId = (id: string) => {
    if (!id) return;
    // Direct navigation /users/a -> /users/b reuses this component.
    // The active tab is kept; each tab's list resets on the userId change
    // (per-tab cursors never mix).
    setUser(null);
    setEditing(false);
    void load(id);
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

  const tabClass = (name: ProfileTab) =>
    tab() === name ? "profile-tab active" : "profile-tab";

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
                    when={current().bannerUrl}
                    fallback={<div class="profile-banner" aria-hidden="true" />}
                  >
                    <img class="profile-banner" src={current().bannerUrl!} alt="" />
                  </Show>
                  <div class={current().bannerUrl ? "profile-body profile-overlap" : "profile-body"}>
                    <div class="profile-row">
                      <span class="profile-ava">
                        <Show
                          when={current().avatarUrl}
                          fallback={<div class="avatar-fallback" aria-hidden="true">{displayNameOf(current()).slice(0, 1).toUpperCase()}</div>}
                        >
                          <img class="avatar" src={current().avatarUrl!} alt="" />
                        </Show>
                      </span>
                      <span class="spacer" aria-hidden="true" />
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
                      </Show>
                    </div>
                    <h2><DisplayName name={displayNameOf(current())} packed={current().emojis} /></h2>
                    <div class="handle">{handleOf(current())}</div>
                    <Show when={current().isLocked}>
                      <div class="handle">Locked account</div>
                    </Show>
                    <Show when={current().description}>
                      <div class="bio"><MfmRenderer text={current().description} emojis={current().emojis} /></div>
                    </Show>
                    <div class="stats">
                      <span>{current().notesCount.toLocaleString()} notes</span>
                      <A class="statlink" href={`/users/${current().id}/following`}>
                        {current().followingCount.toLocaleString()} Following
                      </A>
                      <A class="statlink" href={`/users/${current().id}/followers`}>
                        {current().followersCount.toLocaleString()} Followers
                      </A>
                    </div>
                    <Show when={isSelf() && editing() && auth.me()}>
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
                  </div>
                </div>
                <div class="profile-tabs" role="tablist" aria-label="Profile notes">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === "posts"}
                    class={tabClass("posts")}
                    onClick={() => setTab("posts")}
                  >
                    Posts
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === "all"}
                    class={tabClass("all")}
                    onClick={() => setTab("all")}
                  >
                    All posts
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === "media"}
                    class={tabClass("media")}
                    onClick={() => setTab("media")}
                  >
                    Media
                  </button>
                </div>
                <Show when={tab() === "posts"}>
                  <ProfileNotesList userId={current().id} tab="posts" />
                </Show>
                <Show when={tab() === "all"}>
                  <ProfileNotesList userId={current().id} tab="all" />
                </Show>
                <Show when={tab() === "media"}>
                  <ProfileNotesList userId={current().id} tab="media" />
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

/** Full-page followers list for the `/users/:id/followers` sub-route:
 * the shared `FollowList` in full, with a back link to the profile. */
export function FollowersPage() {
  const params = useParams();
  const id = () => params.id ?? "";
  return (
    <div>
      <div class="pagehead">
        <h1>Followers</h1>
        <Show when={id()}>
          <A class="action" href={`/users/${id()}`}>Back to profile</A>
        </Show>
      </div>
      <Show when={id()} fallback={
        <div class="state"><p>Missing user.</p></div>
      }>
        <FollowList userId={id()} mode="followers" />
      </Show>
    </div>
  );
}

/** Full-page following list for the `/users/:id/following` sub-route. */
export function FollowingPage() {
  const params = useParams();
  const id = () => params.id ?? "";
  return (
    <div>
      <div class="pagehead">
        <h1>Following</h1>
        <Show when={id()}>
          <A class="action" href={`/users/${id()}`}>Back to profile</A>
        </Show>
      </div>
      <Show when={id()} fallback={
        <div class="state"><p>Missing user.</p></div>
      }>
        <FollowList userId={id()} mode="following" />
      </Show>
    </div>
  );
}
