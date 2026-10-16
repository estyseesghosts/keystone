import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Navigate, useNavigate, useSearchParams } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { BACKEND_LABEL, BACKEND_URL, KEYSTONE_PERMISSIONS } from "../api/backend";
import {
  buildMiauthUrl,
  checkExternalSession,
  fetchExternalMe,
  newExternalSessionId,
  normalizeHost,
} from "../api/external";
import type { ExternalScheme } from "../api/external";
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

type LoginMode = "internal" | "external";

interface PendingExternal {
  scheme: ExternalScheme;
  host: string;
  session: string;
  url: string;
}

const CHECK_ATTEMPTS = 15;
const CHECK_INTERVAL_MS = 2000;

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = createSignal<LoginMode>(
    params.mode === "external" ? "external" : "internal",
  );
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // --- External MiAuth state (Keystone as an external client) ---
  const [extHost, setExtHost] = createSignal("");
  const [extPending, setExtPending] = createSignal<PendingExternal | null>(null);
  const [extBusy, setExtBusy] = createSignal(false);
  const [extStatus, setExtStatus] = createSignal<string | null>(null);
  const [extError, setExtError] = createSignal<string | null>(null);
  let pollCancelled = false;
  onCleanup(() => {
    pollCancelled = true;
  });

  // The host instance redirects back here after approval:
  // /login?extcb=1&host=<host>&scheme=<scheme>&session=<session>.
  // Finish the exchange automatically (same verification as the manual
  // "I've approved" path below).
  onMount(() => {
    if (params.extcb !== "1" || typeof params.session !== "string") return;
    const cbHost = typeof params.host === "string" ? params.host : "";
    const cbScheme: ExternalScheme = params.scheme === "http" ? "http" : "https";
    const cbSession = params.session;
    if (!cbHost || !cbSession) return;
    setMode("external");
    void finishExternal(cbScheme, cbHost, cbSession);
  });

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

  const callbackFor = (scheme: ExternalScheme, host: string): string =>
    `${window.location.origin}/login?extcb=1&host=${encodeURIComponent(host)}&scheme=${scheme}`;

  const startExternal = () => {
    if (extBusy()) return;
    setExtError(null);
    setExtStatus(null);
    let host: string;
    let scheme: ExternalScheme;
    try {
      ({ host, scheme } = normalizeHost(extHost()));
    } catch (err) {
      setExtError(err instanceof Error ? err.message : "Invalid host.");
      return;
    }
    const session = newExternalSessionId();
    const url = buildMiauthUrl(scheme, host, session, callbackFor(scheme, host));
    setExtPending({ scheme, host, session, url });
    // Approval happens OUTSIDE Keystone on the host instance (Keystone
    // never sees the password). A plain link is rendered as well, so a
    // blocked popup never strands the user.
    window.open(url, "_blank", "noopener");
    setExtStatus("Approve Keystone in the tab that just opened, then finish sign-in here.");
  };

  const finishExternal = async (
    scheme: ExternalScheme,
    host: string,
    session: string,
  ): Promise<void> => {
    if (extBusy()) return;
    pollCancelled = false;
    setExtBusy(true);
    setExtError(null);
    try {
      // Poll for the user's decision: { ok:false } means "not yet", not
      // an error. Network/API failures abort with a message instead.
      let token: string | null = null;
      for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
        if (pollCancelled) return;
        const check = await checkExternalSession(scheme, host, session);
        if (check.ok && check.token) {
          token = check.token;
          break;
        }
        setExtStatus(
          `Waiting for approval on ${host}… (${attempt + 1}/${CHECK_ATTEMPTS})`,
        );
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      }
      if (pollCancelled) return;
      if (!token) {
        throw new Error(
          `No approval arrived from ${host}. If you approved, open the authorize link again and retry — otherwise the request may have been denied.`,
        );
      }
      // Verify the issued token BEFORE storing it, mirroring the internal
      // flow: a failed check must not leave an unusable session around.
      const user = await fetchExternalMe(scheme, host, token);
      auth.addExternalSession({ scheme, host, token, user });
      setExtPending(null);
      navigate("/");
    } catch (err) {
      setExtStatus(null);
      setExtError(err instanceof Error ? err.message : "External sign-in failed.");
    } finally {
      setExtBusy(false);
    }
  };

  const confirmExternal = () => {
    const pending = extPending();
    if (!pending) return;
    void finishExternal(pending.scheme, pending.host, pending.session);
  };

  const cancelExternal = () => {
    pollCancelled = true;
    setExtPending(null);
    setExtStatus(null);
    setExtError(null);
    setExtBusy(false);
  };

  // Adding a second account while signed in must show the form: only
  // redirect away signed-in users who are not here to add an account.
  const addingAccount = () =>
    params.mode === "external" || params.extcb === "1";

  // The router may reuse this page across query changes
  // (/login -> /login?mode=external): follow the URL into the tabs.
  createEffect(() => {
    if (params.mode === "external" && mode() === "internal") {
      setMode("external");
    }
  });

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <Show when={!auth.me() || addingAccount()} fallback={<Navigate href="/" />}>
        <div>
          <div class="pagehead"><h1>Sign in</h1></div>
          <Show when={auth.me()}>
            <p class="handle">
              Signed in. Adding another account — switch between them from
              the account menu.
            </p>
          </Show>
          <div class="loginmodes" role="tablist" aria-label="Sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "internal"}
              class={mode() === "internal" ? "btn-primary" : undefined}
              onClick={() => setMode("internal")}
            >
              This server
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode() === "external"}
              class={mode() === "external" ? "btn-primary" : undefined}
              onClick={() => setMode("external")}
            >
              External server
            </button>
          </div>
          <Show when={mode() === "internal"} fallback={
            <div>
              <p>
                Sign in to a live Misskey/Sharkey instance with Keystone as an
                external client. Your password is entered on that instance
                only — Keystone never sees it.
              </p>
              <div class="form">
                <div class="field">
                  <label for="login-host">Instance host</label>
                  <input
                    id="login-host"
                    type="text"
                    autocomplete="off"
                    placeholder="example.com"
                    value={extHost()}
                    onInput={(e) => setExtHost(e.currentTarget.value)}
                  />
                </div>
                <Show when={!extPending()}>
                  <button type="button" class="btn-primary" disabled={extBusy()} onClick={startExternal}>
                    Continue to instance sign-in
                  </button>
                </Show>
                <Show when={extPending()}>
                  {(pending) => (
                    <>
                      <p class="handle">
                        Approve Keystone on {pending().host}, then come back
                        here. If no tab opened, use this link:
                      </p>
                      <p>
                        <a href={pending().url} target="_blank" rel="noopener noreferrer">
                          Open {pending().host} approval page
                        </a>
                      </p>
                      <Show when={extStatus()}>
                        <div class="state" role="status"><p>{extStatus()}</p></div>
                      </Show>
                      <div class="row">
                        <button type="button" class="btn-primary" disabled={extBusy()} onClick={confirmExternal}>
                          {extBusy() ? "Checking…" : "I've approved — finish sign-in"}
                        </button>
                        <button type="button" disabled={extBusy() && !extPending()} onClick={cancelExternal}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </Show>
                <Show when={extError()}>
                  <div class="err" role="alert">{extError()}</div>
                </Show>
              </div>
              <p class="handle">
                Keystone requests the same least-privilege token as the
                built-in sign-in, granted on the instance's own approval
                page. Switching back uses the account menu — both sessions
                stay signed in.
              </p>
            </div>
          }>
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
          </Show>
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
      </Show>
    </Show>
  );
}
