import { createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, ApiError, isUnsupportedError } from "../api/client";
import type { GroupedNotificationItem, MeDetailed, NotificationItem } from "../api/types";
import { NOTIFICATION_FILTER_PRESETS } from "../api/types";
import { GroupedNotificationRow, NotificationRow } from "../components/NotificationRow";
import { subscribeChannel, useStreamState } from "../api/stream";
import type { ChannelHandle } from "../api/stream";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import InfiniteSentinel from "../components/InfiniteSentinel";
import LoadingState from "../components/LoadingState";
import { NotificationSkeletonList } from "../components/Skeleton";
import StreamBadge from "../components/StreamBadge";

const NOTIFICATIONS_PAGE_SIZE = 20;

type NotificationsLoadMode = "initial" | "older" | "refresh";

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
  // Filtering (§12): presets map to includeTypes/excludeTypes (works on
  // all backends — the request simply omits them for "All").
  const [filterPreset, setFilterPreset] = createSignal("all");
  // Grouping (§12): `i/notifications-grouped` rows; 404 falls back to the
  // flat list with an honest note.
  const [grouped, setGrouped] = createSignal(false);
  const [groupedItems, setGroupedItems] = createSignal<GroupedNotificationItem[]>([]);
  const [groupedUnsupported, setGroupedUnsupported] = createSignal(false);
  // Per-user receive config (§12): never|following|follower|mutualFollow|
  // followingOrFollower|list per notification type, via `i/update`.
  const [showNotifConfig, setShowNotifConfig] = createSignal(false);
  const [notifConfig, setNotifConfig] = createSignal<Record<string, string>>({});
  const [notifConfigBusy, setNotifConfigBusy] = createSignal(false);
  const [notifConfigError, setNotifConfigError] = createSignal<string | null>(null);
  const [notifConfigUnsupported, setNotifConfigUnsupported] = createSignal(false);
  const stream = useStreamState();

  const load = async (mode: NotificationsLoadMode) => {
    if (busy()) return;
    if (mode === "older" && exhausted()) return;
    setBusy(true);
    if (mode === "initial") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const preset = NOTIFICATION_FILTER_PRESETS.find((p) => p.id === filterPreset());
      const filter: Record<string, unknown> = {};
      if (preset?.includeTypes) filter.includeTypes = preset.includeTypes;
      if (preset?.excludeTypes) filter.excludeTypes = preset.excludeTypes;
      if (grouped()) {
        // Grouped rows carry their own paging; filters apply the same way.
        const current = groupedItems();
        const req: Record<string, unknown> = { limit: NOTIFICATIONS_PAGE_SIZE, ...filter };
        if (mode === "older" && current.length > 0) {
          req.untilId = current[current.length - 1].id;
        }
        try {
          const page = await apiCall<GroupedNotificationItem[]>("i/notifications-grouped", req);
          setGroupedUnsupported(false);
          if (mode === "older") {
            const seen = new Set(current.map((n) => n.id));
            const fresh = page.filter((n) => !seen.has(n.id));
            if (fresh.length === 0) setExhausted(true);
            setGroupedItems([...current, ...fresh]);
          } else {
            const seen = new Set<string>();
            setGroupedItems(page.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))));
            setExhausted(false);
          }
          setFailedMode(null);
          if (mode !== "older") setNewCount(0);
          return;
        } catch (err) {
          if (isUnsupportedError(err)) {
            // Fall through to the flat list with an honest note.
            setGroupedUnsupported(true);
            setGrouped(false);
          } else {
            throw err;
          }
        }
      }
      const current = items();
      const req: Record<string, unknown> = { limit: NOTIFICATIONS_PAGE_SIZE, ...filter };
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

  const applyPreset = (id: string) => {
    setFilterPreset(id);
    setItems([]);
    setGroupedItems([]);
    setExhausted(false);
    setFailedMode(null);
    void load("initial");
  };

  const toggleGrouped = () => {
    setGrouped((v) => !v);
    setItems([]);
    setGroupedItems([]);
    setExhausted(false);
    setFailedMode(null);
    void load("initial");
  };

  const loadNotifConfig = () => {
    const me = auth.me() as MeDetailed | null;
    const raw: unknown = me?.["notificationRecieveConfig"];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      setNotifConfig(out);
    } else {
      setNotifConfig({});
    }
    setShowNotifConfig((v) => !v);
  };

  const saveNotifConfig = async () => {
    if (notifConfigBusy()) return;
    setNotifConfigBusy(true);
    setNotifConfigError(null);
    try {
      await apiCall<MeDetailed>("i/update", { notificationRecieveConfig: notifConfig() });
      setNotifConfigUnsupported(false);
      await auth.refreshMe().catch(() => undefined);
      setShowNotifConfig(false);
    } catch (err) {
      if (isUnsupportedError(err)) {
        setNotifConfigUnsupported(true);
      } else {
        setNotifConfigError(err instanceof Error ? err.message : "Could not save notification settings.");
      }
    } finally {
      setNotifConfigBusy(false);
    }
  };

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
      <Show when={auth.token()}>
        <div class="notif-filters" role="group" aria-label="Notification filters">
          <For each={NOTIFICATION_FILTER_PRESETS}>
            {(preset) => (
              <button
                type="button"
                aria-pressed={filterPreset() === preset.id}
                class={filterPreset() === preset.id ? "nf-chip active" : "nf-chip"}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </button>
            )}
          </For>
          <button
            type="button"
            aria-pressed={grouped()}
            class={grouped() ? "nf-chip active" : "nf-chip"}
            onClick={toggleGrouped}
            title="Group similar notifications"
          >
            {grouped() ? "Ungroup" : "Group"}
          </button>
          <Show when={!notifConfigUnsupported()}>
            <button type="button" class="nf-chip" onClick={loadNotifConfig} aria-expanded={showNotifConfig()}>
              Notify me
            </button>
          </Show>
        </div>
        <Show when={groupedUnsupported()}>
          <p class="handle" role="status">Grouped notifications are not available on this server — showing all.</p>
        </Show>
        <Show when={showNotifConfig()}>
          <div class="settings-block" aria-label="Notification receive settings">
            <p class="handle">
              Who may notify you, per type. Blacklist = muting (see
              Settings → Mutes and blocks); whitelist options limit to
              people you follow.
            </p>
            <For each={NOTIFICATION_FILTER_PRESETS.filter((p) => p.id !== "all")}>
              {(preset) => (
                <div class="row">
                  <label>
                    {preset.label}
                    <select
                      value={notifConfig()[preset.id] ?? ""}
                      onChange={(e) =>
                        setNotifConfig((c) => ({ ...c, [preset.id]: e.currentTarget.value }))
                      }
                      aria-label={`${preset.label} notifications from`}
                    >
                      <option value="">Server default</option>
                      <option value="never">Never</option>
                      <option value="following">People I follow</option>
                      <option value="follower">My followers</option>
                      <option value="mutualFollow">Mutual follows</option>
                      <option value="followingOrFollower">Followed or follower</option>
                      <option value="list">A list</option>
                    </select>
                  </label>
                </div>
              )}
            </For>
            <Show when={notifConfigError()}>
              <div class="err" role="alert">{notifConfigError()}</div>
            </Show>
            <button type="button" disabled={notifConfigBusy()} onClick={() => void saveNotifConfig()}>
              {notifConfigBusy() ? "Saving…" : "Save"}
            </button>
          </div>
        </Show>
      </Show>
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
                padding: "0.4em 0.8em",
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
            <Show when={error() && items().length === 0 && groupedItems().length === 0} fallback={
              <Show when={grouped() ? groupedItems().length > 0 : items().length > 0} fallback={
                <div class="state"><p>No notifications.</p></div>
              }>
                <Show when={error() && items().length > 0 && !grouped()}>
                  <div class="state" role="alert">
                    <div class="errorbox">{error()}</div>
                    <button type="button" onClick={retry}>Try again</button>
                  </div>
                </Show>
                <Show when={grouped()} fallback={
                <>
                <div class="feed">
                  <For each={items()}>
                    {(n) => <NotificationRow item={n} />}
                  </For>
                </div>
                <Show when={!exhausted()} fallback={
                  <div class="state" role="status"><p>You're caught up.</p></div>
                }>
                  <Show when={loadingMore()}>
                    <NotificationSkeletonList count={2} label="Loading older notifications…" />
                  </Show>
                  <InfiniteSentinel
                    canLoad={() =>
                      !busy() && !loading() && !exhausted()
                      && (grouped() ? groupedItems().length > 0 : items().length > 0)
                    }
                    onLoad={() => void load("older")}
                  />
                </Show>
                </>
                }>
                <div class="feed">
                  <Show when={groupedItems().length > 0} fallback={
                    <div class="state"><p>No notifications.</p></div>
                  }>
                    <For each={groupedItems()}>
                      {(n) => <GroupedNotificationRow item={n} />}
                    </For>
                  </Show>
                  <Show when={!exhausted()} fallback={
                    <div class="state" role="status"><p>You're caught up.</p></div>
                  }>
                    <Show when={loadingMore()}>
                      <NotificationSkeletonList count={2} label="Loading older notifications…" />
                    </Show>
                    <InfiniteSentinel
                      canLoad={() =>
                        !busy() && !loading() && !exhausted() && groupedItems().length > 0
                      }
                      onLoad={() => void load("older")}
                    />
                  </Show>
                </div>
                </Show>
              </Show>
            }>
              <ErrorState message={error() ?? "Could not load notifications."} onRetry={retry} />
            </Show>
          }>
            <NotificationSkeletonList label="Loading notifications…" />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
