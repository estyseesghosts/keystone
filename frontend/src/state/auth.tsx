import { createContext, createSignal, onMount, useContext } from "solid-js";
import type { JSX } from "solid-js";
import {
  apiCall,
  apiCallPublic,
  clearStoredToken,
  getToken,
  mintAppToken,
  setStoredToken,
  signinFlow,
} from "../api/client";
import { IS_MISSKEY_FAMILY } from "../api/backend";
import type { MeDetailed, SigninResponse } from "../api/types";

interface AuthStore {
  token: () => string | null;
  me: () => MeDetailed | null;
  authReady: () => boolean;
  /** One-step sign-in: password -> scoped app session, no extra screens. */
  signin: (username: string, password: string) => Promise<void>;
  signout: () => void;
}

const AuthContext = createContext<AuthStore>();

// Native credential from POST /api/signin-flow (Misskey-family only). This
// is the user's FULL-AUTHORITY account token (SigninService returns
// `user.token` verbatim — permanent, not short-lived). It is held in this
// module variable only for the duration of the gen-token exchange below and
// never persisted: not in localStorage, not in a signal. Cleared
// (overwritten + nulled) as soon as the scoped app token is minted, or when
// the attempt fails.
let pendingNativeCredential: string | null = null;

function clearPendingNativeCredential(): void {
  pendingNativeCredential = "";
  pendingNativeCredential = null;
}

export function AuthProvider(props: { children: JSX.Element }) {
  const [token, setToken] = createSignal<string | null>(getToken());
  const [me, setMe] = createSignal<MeDetailed | null>(null);
  const [authReady, setAuthReady] = createSignal(false);

  const restore = async () => {
    const stored = getToken();
    if (!stored) {
      setAuthReady(true);
      return;
    }
    try {
      const user = await apiCall<MeDetailed>("i");
      setToken(stored);
      setMe(user);
    } catch {
      // Token invalid/expired: drop it and show the logged-out state. A
      // failed check must never leave an unusable token saved as the
      // active session.
      clearStoredToken();
      setToken(null);
      setMe(null);
    } finally {
      setAuthReady(true);
    }
  };

  onMount(() => {
    void restore();
  });

  const signin = async (username: string, password: string): Promise<void> => {
    clearPendingNativeCredential();
    if (!IS_MISSKEY_FAMILY) {
      const res = await apiCall<SigninResponse>("signin", { username, password });
      setStoredToken(res.token);
      setToken(res.token);
      setMe(res.user);
      return;
    }
    // Misskey-family: native sign-in via signinFlow, which sends no stored
    // token. Keystone is the first-party client and the permission set is
    // fixed and least-privilege, so a successful password check mints the
    // scoped app token directly — there is no second approval screen.
    const flow = await signinFlow(username, password);
    if (!flow.finished) {
      // The account needs a sign-in step Keystone does not implement
      // (2FA / passkey / captcha, per the server's `next` hint). Say so
      // plainly instead of sending the user to an instance page: the
      // product requirement is that auth stays inside Keystone.
      throw new Error(
        `This account needs an extra sign-in step ("${flow.next}") that Keystone does not support yet, so you cannot sign in with it here.`,
      );
    }
    pendingNativeCredential = flow.i;
    try {
      const appToken = await mintAppToken(pendingNativeCredential);
      // Verify the scoped token BEFORE storing it: a failed check must
      // not leave an unusable token saved as the active session.
      const user = await apiCallPublic<MeDetailed>("i", { i: appToken });
      setStoredToken(appToken);
      setToken(appToken);
      setMe(user);
    } finally {
      clearPendingNativeCredential();
    }
  };

  const signout = () => {
    // Best-effort server-side revocation (`i/revoke-token` revokes the
    // calling app token; unsupported servers 404). Local sign-out always
    // clears Keystone session state regardless of the outcome.
    const current = getToken();
    if (current) {
      apiCall<undefined>("i/revoke-token", {}).catch(() => {
        // Ignore: offline, already-revoked, or unsupported endpoint.
      });
    }
    clearPendingNativeCredential();
    clearStoredToken();
    setToken(null);
    setMe(null);
  };

  const store: AuthStore = {
    token,
    me,
    authReady,
    signin,
    signout,
  };
  return <AuthContext.Provider value={store}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
