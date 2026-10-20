// Keystone-owned Misskey-family authentication — the adapted surface
// for the auth layer (plan §2.3 first-party flows, Phase 2 item 5).
//
// The exact exchange itself (`signin-flow` → `miauth/gen-token` →
// `miauth/:session/check` → scoped app token; the native credential is
// memory-only, never persisted) runs through the injected `WireCall`
// transport — there is no global routing facade in this package. This
// module only adapts the wire `i`/`signin` responses to core `Account`,
// so no wire type crosses into the UI.
//
// Pure-TS rule: failures carry stable `{code, params}` error codes
// (`FediError`); `message` is the fixed English fallback.

import { FediError } from "../core/errors";
import type { Account } from "../core/models";
import { adaptMe } from "./adapt";
import type { MeDetailed, SigninResponse } from "./wire";
import type { WireCall } from "./client";

/** `i` on the session backend (session restore/refresh). */
export async function fetchSessionMe(call: WireCall): Promise<Account> {
  return adaptMe(await call<MeDetailed>("i", {}));
}

/** `i` with an explicit token (scoped-token verification before store). */
export async function verifyAppToken(callPublic: WireCall, token: string): Promise<Account> {
  return adaptMe(await callPublic<MeDetailed>("i", { i: token }));
}

/** The Pinetree-family native `signin` (username/password -> token). */
export async function signinNative(
  call: WireCall,
  username: string,
  password: string,
): Promise<{ token: string; account: Account }> {
  const res = await call<SigninResponse>("signin", { username, password });
  return { token: res.token, account: adaptMe(res.user) };
}

export interface SigninFinished {
  finished: true;
  id: string;
  /** Full-authority native user token: used only for the gen-token
   * exchange below, held in memory, never persisted. */
  i: string;
}

export interface SigninPending {
  finished: false;
  next: string;
}

export type SigninFlowResponse = SigninFinished | SigninPending;

/** Misskey-family native `signin-flow` (username/password, no redirects). */
export async function signinFlow(
  callPublic: WireCall,
  username: string,
  password: string,
): Promise<SigninFlowResponse> {
  return callPublic<SigninFlowResponse>("signin-flow", { username, password });
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

interface MiauthCheckResponse {
  ok: boolean;
  token?: string;
  user?: unknown;
}

/** Exchange a native credential for a scoped Keystone app token. The
 * caller-supplied `i` (the native credential) rides in the params — the
 * session-bound transport preserves that precedence. */
export async function mintAppToken(
  callPublic: WireCall,
  nativeToken: string,
  opts: { appName?: string; permission?: string[] } = {},
): Promise<string> {
  const session = newSessionId();
  await callPublic<{ token: string }>("miauth/gen-token", {
    i: nativeToken,
    session,
    name: opts.appName ?? KEYSTONE_APP_NAME,
    permission: opts.permission ?? KEYSTONE_PERMISSIONS,
  });
  const check = await callPublic<MiauthCheckResponse>(`miauth/${session}/check`, {});
  if (!check.ok || !check.token) {
    throw new FediError(
      "The server did not issue a Keystone token for this session.",
      "errors.auth.noKeystoneToken",
    );
  }
  return check.token;
}

/** Keystone's app identity for the MiAuth authorize page (also used by
 * `external.ts` for the external-account flow). */
export const KEYSTONE_APP_NAME = "Keystone";

/** Least-privilege permission set requested for Keystone sessions. */
export const KEYSTONE_PERMISSIONS: string[] = [
  "read:account",
  "write:notes",
  "write:reactions",
  "write:following",
  "read:following",
  "read:notifications",
  "write:notifications",
  "read:drive",
  "write:drive",
  "write:account",
  "write:votes",
  "read:blocks",
  "write:blocks",
  "read:mutes",
  "write:mutes",
  "write:favorites",
  "read:favorites",
  "write:report-abuse",
  "read:clips",
  "write:clips",
];
