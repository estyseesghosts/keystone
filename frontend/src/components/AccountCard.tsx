// Account card + menu (sidebar footer and mobile strip).
//
// Rounded-rect card with the active account's avatar, display name and
// handle. Clicking it opens a menu — Profile, Settings, Switch account —
// each with its own icon. Switch account lists the internal session plus
// every stored external session and links to the external login form.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { displayNameOf, handleOf } from "../api/types";
import {
  LogoutIcon,
  ProfileIcon,
  SettingsIcon,
  SwitchIcon,
} from "./icons";

function Avatar(props: { url: string | null; name: string; size: "card" | "menu" }) {
  return (
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

export default function AccountCard(props: { avatarOnly?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const [switching, setSwitching] = createSignal(false);
  let wrapRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;

  const close = () => {
    setOpen(false);
    setSwitching(false);
  };

  const onDocumentPointerDown = (e: PointerEvent) => {
    if (wrapRef && !wrapRef.contains(e.target as Node)) close();
  };

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open()) {
      close();
      buttonRef?.focus();
    }
  };

  // Dismiss listeners live only while the menu is open: the effect
  // subscribes on open and onCleanup unsubscribes on close/unmount.
  createEffect(() => {
    if (!open()) return;
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    });
  });

  const toggle = () => {
    if (open()) {
      close();
      return;
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
      class={props.avatarOnly ? "accountcard-wrap mobile" : "accountcard-wrap"}
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
              class={props.avatarOnly ? "accountcard icon-only" : "accountcard"}
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open()}
              aria-label={`Account: ${displayNameOf(user())} (${handleOf(user())}). Open account menu.`}
              title={`${displayNameOf(user())} (${handleOf(user())})`}
              ref={buttonRef}
            >
              <Avatar url={user().avatarUrl} name={displayNameOf(user())} size="card" />
              <Show when={!props.avatarOnly}>
                <span class="accountcard-text">
                  <span class="accountcard-name">{displayNameOf(user())}</span>
                  <span class="accountcard-handle">{handleOf(user())}</span>
                </span>
              </Show>
            </button>
            <Show when={open()}>
              <div class="accountmenu" role="menu" aria-label="Account">
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
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
