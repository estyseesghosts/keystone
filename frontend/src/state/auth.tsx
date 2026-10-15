import { createContext, createSignal, onMount, useContext } from "solid-js";
import type { JSX } from "solid-js";
import {
  apiCall,
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
  pendingGrant: () => boolean;
  beginSignin: (username: string, password: string) => Promise<{ grantRequired: boolean }>;
  grantKeystoneAccess: () => Promise<void>;
  cancelGrant: () => void;
  signout: () => void;
}

const AuthContext = createContext<AuthStore>();

// Temporary native credential from POST /api/signin-flow (Misskey-family
// only). Held in module-level memory for the gen-token exchange and never
// persisted: not in localStorage, not in a signal. Cleared (overwritten +
// nulled) as soon as the scoped app token is minted, or when the flow is
// cancelled / fails.
let pendingNativeCredential: string | null = null;

function clearPendingNativeCredential(): void {
  pendingNativeCredential = "";
  pendingNativeCredential = null;
}

export function AuthProvider(props: { children: JSX.Element }) {
  const [token, setToken] = createSignal<string | null>(getToken());
  const [me, setMe] = createSignal<MeDetailed | null>(null);
  const [authReady, setAuthReady] = createSignal(false);
  const [pendingGrant, setPendingGrant] = createSignal(false);

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
      // Token invalid/expired: drop it and show the logged-out state.
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

  const beginSignin = async (
    username: string,
    password: string,
  ): Promise<{ grantRequired: boolean }> => {
    // Drop any stale pending credential before starting a new attempt.
    clearPendingNativeCredential();
    setPendingGrant(false);
    if (!IS_MISSKEY_FAMILY) {
      const res = await apiCall<SigninResponse>("signin", { username, password });
      setStoredToken(res.token);
      setToken(res.token);
      setMe(res.user);
      return { grantRequired: false };
    }
    // Misskey-family: native sign-in via signinFlow, which sends no stored
    // token. The returned `i` is a temporary credential used only for the
    // Keystone-owned gen-token exchange below.
    const flow = await signinFlow(username, password);
    if (!flow.finished) {
      throw new Error(
        `Sign-in needs an extra step (${flow.next}). This account has 2FA/passkey/captcha enabled; finish it in the sizhuo instance UI first, then retry.`,
      );
    }
    pendingNativeCredential = flow.i;
    setPendingGrant(true);
    return { grantRequired: true };
  };

  const grantKeystoneAccess = async (): Promise<void> => {
    const temp = pendingNativeCredential;
    if (!temp) {
      throw new Error("No pending sign-in. Enter your username and password first.");
    }
    try {
      const appToken = await mintAppToken(temp);
      setStoredToken(appToken);
      const user = await apiCall<MeDetailed>("i");
      setToken(appToken);
      setMe(user);
    } finally {
      clearPendingNativeCredential();
      setPendingGrant(false);
    }
  };

  const cancelGrant = (): void => {
    clearPendingNativeCredential();
    setPendingGrant(false);
  };

  const signout = () => {
    clearStoredToken();
    setToken(null);
    setMe(null);
  };

  const store: AuthStore = {
    token,
    me,
    authReady,
    pendingGrant,
    beginSignin,
    grantKeystoneAccess,
    cancelGrant,
    signout,
  };
  return <AuthContext.Provider value={store}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
