// Hover profile popup: hovering (or keyboard-focusing) a user's avatar or
// name in a note shows a compact profile card — banner header like
// docs/profile2.png, body content like docs/profile.png (avatar + Follow,
// display name, handle, bio, compact Following/Followers counts).
//
// Data comes from `users/show` (exists on all three backends; the response
// already carries `bannerUrl`, counts, and follow flags), cached per user id
// for the session so moving across a feed fetches each user once. Before the
// fetch resolves (or when it fails) the card still shows the `UserLite` the
// note already packed — avatar, name, handle, "Open profile" link — so the
// popup is never blank or stuck.
//
// Desktop-only: the popup opens only on `(hover: hover)` pointers (plus a
// CSS `hover: none` guard). On touch the tap target keeps its normal
// behavior — navigating to the profile route.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall } from "../api/client";
import type { UserDetailed, UserLite } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName } from "./EmojiPicker";
import { useAuth } from "../state/auth";
import { Avatar } from "./NoteBody";

// Session cache: one `users/show` per user no matter how many of their
// notes render. Follow toggles write through so the cache never goes stale.
const detailCache = new Map<string, UserDetailed>();

// Open delay avoids flashing a card on a passing pointer; close delay lets
// the pointer travel from the name/avatar onto the card itself.
const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 200;

/** Compact counts like profile.png (`30.7K`) with the full value on title. */
export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const whole = Math.floor(n);
  try {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(whole);
  } catch {
    if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(1)}M`;
    if (whole >= 1_000) return `${(whole / 1_000).toFixed(1)}K`;
    return String(whole);
  }
}

function HoverFollowButton(props: {
  target: UserDetailed;
  onUpdate: (u: UserDetailed) => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const pending = () => props.target.hasPendingFollowRequestFromYou === true;

  const toggle = async () => {
    if (busy() || pending()) return;
    setBusy(true);
    setError(null);
    try {
      if (props.target.isFollowing) {
        await apiCall<undefined>("following/delete", { userId: props.target.id });
      } else {
        await apiCall<undefined>("following/create", { userId: props.target.id });
      }
      // Follow state always comes back from the server: a locked account
      // yields a pending request, never an accepted follow.
      props.onUpdate(await apiCall<UserDetailed>("users/show", { userId: props.target.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span class="hovercard-follow">
      <button type="button" disabled={busy() || pending()} onClick={() => void toggle()}>
        {busy() ? "…" : pending() ? "Requested" : props.target.isFollowing ? "Unfollow" : "Follow"}
      </button>
      <Show when={error()}>
        <span class="hovercard-err" role="alert">{error()}</span>
      </Show>
    </span>
  );
}

export default function UserHover(props: { user: UserLite; children: JSX.Element }) {
  const auth = useAuth();
  const [open, setOpen] = createSignal(false);
  const [detail, setDetail] = createSignal<UserDetailed | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  let wrap: HTMLSpanElement | undefined;

  const userId = () => props.user.id;

  const hoverable = () =>
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(hover: hover)").matches;

  const clearTimers = () => {
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  onCleanup(clearTimers);

  const ensureDetail = async () => {
    const id = userId();
    const hit = detailCache.get(id);
    if (hit) {
      setDetail(hit);
      return;
    }
    const mine = ++request;
    setLoading(true);
    setError(null);
    try {
      const fetched = await apiCall<UserDetailed>("users/show", { userId: id });
      detailCache.set(id, fetched);
      if (mine === request && open() && userId() === id) setDetail(fetched);
    } catch (err) {
      if (mine === request && open() && userId() === id) {
        setError(err instanceof Error ? err.message : "Could not load profile.");
      }
    } finally {
      if (mine === request) setLoading(false);
    }
  };

  const scheduleOpen = () => {
    if (!hoverable()) return;
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    if (open() || openTimer !== undefined) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      setOpen(true);
      void ensureDetail();
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (closeTimer !== undefined) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const cancelClose = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };

  // While open: Escape, page scroll, or a click outside the card dismisses.
  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onDocClick = (e: MouseEvent) => {
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onDocClick);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", onDocClick);
    });
  });

  const canFollow = (id: string) => !!auth.token() && auth.me()?.id !== id;

  return (
    <span
      class="hoverwrap"
      ref={(el) => {
        wrap = el;
      }}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocusIn={scheduleOpen}
      onFocusOut={scheduleClose}
    >
      {props.children}
      <Show when={open()}>
        <span
          class="hovercard"
          role="dialog"
          aria-label={`Profile preview for ${displayNameOf(props.user)}`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <Show
            when={detail()}
            fallback={
              <span class="hovercard-body hovercard-plain">
                <span class="hovercard-row">
                  <span class="hovercard-ava">
                    <Avatar url={props.user.avatarUrl} name={displayNameOf(props.user)} />
                  </span>
                </span>
                <span class="hovercard-name"><DisplayName name={headNameOf(props.user)} packed={props.user.emojis} /></span>
                <Show when={hasRealDisplayName(props.user)}>
                  <span class="handle">{handleOf(props.user)}</span>
                </Show>
                <Show
                  when={!loading()}
                  fallback={
                    <span class="handle" role="status">Loading profile…</span>
                  }
                >
                  <Show when={error()}>
                    {(message) => (
                      <span class="hovercard-err" role="alert">
                        {message()}{" "}
                        <button type="button" onClick={() => void ensureDetail()}>
                          Retry
                        </button>
                      </span>
                    )}
                  </Show>
                </Show>
                <span class="renote-foot">
                  <A href={`/users/${props.user.id}`}>Open profile</A>
                </span>
              </span>
            }
          >
            {(detailed) => (
              <>
                <Show when={detailed().bannerUrl}>
                  <img class="hovercard-banner" src={detailed().bannerUrl!} alt="" loading="lazy" />
                </Show>
                <span
                  class={
                    detailed().bannerUrl ? "hovercard-body hovercard-overlap" : "hovercard-body hovercard-plain"
                  }
                >
                  <span class="hovercard-row">
                    <span class="hovercard-ava">
                      <Avatar url={detailed().avatarUrl} name={displayNameOf(detailed())} />
                    </span>
                    <span class="spacer" aria-hidden="true" />
                    <Show when={canFollow(detailed().id)}>
                      <HoverFollowButton
                        target={detailed()}
                        onUpdate={(u) => {
                          detailCache.set(u.id, u);
                          setDetail(u);
                        }}
                      />
                    </Show>
                  </span>
                  <A class="hovercard-name" href={`/users/${detailed().id}`}>
                    <DisplayName name={displayNameOf(detailed())} packed={detailed().emojis} />
                  </A>
                  <span class="handle">
                    {handleOf(detailed())}
                    {detailed().isLocked ? " · locked" : ""}
                    {detailed().isBot ? " · automated" : ""}
                  </span>
                  <Show when={detailed().description}>
                    <span class="hovercard-bio"><DisplayName name={detailed().description ?? ""} packed={detailed().emojis} /></span>
                  </Show>
                  <span
                    class="handle hovercard-stats"
                    title={`${detailed().notesCount.toLocaleString()} notes · ${detailed().followingCount.toLocaleString()} following · ${detailed().followersCount.toLocaleString()} followers`}
                  >
                    {formatCompactCount(detailed().notesCount)} notes ·{" "}
                    {formatCompactCount(detailed().followingCount)} following ·{" "}
                    {formatCompactCount(detailed().followersCount)} followers
                  </span>
                  <span class="renote-foot">
                    <A href={`/users/${detailed().id}`}>Open profile</A>
                  </span>
                </span>
              </>
            )}
          </Show>
        </span>
      </Show>
    </span>
  );
}
