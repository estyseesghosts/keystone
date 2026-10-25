# ADR 0011 — Token storage: SecureStore vault + in-memory map, secret-free envelope (native)

Date: 2026-10-25
Status: accepted
Plan ref: `docs/audit_20261025/repair.md` §X1.1

## Problem

Session bearer tokens and Mastodon OAuth `client_secret`s live in
unencrypted MMKV at all times. The native SecureStore vault
(`src/storage/tokens.ts`) is a silent no-op: `tokenKeyFor` builds keys
containing `:`, `/` and spaces (e.g.
`keystone.vault.https://a.b https://a.b 123`), and expo-secure-store
rejects anything outside `/^[\w.-]+$/` (`SecureStore.ts:229-239`), while
every vault method swallows the error. The envelope `keystone_sessions`
carries the token copy by design (`store.ts:30-38`), so even a working
vault would add no protection. Findings: storage S1, S2, S5 (vault half),
security M1, privacy 3, sessions-cache 5.

## Options considered

1. Fix the key encoding only, keep the envelope token copy — rejected:
   the plaintext copy (plus Android auto-backup) remains, so the vault
   adds nothing.
2. Encrypt MMKV wholesale with a key held in SecureStore — rejected:
   whole-store re-key and a native-module migration for a problem X1.4
   mitigates differently (persist allowlist); larger blast radius.
3. Native: tokens and app secrets only in SecureStore, mirrored in an
   in-memory map that request building reads synchronously; the envelope
   stores no secret. Web: unchanged (`localStorage`-backed, dev-grade).
   Vault failure: the session stays usable in memory for this run, the
   failure is surfaced, and next launch asks the user to sign in again.
   No silent plaintext fallback — chosen.

## Decision

- Vault keys are `keystone.vault.` + lowercase hex of the UTF-8 bytes of
  `"${origin} ${sessionId}"`, and app secrets are `keystone.appsecret.`
  + hex of the origin. The alphabet is `[A-Za-z0-9._-]` by construction
  (the shared `utf8Hex` primitive lives in `core/sessions.ts`; the key
  builders compose it per layer). The session id already embeds the
  origin, so per-(origin, account) isolation is preserved.
- `TokenVault` is unchanged (all existing stubs keep compiling). OS
  vaults implement the additive `SecureTokenVault` (`secure: true`;
  `set/removeToken` and `set/removeAppSecret` return success booleans;
  reads return `null` on absent-or-unreadable). The session store
  capability-detects (`secure === true`) and otherwise runs the legacy
  web behavior byte-for-byte, so web is unchanged per owner decision D2
  (web stays a documented release blocker, not release-ready).
- Native write path: the envelope is persisted tokenless
  (`sessionWithoutToken`, i.e. `token: ''`); the vault write is awaited;
  on failure the store removes the vault entry (a stale entry must never
  win later), keeps the token in memory for this run only, keeps any
  pre-migration envelope copy until a read-back verifies, and emits
  `onSessionVaultFailed({sessionId, origin, kind: 'token'|'appSecret'})`.
  The store is Lingui-free, so the event carries codes only; UI text is
  a later slice's `msg`.
- Boot migration (in `hydrate()`, still awaited in `Root` before the
  first request): every envelope session with a token is written to the
  vault, verified with a read-back, then the envelope row is rewritten
  tokenless; app-secret rows in `keystone_apps` migrate the same way
  (`readStoredAppSecrets` / `scrubStoredAppSecrets` — `client_id` and
  metadata stay in MMKV, which revocation needs). Idempotent and safe to
  re-run; a failed write never drops the session. Mastodon revocation
  takes the secret from the vault (`RevokeOptions.appSecret`), falling
  back to legacy rows.
- `packages/fedi` accepts tokenless persisted sessions
  (`normalizeSession` allows a missing/empty token; `''` means
  "not hydrated"). The app-layer store overlays the in-memory map on
  every session it hands out, so `backendForSession` and revocation keep
  working unchanged. A residual window stays honest and documented: an
  app secret registered after boot persists in MMKV until the next boot
  scrub (the fedi registration path is sync and vault-free; `LoginFlows`
  is untouched by this slice).

## Consequences

- Good: no bearer token or client secret bytes rest in MMKV on native;
  stale-vault-wins and silent-swallow races are closed; web behavior is
  pinned by tests instead of assumed.
- Bad / accepted risk: web tokens remain in `localStorage` (D2 release
  blocker); the registration-to-boot app-secret window above; a
  tokenless envelope means a pre-hydration request goes out
  unauthenticated and fails via the server 401 rather than fail-closed
  in-process (`Root` still gates navigation on `hydrate()` as today).
- Follow-ups (separate slices, not this ADR): UI toast on
  `onSessionVaultFailed` (needs `msg`, outside X1.1 scope); X1.2 owns the
  hydrate/remove race serialization and full purge; X1.4 owns the
  persisted-cache allowlist; X1.6 owns backup flags.
