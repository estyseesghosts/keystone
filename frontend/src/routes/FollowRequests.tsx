// Incoming follow-request queue (§0). Lists private-list requests
// (`following/requests/list`) with accept/reject per user. 404-gated:
// backends without the endpoints render an honest unavailable state, and
// the nav entry hides the same way (see Layout probe).

import { createSignal, For, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, isUnsupportedError } from "../api/client";
import { acceptFollowRequest, listFollowRequests, rejectFollowRequest } from "../api/followRequests";
import type { FollowRequest } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import { NotificationSkeletonList } from "../components/Skeleton";

export async function followRequestsSupported(): Promise<boolean> {
  try {
    await apiCall<FollowRequest[]>("following/requests/list", { limit: 1 });
    return true;
  } catch (err) {
    if (isUnsupportedError(err)) return false;
    // Any other error (auth, network) means the endpoint exists.
    return true;
  }
}

export default function FollowRequests() {
  const auth = useAuth();
  const [items, setItems] = createSignal<FollowRequest[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [acting, setActing] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listFollowRequests());
      setUnsupported(false);
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true);
      else setError(err instanceof Error ? err.message : "Could not load follow requests.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  const act = async (id: string, userId: string, accept: boolean) => {
    if (acting() !== null) return;
    setActing(id);
    try {
      if (accept) await acceptFollowRequest(userId);
      else await rejectFollowRequest(userId);
      setItems((list) => list.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Follow requests</h1>
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
              <p>You need to sign in to see follow requests.</p>
              <A href="/login">Sign in</A>
            </div>
          }
        >
          <Show when={unsupported()} fallback={
            <Show when={loading()} fallback={
              <Show when={error() && items().length === 0} fallback={
                <Show when={items().length > 0} fallback={
                  <div class="state"><p>No pending follow requests.</p></div>
                }>
                  <Show when={error()}>
                    <div class="state" role="alert">
                      <div class="errorbox">{error()}</div>
                    </div>
                  </Show>
                  <div class="feed">
                    <For each={items()}>
                      {(r) => (
                        <div class="notif">
                          <A
                            class="avatarlink"
                            href={`/users/${r.follower.id}`}
                            aria-label={`Open profile of ${displayNameOf(r.follower)}`}
                          >
                            <Show
                              when={r.follower.avatarUrl}
                              fallback={
                                <div class="avatar-fallback" aria-hidden="true">
                                  {displayNameOf(r.follower).slice(0, 1).toUpperCase()}
                                </div>
                              }
                            >
                              <img class="avatar" src={r.follower.avatarUrl!} alt="" loading="lazy" />
                            </Show>
                          </A>
                          <div class="notif-main">
                            <div class="notif-head">
                              <A class="namelink" href={`/users/${r.follower.id}`}>
                                <span class="name">{headNameOf(r.follower)}</span>
                                <Show when={hasRealDisplayName(r.follower)}>
                                  <span class="handle">{handleOf(r.follower)}</span>
                                </Show>
                              </A>
                            </div>
                            <div class="notif-desc">requested to follow you</div>
                            <div class="row">
                              <button
                                type="button"
                                disabled={acting() === r.id}
                                onClick={() => void act(r.id, r.follower.id, true)}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                disabled={acting() === r.id}
                                onClick={() => void act(r.id, r.follower.id, false)}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              }>
                <ErrorState message={error() ?? "Could not load follow requests."} onRetry={() => void load()} />
              </Show>
            }>
              <NotificationSkeletonList label="Loading follow requests…" />
            </Show>
          }>
            <div class="state" role="status">
              <p>Follow requests are not available on this server.</p>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
