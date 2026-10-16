import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, ApiError } from "../api/client";
import type { NotificationItem } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { subscribeChannel, useStreamState } from "../api/stream";
import type { ChannelHandle } from "../api/stream";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import MfmRenderer from "../components/MfmRenderer";
import StreamBadge from "../components/StreamBadge";

const NOTIFICATIONS_PAGE_SIZE = 20;

type NotificationsLoadMode = "initial" | "older" | "refresh";

const TYPE_LABELS: Record<string, string> = {
  follow: "New follower",
  mention: "Mention",
  reply: "Reply",
  renote: "Repost",
  quote: "Quote",
  reaction: "Reaction",
  pollVote: "Poll update",
  pollEnded: "Poll update",
  receiveFollowRequest: "Follow request",
  followRequestAccepted: "Follow request accepted",
  login: "New sign-in",
  createToken: "App token created",
  scheduledNotePosted: "Scheduled note posted",
  note: "Note update",
  roleAssigned: "Role assigned",
  achievementEarned: "Achievement",
  test: "Test",
};

function labelOf(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  // Unknown type: title-case the raw value (split camelCase/snake-case).
  const words = type
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return type;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatTimestamp(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString();
}

// Response items carry id, createdAt, type, user, note and an optional
// reaction. Misskey/Sharkey omit `isRead` (Pinetree packs it as optional),
// so no read/unread styling is rendered — every item looks the same.
export default function Notifications() {
  const auth = useAuth();
  const [items, setItems] = createSignal<NotificationItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<NotificationsLoadMode | null>(null);
  const [markingRead, setMarkingRead] = createSignal(false);
  const [markReadError, setMarkReadError] = createSignal<string | null>(null);
  // Streamed `notification` events only raise a "new" count: the list
  // itself still comes from the server (no fabricated unread state — the
  // backends pack no isRead).
  const [newCount, setNewCount] = createSignal(0);
  const [channelHandle, setChannelHandle] = createSignal<ChannelHandle | null>(null);
  const [streamNonce, setStreamNonce] = createSignal(0);
  const stream = useStreamState();

  const load = async (mode: NotificationsLoadMode) => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const current = items();
      const req: Record<string, unknown> = { limit: NOTIFICATIONS_PAGE_SIZE };
      if (mode === "older" && current.length > 0) {
        req.untilId = current[current.length - 1].id;
      }
      const page = await apiCall<NotificationItem[]>("i/notifications", req);
      if (mode === "older") {
        const seen = new Set(current.map((n) => n.id));
        const fresh: NotificationItem[] = [];
        for (const n of page) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            fresh.push(n);
          }
        }
        if (fresh.length === 0) setExhausted(true);
        setItems([...current, ...fresh]);
      } else {
        const seen = new Set<string>();
        setItems(
          page.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          }),
        );
        setExhausted(false);
      }
      setFailedMode(null);
      // A successful (re)load reconciles the list with the server, so any
      // streamed "new" count is absorbed.
      if (mode !== "older") setNewCount(0);
    } catch (err) {
      // Pagination failures keep the already-loaded items on screen; the
      // failed mode is remembered so "Try again" retries the same cursor.
      setError(err instanceof Error ? err.message : "Could not load notifications.");
      setFailedMode(mode);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setBusy(false);
    }
  };

  const retry = () => void load(failedMode() ?? "refresh");

  // Misskey-family responses carry no isRead, so there is no unread badge
  // to clear optimistically: this calls the server and reloads the list.
  // Older sessions lack the write:notifications scope and get a 403 — the
  // fix is signing in again, not retrying.
  const markAllRead = async () => {
    if (markingRead()) return;
    setMarkingRead(true);
    setMarkReadError(null);
    try {
      await apiCall<undefined>("notifications/mark-all-as-read", {});
      await load("refresh");
    } catch (err) {
      setMarkReadError(
        err instanceof ApiError && (err.status === 403 || err.status === 401)
          ? "Your session lacks the notification-write permission. Sign out and sign in again, then retry."
          : err instanceof Error ? err.message : "Could not mark notifications as read.",
      );
    } finally {
      setMarkingRead(false);
    }
  };

  onMount(() => {
    if (auth.token()) void load("initial");
    else setLoading(false);
  });

  createEffect(() => {
    const token = auth.token();
    streamNonce();
    untrack(() => channelHandle())?.dispose();
    setChannelHandle(null);
    if (!token) return;
    setChannelHandle(
      subscribeChannel(
        "main",
        undefined,
        {
          onEvent: (type) => {
            // Count only `notification` (mentions/reactions also arrive as
            // their own main-channel types — counting those too would
            // double-count one server event).
            if (type === "notification") setNewCount((n) => n + 1);
          },
        },
        token,
      ),
    );
  });

  onCleanup(() => {
    untrack(() => channelHandle())?.dispose();
    setChannelHandle(null);
  });

  return (
    <div>
      <div class="pagehead">
        <h1>Notifications</h1>
        <StreamBadge channelStatus={() => channelHandle()?.status() ?? "disabled"} />
        <Show when={auth.token()}>
          <Show when={newCount() > 0}>
            <button type="button" onClick={() => void load("refresh")} disabled={loading() || loadingMore()}>
              {newCount()} new — Refresh
            </button>
          </Show>
          <Show when={stream.status() === "error"}>
            <button type="button" onClick={() => setStreamNonce((n) => n + 1)}>
              Retry live updates
            </button>
          </Show>
          <button type="button" onClick={() => void load("refresh")} disabled={loading() || loadingMore()}>Refresh</button>
          <button type="button" onClick={() => void markAllRead()} disabled={markingRead() || loading()}>
            {markingRead() ? "Marking…" : "Mark all read"}
          </button>
        </Show>
      </div>
      <Show when={markReadError()}>
        <div class="state" role="alert">
          <div class="errorbox">{markReadError()}</div>
        </div>
      </Show>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show when={auth.token()} fallback={
          <div class="state">
            <p>You need to sign in to see notifications.</p>
            <A
              href="/login"
              class="btn-primary"
              style={{
                display: "inline-block",
                padding: "6px 12px",
                border: "1px solid var(--text)",
                "border-radius": "6px",
                "text-decoration": "none",
              }}
            >
              Sign in
            </A>
          </div>
        }>
          <Show when={loading()} fallback={
            <Show when={error() && items().length === 0} fallback={
              <Show when={items().length > 0} fallback={
                <div class="state"><p>No notifications.</p></div>
              }>
                <Show when={error() && items().length > 0}>
                  <div class="state" role="alert">
                    <div class="errorbox">{error()}</div>
                    <button type="button" onClick={retry}>Try again</button>
                  </div>
                </Show>
                <div class="feed">
                  <For each={items()}>
                    {(n) => (
                      <div class="notif">
                        <Show when={n.user} fallback={<span>Unknown user</span>}>
                          <A class="action" href={`/users/${n.user!.id}`}>
                            <Show
                              when={n.user!.avatarUrl}
                              fallback={
                                <div class="avatar-fallback" aria-hidden="true">
                                  {displayNameOf(n.user!).slice(0, 1).toUpperCase()}
                                </div>
                              }
                            >
                              <img class="avatar" src={n.user!.avatarUrl!} alt="" loading="lazy" />
                            </Show>
                            <span>{displayNameOf(n.user!)} ({handleOf(n.user!)})</span>
                          </A>
                        </Show>
                        <div style={{ flex: 1 }}>
                          <div class="kind">{labelOf(n.type)}</div>
                          <div class="handle">{formatTimestamp(n.createdAt)}</div>
                          <Show when={n.reaction}>
                            <div>reacted {n.reaction}</div>
                          </Show>
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
                <Show when={!exhausted()} fallback={
                  <div class="state" role="status"><p>You're caught up.</p></div>
                }>
                  <div class="pager">
                    <button type="button" onClick={() => void load("older")} disabled={loadingMore()}>
                      {loadingMore() ? "Loading…" : "Load older"}
                    </button>
                  </div>
                </Show>
              </Show>
            }>
              <ErrorState message={error() ?? "Could not load notifications."} onRetry={retry} />
            </Show>
          }>
            <LoadingState label="Loading notifications…" />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
