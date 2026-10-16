// Account card + menu (sidebar footer and mobile strip).
//
// The active account as avatar + name + handle (competitor-style),
// shown in the expanded sidebar only: the rail and the mobile strip
// stay avatar-only. Clicking it opens a menu — Profile, Settings,
// Switch account — each with its own icon. Switch account lists the
// internal session plus every stored external session and links to
// the external login form.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import {
  LogoutIcon,
  ProfileIcon,
  SettingsIcon,
  SwitchIcon,
} from "./icons";

function Avatar(props: { url: string | null; name: string; size: "card" | "menu" }) {  return (
    <Show
      when={props.url}
      fallback={
        <span
          class={props.size === "card" ? "accountcard-fallback" : "accountmenu-fallback"}
          aria-hidden="true"
        >
          {props.name.slice(0, 1).toUpperCase()}
        </span>
      }
    >
      <img
        class={props.size === "card" ? "accountcard-avatar" : "accountmenu-avatar"}
        src={props.url!}
        alt=""
      />
    </Show>
  );
}

// Matches the narrow-desktop rail band in global.css
// (`@media (min-width: 721px) and (max-width: 1000px)`) and the mobile
// breakpoint (`max-width: 720px`): keep all three in sync. Touch-only
// or SSR environments never match.
function isRail(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 721px) and (max-width: 1000px)").matches
  );
}

function isMobile(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 720px)").matches
  );
}

/** Viewport-fixed menu position, measured from the button at toggle
 * time. `up` opens above the button (sidebar footer); `down` opens
 * below it (mobile top strip). */
type MenuPos =
  | { kind: "up"; left: number; bottom: number }
  | { kind: "down"; top: number; right: number };

/** Viewport-fixed flyout style for the menu (never CSS-anchored: the
 * menu always renders in a Portal, so it escapes the sidebar subtree
 * entirely — no clipping, no stacking-context trap, no inherited
 * pointer-events; paint and hit-testing both resolve against the
 * page). */
function flyoutStyle(pos: MenuPos | null): Record<string, string> | undefined {
  if (!pos) return undefined;
  return pos.kind === "up"
    ? {
        position: "fixed",
        left: `${pos.left}px`,
        bottom: `${pos.bottom}px`,
        top: "auto",
        right: "auto",
      }
    : {
        position: "fixed",
        top: `${pos.top}px`,
        right: `${pos.right}px`,
        bottom: "auto",
        left: "auto",
      };
}

export default function AccountCard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const [switching, setSwitching] = createSignal(false);
  // Viewport-fixed menu position, measured from the button at toggle
  // time in every placement (the menu always portals to the body, so
  // CSS anchoring never applies).
  const [menuPos, setMenuPos] = createSignal<MenuPos | null>(null);
  let wrapRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  // The rail flyout renders in a Portal (outside this wrap), so
  // outside-click detection must accept clicks in either root.
  let menuRef: HTMLDivElement | undefined;

  const close = () => {
    setOpen(false);
    setSwitching(false);
    setMenuPos(null);
    menuRef = undefined;
  };

  const onDocumentPointerDown = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!target) {
      close();
      return;
    }
    if (wrapRef?.contains(target) || menuRef?.contains(target)) return;
    close();
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open()) {
      close();
      buttonRef?.focus();
    }
  };

  // Dismiss listeners live only while the menu is open: the effect
  // subscribes on open and onCleanup unsubscribes on close/unmount.
  // Resize and scroll also dismiss: a fixed flyout would otherwise go
  // stale (and scrolling with a menu open is never intended here —
  // hover cards already behave this way).
  createEffect(() => {
    if (!open()) return;
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    });
  });

  const toggle = () => {
    if (open()) {
      close();
      return;
    }
    if (buttonRef) {
      // Measure the button in every placement: the menu portals to the
      // body with viewport-fixed coordinates, so it can never be
      // clipped or underlaid by page content. Rail: right of the
      // avatar, above the button. Expanded sidebar: above the button,
      // left-aligned (same visual as the old CSS anchor). Mobile strip:
      // below the button, right-aligned.
      const rect = buttonRef.getBoundingClientRect();
      if (isRail()) {
        setMenuPos({
          kind: "up",
          left: rect.right + 8,
          bottom: window.innerHeight - rect.top + 8,
        });
      } else if (isMobile()) {
        setMenuPos({
          kind: "down",
          top: rect.bottom + 8,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      } else {
        setMenuPos({
          kind: "up",
          left: rect.left,
          bottom: window.innerHeight - rect.top + 8,
        });
      }
    } else {
      setMenuPos(null);
    }
    setOpen(true);
  };

  const go = (href: string) => {
    close();
    navigate(href);
  };

  const signout = () => {
    close();
    auth.signout();
    navigate("/login");
  };

  const switchTo = (host: string | null) => {
    auth.switchAccount(host);
    close();
  };

  const me = () => auth.me();

  return (
    <div
      class="accountcard-wrap"
      ref={wrapRef}
    >
      <Show
        when={me()}
        fallback={
          <A class="accountcard-signin" href="/login">
            Sign in
          </A>
        }
      >
        {(user) => (
          <>
            <button
              type="button"
              class="accountcard"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open()}
              aria-label={`Account: ${displayNameOf(user())} (${handleOf(user())}). Open account menu.`}
              title={`${displayNameOf(user())} (${handleOf(user())})`}
              ref={buttonRef}
            >
              <Avatar url={user().avatarUrl} name={displayNameOf(user())} size="card" />
              <span class="accountcard-text">
                <span class="accountcard-name">{headNameOf(user())}</span>
                <Show when={hasRealDisplayName(user())}>
                  <span class="accountcard-handle">{handleOf(user())}</span>
                </Show>
              </span>
            </button>
            <Show when={open()}>
              <Portal>
              <div
                class="accountmenu"
                role="menu"
                aria-label="Account"
                style={flyoutStyle(menuPos())}
                ref={(el) => {
                  menuRef = el;
                }}
              >
                <button
                  type="button"
                  class="accountmenu-item"
                  role="menuitem"
                  onClick={() => go(`/users/${user().id}`)}
                >
                  <span class="accountmenu-icon">
                    <ProfileIcon />
                  </span>
                  <span>Profile</span>
                </button>
                <button
                  type="button"
                  class="accountmenu-item"
                  role="menuitem"
                  onClick={() => go("/settings")}
                >
                  <span class="accountmenu-icon">
                    <SettingsIcon />
                  </span>
                  <span>Settings</span>
                </button>
                <button
                  type="button"
                  class="accountmenu-item"
                  role="menuitem"
                  aria-expanded={switching()}
                  onClick={() => setSwitching((v) => !v)}
                >
                  <span class="accountmenu-icon">
                    <SwitchIcon />
                  </span>
                  <span>Switch account</span>
                </button>
                <Show when={switching()}>
                  <div class="accountswitch" role="group" aria-label="Accounts">
                    <button
                      type="button"
                      class="accountswitch-item"
                      aria-current={!auth.isExternalActive()}
                      onClick={() => switchTo(null)}
                    >
                      <Avatar
                        url={auth.internalMe()?.avatarUrl ?? null}
                        name={
                          auth.internalMe()
                            ? displayNameOf(auth.internalMe()!)
                            : auth.backendLabel
                        }
                        size="menu"
                      />
                      <span class="accountswitch-text">
                        <span class="accountswitch-name">
                          {auth.backendLabel} (this server)
                        </span>
                        <span class="accountswitch-handle">
                          {auth.internalMe()
                            ? handleOf(auth.internalMe()!)
                            : "Not signed in"}
                        </span>
                      </span>
                      <Show when={!auth.isExternalActive()}>
                        <span class="accountswitch-check" aria-hidden="true">
                          ✓
                        </span>
                      </Show>
                    </button>
                    <For each={auth.externalSessions()}>
                      {(sess) => (
                        <div class="accountswitch-row">
                          <button
                            type="button"
                            class="accountswitch-item"
                            aria-current={
                              auth.isExternalActive() &&
                              auth.me()?.id === sess.user.id
                            }
                            onClick={() => switchTo(sess.host)}
                          >
                            <Avatar
                              url={sess.user.avatarUrl}
                              name={displayNameOf(sess.user)}
                              size="menu"
                            />
                            <span class="accountswitch-text">
                              <span class="accountswitch-name">{sess.host}</span>
                              <span class="accountswitch-handle">
                                {handleOf(sess.user)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            class="accountswitch-remove"
                            aria-label={`Remove ${sess.host} (${handleOf(sess.user)})`}
                            title={`Remove ${sess.host}`}
                            onClick={() => auth.removeExternalAccount(sess.host)}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                    <A
                      class="accountswitch-add"
                      href="/login?mode=external"
                      onClick={close}
                    >
                      Add external account…
                    </A>
                  </div>
                </Show>
                <div class="accountmenu-sep" aria-hidden="true" />
                <button
                  type="button"
                  class="accountmenu-item"
                  role="menuitem"
                  onClick={signout}
                >
                  <span class="accountmenu-icon">
                    <LogoutIcon />
                  </span>
                  <span>Sign out</span>
                </button>
              </div>
              </Portal>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
