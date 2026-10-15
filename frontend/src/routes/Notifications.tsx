import { createSignal, For, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { PinetreeNotification } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import MfmRenderer from "../components/MfmRenderer";

// Response shape verified against the implementation
// (pack_notification: id, createdAt, type, isRead, userId, user, note, reaction).
export default function Notifications() {
  const auth = useAuth();
  const [items, setItems] = createSignal<PinetreeNotification[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await apiCall<PinetreeNotification[]>("i/notifications", { limit: 20 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  return (
    <div>
      <div class="pagehead">
        <h1>Notifications</h1>
        <Show when={auth.token()}>
          <button type="button" onClick={() => void load()} disabled={loading()}>Refresh</button>
        </Show>
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show when={auth.token()} fallback={
          <div class="state">
            <p>You need to sign in to see notifications.</p>
            <A href="/login"><button type="button">Sign in</button></A>
          </div>
        }>
          <Show when={loading()} fallback={
            <Show when={error()} fallback={
              <Show when={items().length > 0} fallback={
                <div class="state"><p>No notifications.</p></div>
              }>
                <div class="feed">
                  <For each={items()}>
                    {(n) => (
                      <div class="notif">
                        <div style={{ flex: 1 }}>
                          <div class="kind">{n.type}</div>
                          <div>
                            {n.user ? `${displayNameOf(n.user)} (${handleOf(n.user)})` : "Unknown user"}
                            {n.reaction ? ` reacted ${n.reaction}` : ""}
                          </div>
                          <Show when={n.note?.text}>
                            <div class="notebody"><MfmRenderer text={n.note!.text} /></div>
                          </Show>
                          <Show when={n.note}>
                            <A class="action" href={`/notes/${n.note!.id}`}>Open note</A>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            }>
              <ErrorState message={error() ?? "Could not load notifications."} onRetry={() => void load()} />
            </Show>
          }>
            <LoadingState label="Loading notifications…" />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
