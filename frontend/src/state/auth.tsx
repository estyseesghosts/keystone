import { createContext, createMemo, createSignal, onMount, useContext } from "solid-js";
import type { JSX } from "solid-js";
import {
  apiCallInternal,
  apiCallPublic,
  clearStoredToken,
  getToken,
  mintAppToken,
  setStoredToken,
  signinFlow,
} from "../api/client";
import {
  fetchExternalMe,
  getActiveExternal,
  getActiveExternalHost,
  loadExternalSessions,
  removeExternalSession,
  revokeExternalToken,
  saveExternalSession,
  setActiveExternalHost,
  updateExternalSessionUser,
} from "../api/external";
import type { ExternalSession } from "../api/external";
import { BACKEND_LABEL, IS_MISSKEY_FAMILY } from "../api/backend";
import type { MeDetailed, SigninResponse } from "../api/types";

interface AuthStore {
  /** Active session token: the external token when an external account is
   * active, the internal per-backend token otherwise. */
  token: () => string | null;
  /** Active session user (same routing as `token`). */
  me: () => MeDetailed | null;
  authReady: () => boolean;
  /** One-step internal sign-in: password -> scoped app session, no extra
   * screens. Unchanged by external accounts. */
  signin: (username: string, password: string) => Promise<void>;
  /** Re-read `i` into the active session (e.g. after a profile edit). */
  refreshMe: () => Promise<void>;
  /** Sign out of the ACTIVE account only. An external sign-out removes
   * that external session and falls back to the internal account (which is
   * left exactly as it was); an internal sign-out behaves as before. */
  signout: () => void;
  // --- External accounts (Keystone as an external client) ---
  /** Stored external sessions (one per host). */
  externalSessions: () => ExternalSession[];
  /** Host of the active external account, or null for internal. */
  activeExternalHost: () => string | null;
  /** True when an external account is the active session. */
  isExternalActive: () => boolean;
  /** The internal (proxy-backend) user, regardless of active account. */
  internalMe: () => MeDetailed | null;
  /** Label of the internal backend (for the account switcher). */
  backendLabel: string;
  /** Store a verified external session and make it active. */
  addExternalSession: (session: ExternalSession) => void;
  /** Switch the active account: an external host, or null for internal. */
  switchAccount: (host: string | null) => void;
  /** Forget an external session (signing it out if active). */
  removeExternalAccount: (host: string) => void;
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
  const [internalToken, setInternalToken] = createSignal<string | null>(getToken());
  const [internalMe, setInternalMe] = createSignal<MeDetailed | null>(null);
  const [authReady, setAuthReady] = createSignal(false);
  const [externalSessions, setExternalSessions] = createSignal<ExternalSession[]>(
    loadExternalSessions(),
  );
  const [activeExternalHost, setActiveExternalHostSignal] = createSignal<string | null>(
    getActiveExternalHost(),
  );

  // The active external session, or null for the internal account. A stale
  // stored pointer (host with no session) resolves to null here and is
  // repaired below, so the UI can never sit on a half session.
  const activeExternal = createMemo(() => {
    const host = activeExternalHost();
    if (!host) return null;
    return externalSessions().find((s) => s.host === host) ?? null;
  });

  const restore = async () => {
    // Drop a stale active-external pointer before anything reads it.
    if (getActiveExternalHost() && !getActiveExternal()) {
      setActiveExternalHost(null);
      setActiveExternalHostSignal(null);
    }
    // Internal restore is exactly as before: stored per-backend token ->
    // `i`, failure clears it and shows logged-out. Always the internal
    // path, even while an external account is active.
    const stored = getToken();
    if (!stored) {
      setAuthReady(true);
      return;
    }
    try {
      const user = await apiCallInternal<MeDetailed>("i");
      setInternalToken(stored);
      setInternalMe(user);
    } catch {
      // Token invalid/expired: drop it and show the logged-out state. A
      // failed check must never leave an unusable token saved as the
      // active session.
      clearStoredToken();
      setInternalToken(null);
      setInternalMe(null);
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
      const res = await apiCallInternal<SigninResponse>("signin", { username, password });
      setStoredToken(res.token);
      setInternalToken(res.token);
      setInternalMe(res.user);
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
      setInternalToken(appToken);
      setInternalMe(user);
    } finally {
      clearPendingNativeCredential();
    }
  };

  const signoutInternal = () => {
    // Best-effort server-side revocation (`i/revoke-token` revokes the
    // calling app token; unsupported servers 404). Local sign-out always
    // clears Keystone session state regardless of the outcome.
    const current = getToken();
    if (current) {
      apiCallInternal<undefined>("i/revoke-token", {}).catch(() => {
        // Ignore: offline, already-revoked, or unsupported endpoint.
      });
    }
    clearPendingNativeCredential();
    clearStoredToken();
    setInternalToken(null);
    setInternalMe(null);
  };

  const signout = () => {
    const ext = activeExternal();
    if (ext) {
      // Sign out of the external account only: best-effort server-side
      // revocation on its own instance, then forget the session and fall
      // back to the internal account untouched.
      void revokeExternalToken(ext.scheme, ext.host, ext.token);
      setExternalSessions(removeExternalSession(ext.host));
      setActiveExternalHostSignal(null);
      return;
    }
    signoutInternal();
  };

  const store: AuthStore = {
    token: () => activeExternal()?.token ?? internalToken(),
    me: () => activeExternal()?.user ?? internalMe(),
    authReady,
    signin,
    refreshMe: async () => {
      const ext = activeExternal();
      if (ext) {
        const user = await fetchExternalMe(ext.scheme, ext.host, ext.token);
        setExternalSessions(updateExternalSessionUser(ext.host, user));
        return;
      }
      if (!getToken()) return;
      setInternalMe(await apiCallInternal<MeDetailed>("i"));
    },
    signout,
    externalSessions,
    activeExternalHost,
    isExternalActive: () => activeExternal() !== null,
    internalMe,
    backendLabel: BACKEND_LABEL,
    addExternalSession: (session: ExternalSession) => {
      setExternalSessions(saveExternalSession(session));
      setActiveExternalHost(session.host);
      setActiveExternalHostSignal(session.host);
    },
    switchAccount: (host: string | null) => {
      if (host && !externalSessions().some((s) => s.host === host)) return;
      setActiveExternalHost(host);
      setActiveExternalHostSignal(host);
    },
    removeExternalAccount: (host: string) => {
      setExternalSessions(removeExternalSession(host));
      if (activeExternalHost() === host) setActiveExternalHostSignal(null);
    },
  };
  return <AuthContext.Provider value={store}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
