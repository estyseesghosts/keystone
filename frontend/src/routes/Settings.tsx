// Settings: session info + bounded profile editor.
//
// The editor is the shared `ProfileEditor` (same `i/update` subset as the
// own-profile view). Account switching lives in the account-card menu;
// this page names it so nobody hunts for it.

import { Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { BACKEND_URL } from "../api/backend";
import { displayNameOf, handleOf } from "../api/types";
import LoadingState from "../components/LoadingState";
import ProfileEditor from "../components/ProfileEditor";

export default function Settings() {
  const auth = useAuth();
  const navigate = useNavigate();

  const signout = () => {
    auth.signout();
    navigate("/login");
  };

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <div class="pagehead">
        <h1>Settings</h1>
      </div>
      <Show
        when={auth.me()}
        fallback={
          <div class="state">
            <p>You are signed out.</p>
            <A href="/login">Sign in</A>
          </div>
        }
      >
        {(user) => (
          <>
            <div class="settings-block">
              <h2>Account</h2>
              <p class="handle">
                {auth.isExternalActive()
                  ? `External account on ${auth.activeExternalHost() ?? "unknown host"}`
                  : `${auth.backendLabel} (${BACKEND_URL})`}
              </p>
              <p>
                {displayNameOf(user())} ({handleOf(user())})
              </p>
              <Show when={auth.isExternalActive()}>
                <p class="handle">
                  Live updates are off for external accounts — timelines
                  still load and refresh normally.
                </p>
              </Show>
              <p class="handle">
                To change accounts, use Switch account in the account menu.
              </p>
              <button type="button" onClick={signout}>
                Sign out
              </button>
            </div>
            <div class="settings-block">
              <h2>Edit profile</h2>
              {/* Remount per account: the editor takes initial values from
                  props, so an account switch must not reuse a stale form. */}
              <Show when={user().id} keyed>
                {(_accountId: string) => (
                  <ProfileEditor
                    me={user()}
                    onSaved={() => {
                      void auth.refreshMe().catch(() => {
                        // Non-fatal: the editor already shows the saved values.
                      });
                    }}
                  />
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </Show>
  );
}
