import { createSignal, For, Show } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { BACKEND_LABEL, BACKEND_URL, KEYSTONE_PERMISSIONS } from "../api/backend";
import LoadingState from "../components/LoadingState";

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "read:account": "Read your account info",
  "write:notes": "Post and delete notes",
  "write:reactions": "Add and remove reactions",
  "write:following": "Follow and unfollow users",
  "read:notifications": "Read your notifications",
};

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [grantBusy, setGrantBusy] = createSignal(false);
  const [grantError, setGrantError] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.beginSignin(username().trim(), password());
      if (!res.grantRequired) {
        // Pinetree: signed in directly.
        navigate("/");
      }
      // Misskey-family: pendingGrant() is now true, so the permission
      // screen below renders.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const allow = async () => {
    if (grantBusy()) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await auth.grantKeystoneAccess();
      navigate("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not grant access.";
      setGrantError(message);
      // The pending credential is cleared on failure, so the form shows
      // again: surface the message there too.
      setError(message);
    } finally {
      setGrantBusy(false);
    }
  };

  const deny = () => {
    auth.cancelGrant();
    setGrantError(null);
    setError("Access not granted.");
  };

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <Show when={auth.me()} fallback={
        <Show when={auth.pendingGrant()} fallback={
          <div>
            <div class="pagehead"><h1>Sign in</h1></div>
            <p>Sign in to {BACKEND_LABEL} ({BACKEND_URL})</p>
            <form class="form" onSubmit={submit}>
              <div class="field">
                <label for="login-username">Username</label>
                <input
                  id="login-username"
                  type="text"
                  autocomplete="username"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                />
              </div>
              <div class="field">
                <label for="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  autocomplete="current-password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
              </div>
              <Show when={error()}>
                <div class="err" role="alert">{error()}</div>
              </Show>
              <button type="submit" class="btn-primary" disabled={busy()}>
                {busy() ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>
        }>
          <div>
            <div class="pagehead"><h1>Grant Keystone access</h1></div>
            <p>Keystone is requesting access to your {BACKEND_LABEL} account with these permissions:</p>
            <ul>
              <For each={KEYSTONE_PERMISSIONS}>
                {(perm) => (
                  <li>
                    <strong>{perm}</strong> — {PERMISSION_DESCRIPTIONS[perm] ?? perm}
                  </li>
                )}
              </For>
            </ul>
            <Show when={grantError()}>
              <div class="err" role="alert">{grantError()}</div>
            </Show>
            <button type="button" class="btn-primary" disabled={grantBusy()} onClick={allow}>
              {grantBusy() ? "Granting…" : "Allow"}
            </button>
            <button type="button" disabled={grantBusy()} onClick={deny}>
              Deny
            </button>
          </div>
        </Show>
      }>
        <Navigate href="/" />
      </Show>
    </Show>
  );
}
