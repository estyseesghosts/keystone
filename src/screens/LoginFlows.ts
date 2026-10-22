import {
  buildAuthorizeUrl,
  buildMiauthUrl,
  checkExternalSession,
  createMisskeyClient,
  FediError,
  fetchExternalMe,
  finishOAuthExchange,
  firstPartyMfa,
  firstPartyPasswordSignin,
  getCachedApp,
  isUnsupportedError,
  mintAppToken,
  newExternalSessionId,
  randomToken,
  registerApp,
  s256Challenge,
  savePendingAuth,
  sessionId,
  signinFlow,
  signinNative,
  takePendingAuth,
  UNKNOWN_ACCOUNT_ID,
  verifyAppToken,
  type Account,
  type ExternalScheme,
  type KeyValueStore,
  type ServerFamily,
  type ServerFlavor,
  type Session,
  type SessionGrant,
} from '@keystone/fedi'

import {AUTH_CALLBACK_PATH} from '#/routes'

// Login flows (slice 3.1): the UI-side half of sign-in. Every exchange here
// composes the pure `packages/fedi` surface over a session-bound transport
// built FROM the entered origin — a token is only ever sent to its own
// origin. Nothing here persists: verification happens BEFORE the caller
// stores anything, and the full-authority native credential from
// `signin-flow` lives in a local only for the mint exchange below.

/** Normalize a typed/pasted server into a canonical `https://host` origin, or null. */
export function normalizeServerInput(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  if (url.username || url.password) return null
  return url.origin
}

/** This app's own origin on web (the OAuth callback base), else null. */
export function getWebOrigin(): string | null {
  const loc = (globalThis as {location?: {origin?: unknown}}).location
  if (typeof loc?.origin === 'string' && loc.origin.startsWith('http')) {
    return loc.origin
  }
  return null
}

/**
 * The web OAuth/MiAuth redirect URI this app registers: `${origin}/auth/callback`
 * at EVERY base — the canonical path in `#/routes`. That is the same string
 * v2 has always registered, so no instance re-registration is needed
 * (clickstone §1.13). The route table also serves the v1 root path
 * `/keystone/callback`, so registrations made before the rebuild keep
 * landing on the callback screen.
 */
export function webCallbackUri(origin: string | null): string {
  return `${origin ?? ''}${AUTH_CALLBACK_PATH}`
}

/** Credential-less session for public wire calls against `origin`. */
export function publicSessionFor(
  origin: string,
  family: ServerFamily,
  flavor: ServerFlavor,
): Session {
  return {
    id: sessionId(origin, UNKNOWN_ACCOUNT_ID),
    origin,
    family,
    flavor,
    accountId: UNKNOWN_ACCOUNT_ID,
    token: '',
    grant: 'password',
    hosting: 'third-party',
  }
}

function publicCall(origin: string, family: ServerFamily, flavor: ServerFlavor) {
  const client = createMisskeyClient(publicSessionFor(origin, family, flavor))
  return <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> =>
    client.callPublic<T>(endpoint, params)
}

export interface PasswordSigninResult {
  token: string
  account: Account
  grant: SessionGrant
}

/**
 * Misskey-family password sign-in against `origin`: native `signin-flow`
 * (username/password, no redirects) → `miauth/gen-token` + check → scoped
 * app token, verified BEFORE returning. The native credential is a local,
 * never persisted. Servers without `signin-flow` (404/405 — the Pinetree
 * shape) fall back to the native `signin` endpoint.
 */
export async function misskeyPasswordSignin(opts: {
  origin: string
  flavor: ServerFlavor
  username: string
  password: string
}): Promise<PasswordSigninResult> {
  const call = publicCall(opts.origin, 'misskey', opts.flavor)
  const username = opts.username.trim()
  try {
    const flow = await signinFlow(call, username, opts.password)
    if (!flow.finished) {
      throw new FediError(
        `This account needs an extra sign-in step (${flow.next}) that Keystone does not support.`,
        'errors.auth.extraStep',
      )
    }
    const appToken = await mintAppToken(call, flow.i)
    const account = await verifyAppToken(call, appToken)
    return {token: appToken, account, grant: 'miauth'}
  } catch (err) {
    if (!isUnsupportedError(err)) throw err
    const {token, account} = await signinNative(call, username, opts.password)
    return {token, account, grant: 'password'}
  }
}

/**
 * Mastodon-family password grant (Akkoma/Pleroma — vanilla Mastodon has
 * none, the login screen offers OAuth there). Throws `MfaRequiredError`
 * when the account needs a second factor; continue with `mastodonMfaSignin`.
 * `flavor` selects the requested scope string (ADR 0005) — the caller
 * (Login screen) always detects first, so it is known here.
 */
export async function mastodonPasswordSignin(opts: {
  appStore: KeyValueStore
  origin: string
  redirectUri: string
  username: string
  password: string
  flavor?: ServerFlavor
}): Promise<PasswordSigninResult> {
  const {token, account} = await firstPartyPasswordSignin(
    opts.appStore,
    opts.origin,
    opts.redirectUri,
    opts.username.trim(),
    opts.password,
    opts.flavor,
  )
  return {token, account, grant: 'password'}
}

/** Second step after `MfaRequiredError`: totp or recovery code. `flavor`
 * must match the password-grant attempt (same app-cache scope binding). */
export async function mastodonMfaSignin(opts: {
  appStore: KeyValueStore
  origin: string
  redirectUri: string
  mfaToken: string
  challengeType: string
  code: string
  flavor?: ServerFlavor
}): Promise<PasswordSigninResult> {
  const {token, account} = await firstPartyMfa(opts.appStore, opts.origin, opts.redirectUri, {
    mfaToken: opts.mfaToken,
    challengeType: opts.challengeType,
    code: opts.code.trim(),
  }, opts.flavor)
  return {token, account, grant: 'password'}
}

/**
 * Mastodon-family OAuth start: register (or reuse) the app, stash the
 * state/PKCE pending ONCE, then hand the authorize URL to the caller-owned
 * browser (`expo-web-browser` on native, same-tab navigation on web). The
 * callback half lives in `completeMastodonOAuth` (AuthCallback screen).
 *
 * `flavor` selects the requested scope string (ADR 0005): Mastodon-family
 * logins register the umbrella triple so the authorize URL stays short.
 * No detect-first probe here: every caller detects before offering OAuth
 * (Login screen `detect()` / first-party hosting detection), so the
 * flavor is always known; absent means the full set (previous behavior).
 *
 * Returns whatever the caller's browser reports as the redirect outcome:
 * the callback URL when the browser session captures it (iOS
 * `openAuthSessionAsync` consumes the redirect in-session and never
 * re-opens the app, so the AuthCallback deep link never fires there),
 * null on web (same-tab navigation unloads the page) and on cancel.
 */
export async function startMastodonOAuth(opts: {
  appStore: KeyValueStore
  origin: string
  redirectUri: string
  openBrowser: (url: string) => Promise<unknown>
  flavor?: ServerFlavor
}): Promise<string | null> {
  const app = await registerApp({
    store: opts.appStore,
    origin: opts.origin,
    redirectUri: opts.redirectUri,
    flavor: opts.flavor,
  })
  const state = randomToken()
  const codeVerifier = randomToken()
  savePendingAuth(opts.appStore, {
    origin: opts.origin,
    redirectUri: opts.redirectUri,
    state,
    codeVerifier,
    scopes: app.scopes,
    createdAt: Date.now(),
  })
  const url = buildAuthorizeUrl({
    origin: opts.origin,
    clientId: app.client_id,
    redirectUri: opts.redirectUri,
    scopes: app.scopes,
    state,
    codeChallenge: await s256Challenge(codeVerifier),
  })
  const result = await opts.openBrowser(url)
  return typeof result === 'string' ? result : null
}

export interface OAuthCompleteResult {
  origin: string
  token: string
  account: Account
}

/**
 * Mastodon-family OAuth callback: read AND delete the pending flow (replay
 * guard) — null when the state is unknown, malformed, or expired — then
 * exchange + verify BEFORE anything is stored.
 */
export async function completeMastodonOAuth(opts: {
  appStore: KeyValueStore
  code: string
  state: string
}): Promise<OAuthCompleteResult | null> {
  const pending = takePendingAuth(opts.appStore, opts.state)
  if (!pending) return null
  const app = getCachedApp(
    opts.appStore,
    pending.origin,
    pending.redirectUri,
    pending.scopes,
  )
  if (!app) {
    throw new FediError(
      'The sign-in session expired before the callback ran. Please sign in again.',
      'errors.auth.noCredentials',
    )
  }
  const {token, account} = await finishOAuthExchange({
    origin: pending.origin,
    redirectUri: pending.redirectUri,
    clientId: app.client_id,
    clientSecret: app.client_secret,
    code: opts.code,
    codeVerifier: pending.codeVerifier,
  })
  return {origin: pending.origin, token, account}
}

// --- Misskey-family browser sign-in (MiAuth, no password) -------------------
//
// Third-party Misskey sign-in never asks for a password (the old product
// rule: a password typed into this app must only ever go to its own
// server): the app opens the instance's own `/miauth/:session` approval page
// and polls `POST /api/miauth/:session/check` until the user approves. The
// issued token is verified (`fetchExternalMe`) BEFORE the caller stores
// anything. Two completions share this path:
// - callback: the instance redirects back to `redirectUri?session=<session>`
//   (AuthCallback screen; the pending row names the origin).
// - manual: the user returns themselves and taps "I've approved" (pure
//   polling — no callback needed, e.g. a server that cannot redirect back).

export interface MisskeyMiAuthPending {
  scheme: ExternalScheme
  host: string
  session: string
  createdAt: number
}

const MIAUTH_PENDING_PREFIX = 'keystone_pending_miauth_'
const MIAUTH_PENDING_MAX_AGE_MS = 15 * 60 * 1000

function miauthPendingKey(session: string): string {
  return `${MIAUTH_PENDING_PREFIX}${session}`
}

export function saveMisskeyPending(
  pendingStore: KeyValueStore,
  pending: MisskeyMiAuthPending,
): void {
  pendingStore.setItem(miauthPendingKey(pending.session), JSON.stringify(pending))
}

/**
 * Read AND delete the pending MiAuth flow for `session` (replay guard) —
 * null when unknown, malformed, or expired.
 */
export function takeMisskeyPending(
  pendingStore: KeyValueStore,
  session: string,
): MisskeyMiAuthPending | null {
  const key = miauthPendingKey(session)
  let raw: string | null = null
  try {
    raw = pendingStore.getItem(key)
    pendingStore.removeItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MisskeyMiAuthPending
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.session !== session ||
      (parsed.scheme !== 'https' && parsed.scheme !== 'http') ||
      typeof parsed.host !== 'string' ||
      !parsed.host
    ) {
      return null
    }
    if (Date.now() - parsed.createdAt > MIAUTH_PENDING_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export interface MisskeyMiAuthStart extends MisskeyMiAuthPending {
  url: string
}

/**
 * Misskey-family browser sign-in start: mint a session id, persist the
 * pending row (so the callback can name the origin), hand the instance
 * approval URL to the caller-owned browser. The approval happens OUTSIDE
 * the app on the host instance — the app never sees a password.
 */
export async function startMisskeyMiAuth(opts: {
  pendingStore: KeyValueStore
  origin: string
  redirectUri: string
  openBrowser: (url: string) => Promise<unknown>
}): Promise<MisskeyMiAuthStart> {
  const scheme: ExternalScheme = opts.origin.startsWith('http://') ? 'http' : 'https'
  const host = opts.origin.replace(/^https?:\/\//, '')
  const session = newExternalSessionId()
  const pending: MisskeyMiAuthPending = {scheme, host, session, createdAt: Date.now()}
  saveMisskeyPending(opts.pendingStore, pending)
  const url = buildMiauthUrl(scheme, host, session, opts.redirectUri)
  await opts.openBrowser(url)
  return {...pending, url}
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Poll the instance for the user's MiAuth decision, then verify the issued
 * token BEFORE returning. `{ ok: false }` means "not yet" — the loop keeps
 * waiting until `attempts` runs out, then throws an honest timeout.
 */
export async function pollMisskeyApproval(opts: {
  scheme: ExternalScheme
  host: string
  session: string
  attempts?: number
  intervalMs?: number
}): Promise<{origin: string; token: string; account: Account}> {
  const attempts = opts.attempts ?? 30
  const intervalMs = opts.intervalMs ?? 2000
  const origin = `${opts.scheme}://${opts.host}`
  let token: string | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const check = await checkExternalSession(opts.scheme, opts.host, opts.session)
    if (check.ok && check.token) {
      token = check.token
      break
    }
    if (attempt + 1 < attempts) await sleep(intervalMs)
  }
  if (!token) {
    throw new FediError(
      'The approval was not completed in time. Approve on your server, then try again.',
      'errors.auth.miauthTimeout',
    )
  }
  const account = await fetchExternalMe(opts.scheme, opts.host, token)
  return {origin, token, account}
}
