import { createContext, createSignal, onMount, useContext } from "solid-js";
import type { JSX } from "solid-js";
import { apiCall, clearStoredToken, getToken, setStoredToken } from "../api/client";
import type { MeDetailed, SigninResponse } from "../api/types";

interface AuthStore {
  token: () => string | null;
  me: () => MeDetailed | null;
  authReady: () => boolean;
  signin: (username: string, password: string) => Promise<void>;
  signout: () => void;
}

const AuthContext = createContext<AuthStore>();

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

  const signin = async (username: string, password: string) => {
    const res = await apiCall<SigninResponse>("signin", { username, password });
    setStoredToken(res.token);
    setToken(res.token);
    setMe(res.user);
  };

  const signout = () => {
    clearStoredToken();
    setToken(null);
    setMe(null);
  };

  const store: AuthStore = { token, me, authReady, signin, signout };
  return <AuthContext.Provider value={store}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
