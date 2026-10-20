// Keystone-owned Mastodon-family authentication — the ADAPTED surface for
// `state/auth.tsx` + `routes/Login` (plan §3 Phase 3 items 2 + 4).
//
// The OAuth machinery itself (app registration, PKCE, state, code
// exchange, verify_credentials, revocation) lives in `./oauth.ts` and is
// unchanged from the Keystodon port. This module only adapts the wire
// `CredentialAccount` to core `Account`, so no wire type crosses into the
// UI — exactly the `misskey/auth.ts` boundary on the other family.
//
// Sign-in scope (contract §2.1): the external flow happens on the
// instance's own `/oauth/authorize` page (Keystone never sees the
// password); the same-tab callback lands on `/login?code&state`, state is
// validated ONCE, and the token is verified BEFORE it is stored.

import { adaptCredentialAccount } from "./adapt";
import type { Account } from "../core/models";
import type { KeyValueStore } from "../core/sessions";
import {
  exchangeCode,
  mfaChallenge,
  normalizeInjectedToken,
  passwordGrant,
  registerApp,
  verifyCredentials,
} from "./oauth";

export { MfaRequiredError, isUnsupportedGrantType } from "./oauth";

/** `GET /api/v1/accounts/verify_credentials` with a Bearer token → core
 * Account (the session restore/refresh path). */
export async function verifySessionAccount(
  origin: string,
  token: string,
): Promise<Account> {
  return adaptCredentialAccount(await verifyCredentials(origin, token, 10_000));
}

/** The callback half of the external OAuth flow: form-encoded code
 * exchange (PKCE verifier + client_secret — Mastodon apps are
 * confidential), then verification BEFORE anything is stored. Returns the
 * bare token string plus the adapted account; the wire TokenResponse
 * never leaves this module. */
export async function finishOAuthExchange(opts: {
  origin: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier?: string;
}): Promise<{ token: string; account: Account }> {
  const token = await exchangeCode({
    origin: opts.origin,
    redirectUri: opts.redirectUri,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    code: opts.code,
    codeVerifier: opts.codeVerifier,
  });
  const account = await verifySessionAccount(opts.origin, token.access_token);
  return { token: token.access_token, account };
}

// --- First-party (same-origin) sign-in --------------------------------------
//
// The home server IS this origin (reverse-proxied), so `origin` below is
// `location.origin`. Akkoma/Pleroma take the password grant (ROPC) — the
// password goes to the home server only and is never stored; MFA answers
// 403 `mfa_required` and continues through `firstPartyMfa`. Vanilla
// Mastodon has no password grant: it uses same-origin PKCE (plan §2.3,
// started from Login) or the optional token-injection shim.

/** Password grant against the home server (verified BEFORE returning).
 * `redirectUri` is the exact registered callback URL (passed in — no
 * router import here); `store` is the app-credential cache. */
export async function firstPartyPasswordSignin(
  store: KeyValueStore,
  origin: string,
  redirectUri: string,
  username: string,
  password: string,
): Promise<{ token: string; account: Account }> {
  const app = await registerApp({ store, origin, redirectUri });
  const token = await passwordGrant({
    origin,
    clientId: app.client_id,
    clientSecret: app.client_secret,
    username,
    password,
    scopes: app.scopes,
  });
  const account = await verifySessionAccount(origin, token.access_token);
  return { token: token.access_token, account };
}

/** Second step after `MfaRequiredError`: totp or recovery code. */
export async function firstPartyMfa(
  store: KeyValueStore,
  origin: string,
  redirectUri: string,
  opts: { mfaToken: string; challengeType: string; code: string },
): Promise<{ token: string; account: Account }> {
  const app = await registerApp({ store, origin, redirectUri });
  const token = await mfaChallenge({
    origin,
    clientId: app.client_id,
    clientSecret: app.client_secret,
    ...opts,
  });
  const account = await verifySessionAccount(origin, token.access_token);
  return { token: token.access_token, account };
}

/** Optional no-redirect path for vanilla Mastodon: a server shim injects a
 * user-scoped token. The token arrives as a parameter (the app layer owns
 * the channel); null/empty answers null (→ honest "not available").
 * Verified before use. */
export async function injectedSignin(
  origin: string,
  injectedToken?: string | null,
): Promise<{ token: string; account: Account } | null> {
  const token = normalizeInjectedToken(injectedToken);
  if (!token) return null;
  return { token, account: await verifySessionAccount(origin, token) };
}
