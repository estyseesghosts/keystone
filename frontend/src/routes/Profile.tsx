import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { apiCall, isUnsupportedError } from "../api/client";
import type { Note, UserDetailed } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName } from "../components/EmojiPicker";
import { listUserFeaturedNotes, listFeaturedNotes } from "../api/featured";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import FollowList from "../components/FollowList";
import MfmRenderer from "../components/MfmRenderer";
import NoteCard from "../components/NoteCard";
import ProfileNotesList from "../components/ProfileNotesList";
import type { ProfileTab } from "../components/ProfileNotesList";
import { NoteSkeletonList, ProfileSkeleton } from "../components/Skeleton";
import ProfileEditor from "../components/ProfileEditor";
import UserActions from "../components/UserActions";
import UserReactions from "../components/UserReactions";

export default function Profile() {
  const params = useParams();
  const auth = useAuth();
  const [user, setUser] = createSignal<UserDetailed | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  // Default tab: Posts. Featured reads `pinnedNoteIds/pinnedNotes` from
  // `users/show` (plus `users/featured-notes` ranking where served) — the
  // tab ships absent only when the backend packs no source (never faked).
  const [tab, setTab] = createSignal<ProfileTab | "featured">("posts");
  const [featured, setFeatured] = createSignal<Note[] | null>(null);
  const [featuredState, setFeaturedState] = createSignal<"idle" | "loading" | "ready" | "unsupported" | "error">("idle");
  const [featuredError, setFeaturedError] = createSignal<string | null>(null);

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

  const tabClass = (name: ProfileTab | "featured") =>
    tab() === name ? "profile-tab active" : "profile-tab";

  /** Featured source (§9): packed `pinnedNotes` first, then the
   * `users/featured-notes` ranking view, then the global `notes/featured`
   * ranking filtered to this user. Absent (never faked) when the backend
   * serves none of them. */
  const loadFeatured = async (u: UserDetailed) => {
    if (u.pinnedNotes && u.pinnedNotes.length > 0) {
      setFeatured(u.pinnedNotes);
      setFeaturedState("ready");
      return;
    }
    if (u.pinnedNoteIds && u.pinnedNoteIds.length === 0) {
      setFeatured([]);
      setFeaturedState("ready");
      return;
    }
    setFeaturedState("loading");
    setFeaturedError(null);
    try {
      const notes = await listUserFeaturedNotes(u.id, 20);
      // Prefer packed pins when both exist (explicit pins win over rank).
      setFeatured(u.pinnedNotes && u.pinnedNotes.length > 0 ? u.pinnedNotes : notes);
      setFeaturedState("ready");
    } catch (err) {
      if (isUnsupportedError(err)) {
        // No per-user ranking view: try the global ranking filtered down.
        try {
          const global = await listFeaturedNotes(50);
          setFeatured(global.filter((n) => n.userId === u.id));
          setFeaturedState("ready");
        } catch (inner) {
          if (isUnsupportedError(inner)) {
            if (u.pinnedNotes && u.pinnedNotes.length > 0) {
              setFeatured(u.pinnedNotes);
              setFeaturedState("ready");
            } else {
              setFeatured(null);
              setFeaturedState("unsupported");
            }
          } else {
            setFeaturedError(inner instanceof Error ? inner.message : "Could not load featured notes.");
            setFeaturedState("error");
          }
        }
      } else {
        setFeaturedError(err instanceof Error ? err.message : "Could not load featured notes.");
        setFeaturedState("error");
      }
    }
  };

  const hasFeaturedSource = () => {
    const u = user();
    if (!u) return false;
    if (u.pinnedNotes && u.pinnedNotes.length > 0) return true;
    if (u.pinnedNoteIds && u.pinnedNoteIds.length > 0) return true;
    return featuredState() !== "unsupported";
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
                    <h2><DisplayName name={headNameOf(current())} packed={current().emojis} host={current().host} /></h2>
                    <Show when={hasRealDisplayName(current())}>
                      <div class="handle">{handleOf(current())}</div>
                    </Show>
                    <Show when={current().isLocked}>
                      <div class="handle">Locked account</div>
                    </Show>
                    <Show when={current().description}>
                      <div class="bio"><MfmRenderer text={current().description} emojis={current().emojis} host={current().host} /></div>
                    </Show>
                    <div class="stats">
                      <span>{current().notesCount.toLocaleString()} notes</span>
                      <Show
                        when={current().ffVisibility === "private" && !isSelf()}
                        fallback={
                          <Show
                            when={current().ffVisibility === "followers" && !isSelf() && !current().isFollowing}
                            fallback={
                              <>
                                <A class="statlink" href={`/users/${current().id}/following`}>
                                  {current().followingCount.toLocaleString()} Following
                                </A>
                                <A class="statlink" href={`/users/${current().id}/followers`}>
                                  {current().followersCount.toLocaleString()} Followers
                                </A>
                              </>
                            }
                          >
                            <span class="handle">Following — followers only</span>
                            <span class="handle">Followers — followers only</span>
                          </Show>
                        }
                      >
                        <span class="handle">Following — owner only</span>
                        <span class="handle">Followers — owner only</span>
                      </Show>
                    </div>
                    <Show when={current().ffVisibility === "private" && !isSelf()}>
                      <div class="handle">Only the account owner can see the follow lists.</div>
                    </Show>
                    <Show when={current().ffVisibility === "followers" && !isSelf() && !current().isFollowing}>
                      <div class="handle">Only followers can see the follow lists.</div>
                    </Show>
                    <Show when={canFollow() || isSelf()}>
                      <UserActions userId={current().id} isSelf={isSelf()} />
                    </Show>
                    <div class="row">
                      <UserReactions userId={current().id} isRemote={current().host !== null} />
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
                  <Show when={hasFeaturedSource() || tab() === "featured"}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab() === "featured"}
                      class={tabClass("featured")}
                      onClick={() => {
                        setTab("featured");
                        const u = user();
                        if (u && featuredState() !== "ready" && featuredState() !== "loading") {
                          void loadFeatured(u);
                        }
                      }}
                    >
                      Featured
                    </button>
                  </Show>
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
                <Show when={tab() === "featured"}>
                  <Show when={featuredState() === "ready" && featured()} fallback={
                    <Show when={featuredState() === "unsupported"} fallback={
                      <Show when={featuredState() === "error"} fallback={
                        <NoteSkeletonList label="Loading featured…" />
                      }>
                        <ErrorState
                          message={featuredError() ?? "Could not load featured notes."}
                          onRetry={() => {
                            const u = user();
                            if (u) void loadFeatured(u);
                          }}
                        />
                      </Show>
                    }>
                      <div class="state" role="status">
                        <p>No featured notes on this server.</p>
                      </div>
                    </Show>
                  }>
                    <Show when={featured()!.length > 0} fallback={
                      <div class="state"><p>No pinned notes.</p></div>
                    }>
                      <div class="feed">
                        <For each={featured()!}>
                          {(n) => <NoteCard note={n} />}
                        </For>
                      </div>
                    </Show>
                  </Show>
                </Show>
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
