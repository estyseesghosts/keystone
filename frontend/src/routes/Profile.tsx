import { createSignal, onMount, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { UserDetailed } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";

export default function Profile() {
  const params = useParams();
  const auth = useAuth();
  const [user, setUser] = createSignal<UserDetailed | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

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

  onMount(() => {
    void load();
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
                <div class="state">
                  <p>Profile timelines are not supported by this server, so only details are shown here.</p>
                </div>
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
