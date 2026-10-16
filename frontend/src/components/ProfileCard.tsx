// Embedded profile card: a pasted profile URL unfurls into a compact card
// with avatar, name, handle, bio, counts, and follow controls — only fields
// the server packs (no fabrication). Resolution + follow state refresh go
// through `users/show`; follow changes re-derive from the server (locked
// accounts yield pending requests, never optimistic acceptance).

import { createResource, createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall } from "../api/client";
import { displayNameOf, handleOf } from "../api/types";
import type { UserDetailed } from "../api/types";
import { useAuth } from "../state/auth";
import { Avatar } from "./NoteBody";
import { RowSkeletonList } from "./Skeleton";

export type ProfileRef =
  | { username: string; homeHost: string }
  | { userId: string; homeHost: string };

/** Match pasted profile URLs: `https://host/@user`,
 * `https://host/@user@home`, `https://host/users/<id>`. Returns the
 * lookup ref plus the URL's host (the home instance when it is local
 * there). Anything else is not a profile link. */
export function parseProfileUrl(url: string): ProfileRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const homeHost = parsed.hostname.toLowerCase();
  const atMatch = /^\/@([A-Za-z0-9_]+)(?:@([A-Za-z0-9.-]+))?\/?$/.exec(parsed.pathname);
  if (atMatch) {
    return { username: atMatch[1], homeHost: (atMatch[2] ?? homeHost).toLowerCase() };
  }
  const idMatch = /^\/users\/([A-Za-z0-9]+)\/?$/.exec(parsed.pathname);
  if (idMatch) return { userId: idMatch[1], homeHost };
  return null;
}

async function resolveProfile(ref: ProfileRef, ourHost: string | null): Promise<UserDetailed> {
  if ("userId" in ref) {
    return apiCall<UserDetailed>("users/show", { userId: ref.userId });
  }
  // The URL host is home unless it is our own backend (local lookup).
  const host =
    ourHost && ref.homeHost === ourHost ? undefined : ref.homeHost;
  return apiCall<UserDetailed>("users/show", {
    username: ref.username,
    ...(host ? { host } : {}),
  });
}

/** Our own backend's host for local-vs-remote lookup, or null when it
 * cannot be determined (internal proxy target is a URL; external
 * sessions know their host). */
function ourBackendHost(externalHost: string | null): string | null {
  if (externalHost) return externalHost.toLowerCase();
  try {
    return new URL(
      (import.meta.env.VITE_KEYSTONE_API_URL as string | undefined) ??
        "http://127.0.0.1:3000",
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function FollowButton(props: { user: () => UserDetailed; onUpdate: (u: UserDetailed) => void }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const userId = () => props.user().id;
  const isPending = () => props.user().hasPendingFollowRequestFromYou === true;

  const toggle = async () => {
    if (busy() || isPending()) return;
    setBusy(true);
    setError(null);
    try {
      if (props.user().isFollowing) {
        await apiCall<undefined>("following/delete", { userId: userId() });
      } else {
        await apiCall<undefined>("following/create", { userId: userId() });
      }
      props.onUpdate(await apiCall<UserDetailed>("users/show", { userId: userId() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" disabled={busy() || isPending()} onClick={() => void toggle()}>
        {busy() ? "…" : isPending() ? "Requested" : props.user().isFollowing ? "Unfollow" : "Follow"}
      </button>
      <Show when={error()}>
        <span class="err" role="alert">{error()}</span>
      </Show>
    </>
  );
}

function ProfileCard(props: { initial: UserDetailed }) {
  const auth = useAuth();
  const [user, setUser] = createSignal(props.initial);
  return (
    <div class="renote-embed profilecard">
      <div class="profilecard-head">
        <A href={`/users/${user().id}`} aria-label={`Open profile of ${displayNameOf(user())}`}>
          <Avatar url={user().avatarUrl} name={displayNameOf(user())} />
        </A>
        <div class="profilecard-id">
          <span class="name">{displayNameOf(user())}</span>
          <span class="handle">{handleOf(user())}</span>
        </div>
        <span class="spacer" />
        <Show when={auth.token()}>
          <FollowButton user={user} onUpdate={setUser} />
        </Show>
      </div>
      <Show when={user().description}>
        <p class="bio">{user().description}</p>
      </Show>
      <div class="handle profilecard-stats">
        {user().followersCount.toLocaleString()} followers ·{" "}
        {user().followingCount.toLocaleString()} following ·{" "}
        {user().notesCount.toLocaleString()} notes
        {user().isLocked ? " · locks follows" : ""}
        {user().isBot ? " · automated" : ""}
      </div>
      <div class="renote-foot">
        <A href={`/users/${user().id}`}>Open profile</A>
      </div>
    </div>
  );
}

export default function ProfileCardLoader(props: { ref: ProfileRef }) {
  const auth = useAuth();
  const [user] = createResource(
    () => `${"userId" in props.ref ? props.ref.userId : `${props.ref.username}@${props.ref.homeHost}`}:${auth.token() ?? ""}`,
    () => resolveProfile(props.ref, ourBackendHost(auth.activeExternalHost())),
  );
  return (
    <Show when={!user.loading} fallback={
      <RowSkeletonList count={1} label="Loading profile card…" />
    }>
      <Show when={user()} fallback={null}>
        {(u) => <ProfileCard initial={u()} />}
      </Show>
    </Show>
  );
}
