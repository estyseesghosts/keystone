// Follow list for a profile (`users/followers`, `users/following`).
// Extracted from `routes/Profile.tsx` so the profile counters can link to
// full list sub-routes (`/users/:id/followers`, `/users/:id/following`)
// reusing this exact loader: cursor paging + id dedupe + exhaustion,
// infinite scroll, remembered-cursor retry. Permission-aware: a
// pre-scope token (403 PERMISSION_DENIED) gets the repo-standard
// re-sign-in hint; any other 403/401 denial renders an honest
// "not visible to you" state, never an empty page pretending otherwise.

import { createEffect, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, ApiError, isPermissionError } from "../api/client";
import type { UserDetailed, UserLite } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName } from "./EmojiPicker";
import { useAuth } from "../state/auth";
import InfiniteSentinel from "./InfiniteSentinel";
import { RowSkeletonList } from "./Skeleton";

const FOLLOW_PAGE_SIZE = 20;

type FollowLoadMode = "initial" | "older";

export default function FollowList(props: { userId: string; mode: "followers" | "following" }) {
  const [users, setUsers] = createSignal<UserLite[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [denied, setDenied] = createSignal(false);
  const [permissionDenied, setPermissionDenied] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [failedMode, setFailedMode] = createSignal<FollowLoadMode | null>(null);
  // Privacy gate copy (§2): the listed user's `ffVisibility` decides the
  // denied-state wording. Best-effort — unknown stays generic.
  const [ffVisibility, setFfVisibility] = createSignal<string | null>(null);
  const [viewerIsSelf, setViewerIsSelf] = createSignal(false);
  const [followBusy, setFollowBusy] = createSignal(false);
  const auth = useAuth();

  const load = async (mode: FollowLoadMode) => {
    if (busy()) return;
    const older = mode === "older";
    if (older && exhausted()) return;
    const my = seq;
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
      if (my !== seq) return;
      setDenied(false);
      setPermissionDenied(false);
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
      if (my !== seq) return;
      if (isPermissionError(err)) {
        setPermissionDenied(true);
        setDenied(false);
        setError(null);
      } else if (
        err instanceof ApiError &&
        (err.status === 403 || err.status === 401)
      ) {
        // Locked/private list the viewer may not see: honest state,
        // never an empty page pretending otherwise.
        setDenied(true);
        setPermissionDenied(false);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Could not load this list.");
      }
      setFailedMode(mode);
    } finally {
      if (my === seq) {
        setLoading(false);
        setLoadingMore(false);
        setBusy(false);
      }
    }
  };

  const retry = () => {
    setDenied(false);
    setPermissionDenied(false);
    void load(failedMode() ?? "initial");
  };

  // Reload when the listed user or direction changes (direct
  // navigation /users/a/followers -> /users/b/followers reuses this
  // component). Identity-compared so parent re-renders never wipe the
  // loaded list. Generation-guarded like the reply branches.
  let seq = 0;
  let loadedFor: string | null = null;
  createEffect(() => {
    const key = `${props.userId}::${props.mode}`;
    if (!props.userId || key === loadedFor) return;
    loadedFor = key;
    seq++;
    const my = seq;
    void (async () => {
      if (my !== seq) return;
      setUsers([]);
      setExhausted(false);
      setError(null);
      setDenied(false);
      setPermissionDenied(false);
      setFailedMode(null);
      // Best-effort privacy gate: who may see this list.
      try {
        const target = await apiCall<UserDetailed>("users/show", { userId: props.userId });
        if (my !== seq) return;
        setFfVisibility(target.ffVisibility ?? null);
        setViewerIsSelf(!!auth.me() && auth.me()!.id === target.id);
      } catch {
        if (my !== seq) return;
        setFfVisibility(null);
        setViewerIsSelf(false);
      }
      await load("initial");
    })();
  });

  const followListedUser = async () => {
    if (followBusy()) return;
    setFollowBusy(true);
    try {
      await apiCall<UserLite>("following/create", { userId: props.userId });
      setDenied(false);
      await load("initial");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow failed.");
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <Show when={loading()} fallback={
      <>
        <Show when={permissionDenied()}>
          <div class="state" role="alert">
            <div class="errorbox">
              Your session lacks the permission to view this list. Sign out and sign in again to grant it, then retry.
            </div>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        </Show>
        <Show when={denied() && !permissionDenied()}>
          <div class="state" role="status">
            <Show
              when={ffVisibility() === "private" && !viewerIsSelf()}
              fallback={
                <Show
                  when={ffVisibility() === "followers"}
                  fallback={<p>This list is not visible to you.</p>}
                >
                  <p>Only followers can see this.</p>
                  <Show when={auth.token() && !viewerIsSelf()}>
                    <p class="handle">Follow this account to see its list.</p>
                    <button type="button" disabled={followBusy()} onClick={() => void followListedUser()}>
                      {followBusy() ? "Following…" : "Follow"}
                    </button>
                  </Show>
                </Show>
              }
            >
              <p>Only the account owner can see this.</p>
            </Show>
          </div>
        </Show>
        <Show when={!denied() && !permissionDenied()}>
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
                  <A class="namelink" href={`/users/${u.id}`}>
                    <span class="name"><DisplayName name={headNameOf(u)} packed={u.emojis} host={u.host} /></span>
                    <Show when={hasRealDisplayName(u)}>
                      <span class="handle">{handleOf(u)}</span>
                    </Show>
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
        </Show>
      </>
    }>
      <RowSkeletonList count={3} label={`Loading ${props.mode}…`} />
    </Show>
  );
}
