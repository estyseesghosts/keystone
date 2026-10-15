import { createSignal, Show } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import LoadingState from "../components/LoadingState";

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
        <Navigate href="/" />
      </Show>
    </Show>
  );
}
