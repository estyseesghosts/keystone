import { createSignal, For, Show } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { BACKEND_LABEL, BACKEND_URL, KEYSTONE_PERMISSIONS } from "../api/backend";
import LoadingState from "../components/LoadingState";

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "read:account": "Read your account info and timelines",
  "write:notes": "Post, delete, and un-repost notes",
  "write:reactions": "Add and remove reactions",
  "write:following": "Follow and unfollow users",
  "read:following": "See incoming follow requests",
  "read:notifications": "Read your notifications",
  "write:notifications": "Mark notifications as read",
  "read:drive": "List your Drive files",
  "write:drive": "Upload to your Drive",
  "write:account": "Manage antennas and edit your profile",
  "write:votes": "Vote in polls",
};

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await auth.signin(username().trim(), password());
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <Show when={auth.me()} fallback={
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
          <p class="handle">
            Signing in mints a scoped Keystone token with least-privilege
            access — your password is used once for this sign-in and is never
            stored. Keystone requests:
          </p>
          <ul>
            <For each={KEYSTONE_PERMISSIONS}>
              {(perm) => (
                <li>
                  <strong>{perm}</strong> — {PERMISSION_DESCRIPTIONS[perm] ?? perm}
                </li>
              )}
            </For>
          </ul>
        </div>
      }>
        <Navigate href="/" />
      </Show>
    </Show>
  );
}
