# Auth and sessions

## Model

A `Session` (`core/sessions.ts:40`) is `{id, origin, family, flavor,
accountId, token, grant, hosting}`. `sessionId(origin, accountId)`
(`core/sessions.ts:95`) keys everything: query keys include it first, so
switching accounts never shows the previous account's data. Tokens are per
origin — a request built from session A never carries session B's token or
origin, and a token is never sent to the wrong host.

`grant` records how the session was minted (`password`, `oauth-pkce`,
`miauth`, …); `hosting` is `first-party` (this origin serves the app) vs
`third-party` (remote login).

## Misskey family: signin-flow + MiAuth (no redirects)

One step, owned by the app (`misskey/auth.ts:56`):

1. `POST /api/signin-flow` `{username, password}` → finished
   `{id, i}` or an explicit pending state (2FA/passkey/captcha is
   unsupported — the app never sends users to instance pages).
2. `POST miauth/gen-token` with the native credential `{i, session, name:
"Keystone", permission: KEYSTONE_PERMISSIONS}` (`misskey/auth.ts:78`).
3. `POST /api/miauth/{session}/check` → `{ok, token, user}`
   (`misskey/auth.ts:90`).
4. Verify the scoped token via `i` before storing
   (`misskey/auth.ts:27`).

The `i` from `signin-flow` is the user's full-authority native token: held
in module memory only for the exchange, never persisted. Stored is the
scoped app token alone. Some Misskey clones instead use native `POST signin`
`{username, password}` → `{token, user}` (`misskey/auth.ts:32`).

Requested permissions (`KEYSTONE_PERMISSIONS`, `misskey/auth.ts:105`):
`read:account`, `write:notes`, `write:reactions`, `write:following`,
`read:following`, `read:notifications`, `write:notifications`,
`read:drive`, `write:drive`, `write:account`, `write:votes`, `read:blocks`,
`write:blocks`, `read:mutes`, `write:mutes`, `write:favorites`,
`read:favorites`, `write:report-abuse`, `read:clips`, `write:clips`,
`read:channels`, `write:channels`, `read:chat`, `write:chat`,
`read:admin:server-info`, `read:admin:meta`, `read:admin:queue`,
`read:admin:abuse-user-reports`, `write:admin:resolve-abuse-user-report`.
Sessions minted before a scope existed get 403 `PERMISSION_DENIED` on its
endpoints — the app answers with a re-sign-in hint, never a bare error.

External (third-party) Misskey login uses the same MiAuth shape via
`buildMiauthUrl` / `checkExternalSession` (`misskey/external.ts:145`);
external tokens must never reach a local `/streaming` socket.

## Mastodon family: OAuth

External flow (`mastodon/oauth.ts`, `mastodon/auth.ts:1`):

1. `POST /api/v1/apps` (unauthenticated): `client_name`, `redirect_uris`
   (the exact callback URL), `scopes`. The registration is cached per
   normalized origin (`mastodon/oauth.ts:461`).
2. Redirect to `GET /oauth/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `scope`, `state`, and PKCE
   (`code_challenge`, S256). Akkoma ignores PKCE harmlessly.
3. Callback: validate `state` once, then form-encoded
   `POST /oauth/token` (`grant_type=authorization_code`, `code`,
   `client_id`, `client_secret`, `redirect_uri`, `code_verifier`).
   Mastodon apps are confidential — always send `client_secret`.
4. Verify with `GET /api/v1/accounts/verify_credentials` before storing
   (`mastodon/auth.ts:32`).
5. Logout: form-encoded `POST /oauth/revoke` with the token (+
   client id/secret, RFC 7009).

Scope strings (`mastodon/oauth.ts:118`): `SCOPES_NOW` is the full granular
set plus umbrellas (26 entries: `read`, `write`, `follow`,
`read:accounts`, `read:blocks`, `read:bookmarks`, `read:filters`,
`read:lists`, `read:mutes`, `read:statuses`, `read:notifications`,
`read:search`, `read:follows`, `write:accounts`, `write:blocks`,
`write:bookmarks`, `write:filters`, `write:follows`, `write:lists`,
`write:media`, `write:mutes`, `write:notifications`, `write:reports`,
`write:statuses`, `write:favourites`, `write:conversations`, `admin:read`,
`admin:write`). `SCOPES_LATER` names unshipped scopes that are never
requested. Per-flavor rule (`scopesForFlavor`, `mastodon/oauth.ts:219`):
Mastodon flavor requests only `read write follow` + `admin:read` +
`admin:write` (Doorkeeper checks ANY-of, and long authorize URLs 502 on
some servers); Akkoma/Pleroma get the full set (their umbrella checks are
unmapped — granular-only 403s shipped surfaces). Note `read:conversations`
is not a real scope and is never requested.

First-party variants (`mastodon/auth.ts:78`): Akkoma/Pleroma password grant
(`grant_type=password` + `username`/`password`); MFA answers 403 with an
`mfa_token`, continued via `POST /oauth/mfa/challenge`. Vanilla Mastodon
has no password grant — same-tab PKCE or the optional token-injection shim
(`injectedSignin`). Passwords are never stored.

## Storage and revocation

- Sessions persist in the `keystone_sessions` key; OAuth apps in
  `keystone_apps` (per-origin registration + scopes, `core/sessions.ts:85`).
  Native tokens live in the OS `TokenVault` (SecureStore) / MMKV web split;
  the vault copy wins over any envelope copy.
- `revokeSessionToken` (`core/sessions.ts:801`): Mastodon family →
  `POST {origin}/oauth/revoke` with the cached app credentials (vault
  secret preferred, MMKV row fallback, client-id-only as last resort);
  Misskey family → `POST {origin}/api/i/revoke-token` `{i, token,
tokenId?}`. Best-effort at sign-out — local state always clears
  regardless; offline/already-revoked reads as success, non-2xx reads as
  `false` and surfaces so sign-out can say so.
- Scope health: `scopeHealth` diffs the cached app scopes against current
  `SCOPES_NOW`/flavor set; stale sessions get the upgrade (re-auth) prompt
  rather than silent failure. Follow-up pointer: revocation-credential
  handling (X4.4-s7) is a tracked owner decision in `state/STATE.md` —
  see the session log for status.

## Coverage

| Flow                                                 | Status                  | Evidence                                               |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------------ |
| Misskey signin-flow + MiAuth scoped token            | Supported               | `misskey/auth.ts:57`, `mintAppToken`                   |
| Misskey-clone native `signin`                        | Supported               | `misskey/auth.ts:32`                                   |
| Mastodon external OAuth (PKCE + confidential client) | Supported               | `mastodon/oauth.ts`, `auth.ts:44`                      |
| Password grant + MFA (Akkoma/Pleroma)                | Supported               | `mastodon/auth.ts:78`, `firstPartyMfa`                 |
| Injected signin (vanilla Mastodon shim)              | Supported               | `mastodon/auth.ts:124`                                 |
| Per-origin storage, vault-wins, revocation           | Supported               | `core/sessions.ts:801`                                 |
| Silent scope upgrade without re-auth                 | Unsupported (by design) | OAuth needs the user in a browser; old sessions prompt |

Gaps: no refresh-token flow is persisted (honest no-op `refreshActive`);
Mastodon internal-mode token injection needs a deployment patch design.

## Sources

- `packages/fedi/src/misskey/auth.ts:22` (`i`), `:32` (clone-native `signin`), `:57` (`signinFlow`), `:78` (`mintAppToken`), `:102` (`KEYSTONE_PERMISSIONS`)
- `packages/fedi/src/misskey/external.ts:145` (`buildMiauthUrl`), `:260` (external session check)
- `packages/fedi/src/mastodon/oauth.ts:118` (`SCOPES_NOW`), `:161` (`SCOPES_LATER`), `:219` (`scopesForFlavor`), `:461` (`registerApp`)
- `packages/fedi/src/mastodon/auth.ts:32` (verify), `:44` (OAuth exchange), `:78` (password grant), `:102` (MFA), `:124` (injected)
- `packages/fedi/src/core/sessions.ts:85` (keys), `:95` (`sessionId`), `:801` (`revokeSessionToken`)
