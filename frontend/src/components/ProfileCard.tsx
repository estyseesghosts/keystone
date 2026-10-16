// Embedded profile card: a pasted profile URL unfurls into a compact card.
// Only fields the software actually provides are shown — never fabricated.
//
// Resolution is layered so every profile software can show *something*:
//   1. Misskey-family via our own backend (`users/show` — local users,
//      federated users the backend knows, and Pinetree/Misskey/Sharkey
//      hosts). Full card + follow controls.
//   2. Mastodon-compatible lookup direct against the profile host
//      (`/api/v1/accounts/lookup` is CORS-open by design; Pleroma speaks
//      the same API). Details card, no follow (our backend can't act on
//      users it doesn't know).
//   3. Basic chip (handle + working "Open profile" link) when both fail.
// A 12s overall timeout guarantees the loading skeleton always settles —
// a card state is never stuck, never blank.

import { createResource, createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, ApiError } from "../api/client";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName } from "./EmojiPicker";
import type { UserDetailed } from "../api/types";
import { useAuth } from "../state/auth";
import { Avatar } from "./NoteBody";
import { RowSkeletonList } from "./Skeleton";

const RESOLVE_TIMEOUT_MS = 12_000;
const LOOKUP_TIMEOUT_MS = 10_000;

export interface ProfileRef {
  /** Display handle when details never resolve (`@user@host`). */
  handle: string;
  /** Profile host from the URL (the home instance when local there). */
  homeHost: string;
  /** Original URL: the "Open profile" target and last-resort identity. */
  rawUrl: string;
  userId?: string;
  username?: string;
}

/** Match pasted profile URLs across software:
 * Misskey/Sharkey/Pinetree + Mastodon `/@user`, `/@user@home`;
 * Pleroma `/user/<nick>`; shared `/users/<id-or-nick>`; Lemmy `/u/<nick>`.
 * Returns lookup candidates plus the URL's host. Anything else is not a
 * profile link. */
export function parseProfileUrl(url: string): ProfileRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const homeHost = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const atMatch = /^\/@([A-Za-z0-9_]+)(?:@([A-Za-z0-9.-]+))?\/?$/.exec(path);
  if (atMatch) {
    const home = (atMatch[2] ?? homeHost).toLowerCase();
    return {
      handle: `@${atMatch[1]}@${home}`,
      homeHost: home,
      rawUrl: url,
      username: atMatch[1],
    };
  }
  for (const pattern of [/^\/users\/([A-Za-z0-9_]+)\/?$/, /^\/user\/([A-Za-z0-9_]+)\/?$/, /^\/u\/([A-Za-z0-9_-]+)\/?$/]) {
    const match = pattern.exec(path);
    if (match) {
      return {
        handle: `@${match[1]}@${homeHost}`,
        homeHost,
        rawUrl: url,
        userId: match[1],
        username: match[1],
      };
    }
  }
  return null;
}

async function tryDetailed(ref: ProfileRef, ourHost: string | null): Promise<UserDetailed> {
  if (ref.userId) {
    try {
      return await apiCall<UserDetailed>("users/show", { userId: ref.userId });
    } catch {
      // Fall through to the username forms below.
    }
  }
  if (ref.username) {
    const host = ourHost && ref.homeHost === ourHost ? undefined : ref.homeHost;
    return await apiCall<UserDetailed>("users/show", {
      username: ref.username,
      ...(host ? { host } : {}),
    });
  }
  throw new Error("no username or user id in profile link");
}

/** Short human reason for a failed leg (`users/show: HTTP 401`). */
export function legReason(prefix: string, err: unknown): string {
  if (err instanceof ApiError) return `${prefix}: HTTP ${err.status}`;
  return `${prefix}: ${err instanceof Error ? err.message : "failed"}`;
}

async function tryRemote(ref: ProfileRef): Promise<RemoteAccount> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    // Numeric ids address `/accounts/:id`; otherwise look up by acct.
    const endpoint =
      ref.userId && /^[0-9]+$/.test(ref.userId)
        ? `https://${ref.homeHost}/api/v1/accounts/${encodeURIComponent(ref.userId)}`
        : `https://${ref.homeHost}/api/v1/accounts/lookup?acct=${encodeURIComponent(
            ref.username ? `${ref.username}@${ref.homeHost}` : ref.handle.replace(/^@/, ""),
          )}`;
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const account = asRemoteAccount(await response.json(), ref.homeHost);
    if (!account) throw new Error("unrecognized account shape");
    return account;
  } finally {
    clearTimeout(timer);
  }
}

type ResolvedProfile =
  | { kind: "detailed"; user: UserDetailed }
  | { kind: "remote"; account: RemoteAccount }
  | { kind: "unresolved"; reason: string };

async function resolveProfile(ref: ProfileRef, ourHost: string | null): Promise<ResolvedProfile> {
  try {
    return { kind: "detailed", user: await tryDetailed(ref, ourHost) };
  } catch (detailedErr) {
    const detailedReason = legReason("users/show", detailedErr);
    try {
      return { kind: "remote", account: await tryRemote(ref) };
    } catch (remoteErr) {
      return { kind: "unresolved", reason: `${detailedReason}; ${legReason("lookup", remoteErr)}` };
    }
  }
}

interface RemoteAccount {
  displayName: string;
  handle: string;
  bio: string;
  avatar: string | null;
  url: string | null;
  locked: boolean;
  bot: boolean;
  followers: number;
  following: number;
  statuses: number;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function htmlToText(html: string): string {
  try {
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
    return text.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** A Mastodon-compatible account object, validated field by field. */
function asRemoteAccount(value: unknown, homeHost: string): RemoteAccount | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.username !== "string" || typeof o.acct !== "string") {
    return null;
  }
  const acct = o.acct.includes("@") ? o.acct : `${o.acct}@${homeHost}`;
  return {
    displayName: typeof o.display_name === "string" && o.display_name ? o.display_name : o.username,
    handle: `@${acct}`,
    bio: typeof o.note === "string" ? htmlToText(o.note) : "",
    avatar: typeof o.avatar === "string" && o.avatar ? o.avatar : null,
    url: typeof o.url === "string" && o.url ? o.url : null,
    locked: o.locked === true,
    bot: o.bot === true,
    followers: asCount(o.followers_count),
    following: asCount(o.following_count),
    statuses: asCount(o.statuses_count),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise.then((v) => v as T | null, () => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function StatsLine(props: {
  followers: number;
  following: number;
  statuses: number;
  statusesLabel: string;
  locked: boolean;
  bot: boolean;
}) {
  return (
    <div class="handle profilecard-stats">
      {props.followers.toLocaleString()} followers ·{" "}
      {props.following.toLocaleString()} following ·{" "}
      {props.statuses.toLocaleString()} {props.statusesLabel}
      {props.locked ? " · locks follows" : ""}
      {props.bot ? " · automated" : ""}
    </div>
  );
}

function DetailedCard(props: { initial: UserDetailed }) {
  const auth = useAuth();
  const [user, setUser] = createSignal(props.initial);
  return (
    <div class="renote-embed profilecard">
      <div class="profilecard-head">
        <A href={`/users/${user().id}`} aria-label={`Open profile of ${displayNameOf(user())}`}>
          <Avatar url={user().avatarUrl} name={displayNameOf(user())} />
        </A>
        <div class="profilecard-id">
          <span class="name"><DisplayName name={headNameOf(user())} packed={user().emojis} /></span>
          <Show when={hasRealDisplayName(user())}>
            <span class="handle">{handleOf(user())}</span>
          </Show>
        </div>
        <span class="spacer" />
        <Show when={auth.token()}>
          <FollowButton user={user} onUpdate={setUser} />
        </Show>
      </div>
      <Show when={user().description}>
        <p class="bio"><DisplayName name={user().description ?? ""} packed={user().emojis} /></p>
      </Show>
      <StatsLine
        followers={user().followersCount}
        following={user().followingCount}
        statuses={user().notesCount}
        statusesLabel="notes"
        locked={user().isLocked}
        bot={user().isBot}
      />
      <div class="renote-foot">
        <A href={`/users/${user().id}`}>Open profile</A>
      </div>
    </div>
  );
}

function RemoteCard(props: { account: RemoteAccount; fallbackUrl: string }) {
  const target = () => props.account.url ?? props.fallbackUrl;
  return (
    <div class="renote-embed profilecard">
      <div class="profilecard-head">
        <a href={target()} target="_blank" rel="noopener noreferrer" aria-label={`Open profile of ${props.account.displayName}`}>
          <Avatar url={props.account.avatar} name={props.account.displayName} />
        </a>
        <div class="profilecard-id">
          <span class="name">{props.account.displayName}</span>
          <span class="handle">{props.account.handle}</span>
        </div>
      </div>
      <Show when={props.account.bio}>
        <p class="bio">{props.account.bio}</p>
      </Show>
      <StatsLine
        followers={props.account.followers}
        following={props.account.following}
        statuses={props.account.statuses}
        statusesLabel="posts"
        locked={props.account.locked}
        bot={props.account.bot}
      />
      <div class="renote-foot">
        <a href={target()} target="_blank" rel="noopener noreferrer">Open profile</a>
      </div>
    </div>
  );
}

/** Last resort: the URL was profile-shaped but details never resolved.
 * Shows the leg reasons so a failure can be reported precisely. */
function BasicChip(props: { profile: ProfileRef; reason: string }) {
  return (
    <div class="renote-embed profilecard">
      <div class="profilecard-head">
        <div class="profilecard-id">
          <span class="name">{props.profile.handle}</span>
          <span class="handle">Profile details unavailable ({props.reason})</span>
        </div>
        <span class="spacer" />
        <a href={props.profile.rawUrl} target="_blank" rel="noopener noreferrer">Open profile</a>
      </div>
    </div>
  );
}

export default function ProfileCardLoader(props: { profile: ProfileRef }) {
  const auth = useAuth();
  const [resolved] = createResource(
    () => `${props.profile.rawUrl}:${auth.token() ?? ""}`,
    () => withTimeout(resolveProfile(props.profile, ourBackendHost(auth.activeExternalHost())), RESOLVE_TIMEOUT_MS),
  );
  return (
    <Show when={!resolved.loading} fallback={
      <RowSkeletonList count={1} label="Loading profile card…" />
    }>
      <Show when={resolved() ?? { kind: "unresolved", reason: "timed out" } as const} fallback={null}>
        {(r) => {
          const value = r();
          if (value.kind === "detailed") return <DetailedCard initial={value.user} />;
          if (value.kind === "remote") {
            return <RemoteCard account={value.account} fallbackUrl={props.profile.rawUrl} />;
          }
          return <BasicChip profile={props.profile} reason={value.reason} />;
        }}
      </Show>
    </Show>
  );
}
