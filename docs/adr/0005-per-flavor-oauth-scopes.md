# ADR 0005 — Per-flavor OAuth scope strings (Mastodon triple, Akkoma full)

Date: 2026-10-22
Status: accepted
Plan ref: `docs/adr/0003-oauth-scopes-now-vs-later.md` follow-up (a)

## Problem

Mastodon-family login 502s on servers with tight response-header
buffering because our `/oauth/authorize` URL is too long. Black-box
probing (verified by the coordinator, deterministic across retries and
browsers): a logged-in `GET /oauth/authorize` 502s past ~512 chars
(484-char URL → 200, 584-char → 502 — a sharp LENGTH threshold, not
content: a minimal scope plus 600-char state padding also 502s, and
+400B of extra header on a short URL still 200s). The anonymous
(sessionless) leg is unaffected (302 fine); only the logged-in leg —
which stores `return_to` and sets a bigger session cookie, overflowing
the response headers at their nginx — trips it.

Our scope string is ~350 chars (26 granular scopes + umbrellas), so the
authorize URL lands at ~700 chars. This is ADR 0003's explicitly
deferred follow-up (a): split the scope string per flavor.

## Options considered

1. **Shorten `state`/PKCE instead of scopes.** Rejected: `state` and the
   S256 challenge are fixed-size security values (43 chars each); even
   zeroing them would not fit the 26-scope string under ~512 chars on
   real origins, and weakening them breaks the replay guard.
2. **Granular-only everywhere.** Rejected per ADR 0003: Akkoma 403s a
   granular-only token on shipped Explore surfaces (`/api/v1/suggestions`;
   live probe 2026-10-21), and Akkoma's umbrella-scope checks are still
   unmapped — a granular-only Akkoma login would break shipped features
   with no live rig to re-probe every endpoint.
3. **Umbrella triple (`read write follow`) on the Mastodon family, full
   set on Akkoma/Pleroma.** Accepted (below).

## Decision

`packages/fedi/src/mastodon/oauth.ts` gains `SCOPES_MASTODON =
["read", "write", "follow"]` and `scopesForFlavor(flavor)`:
`"mastodon"` → the triple (vanilla plus glitch-soc/hometown/gotosocial,
which all detect as flavor `"mastodon"`); `"akkoma"`/`"pleroma"`/
anything else (including `"unknown"`) → `SCOPES_NOW`. `registerApp`
takes an optional `flavor` (explicit `scopes` still wins; no flavor
means the full set — previous behavior). Registration, the authorize
URL, and the password grant all use the same flavor string, because the
per-origin app cache binds on it.

Why the triple suffices on Mastodon (verified, not assumed): Doorkeeper
checks ANY-of — upstream `lib/doorkeeper/models/concerns/scopes.rb`
`includes_scope?` is `required_scopes.any? { |scope|
scopes.exists?(scope.to_s) }`, reached via `doorkeeper_authorize!`
(`lib/doorkeeper/rails/helpers.rb`) → `acceptable?`
(`lib/doorkeeper/models/access_token_mixin.rb`) — exact-string match,
no hierarchy. And EVERY Mastodon API controller lists the umbrella
alongside the granular scope (e.g. `doorkeeper_authorize! :read,
:'read:statuses'` across upstream `app/controllers/api/v1/*.rb`,
checked exhaustively: no controller line lacks an umbrella
alternative), so an umbrella-only token passes every shipped endpoint.
`ScopeParser`/`ScopeTransformer` (`app/lib/scope_parser.rb`,
`app/lib/scope_transformer.rb`) and `grouped_scopes`
(`app/helpers/application_helper.rb`) only group scopes for the
authorize-page display — they are not access checks. This is also why
all pre-granular clients and Moshidon's tiny scope string work fully.

Why Akkoma keeps the full string: probe-proven (ADR 0003) — its
umbrella checks are unmapped and granular-only 403s shipped behavior.
Unknown defaults to full: a wrongly-narrowed Akkoma token breaks
shipped features, while stock Mastodon accepts the full set (pinned by
the hotfix allowlist test), so full is the safe default.

Where the flavor is known: no new probe was needed. The external Login
screen `detect()`s (`detectServer`) before offering OAuth/password, and
`Login.tsx` passes `detection.flavor`; the internal path passes
`firstParty.flavor` from hosting detection. `startMastodonOAuth` /
`mastodonPasswordSignin` / `mastodonMfaSignin` take an optional
`flavor` (absent → full set). MFA must carry the same flavor as its
password-grant attempt (same app-cache scope binding).

`scopeHealth` (`src/state/session/store.ts`) diffs the per-origin cached
app against the flavor-expected set (`scopesForFlavor(session.flavor)`).
Only missing matters: a pre-split 26-scope Mastodon token reads
`current` against the triple expectation — no spurious upgrade, nothing
revoked. An Akkoma triple token correctly reads `needsUpgrade` (the
granulars are genuinely missing there).

## Consequences

- Good: Mastodon authorize URLs drop to ~330 chars (test-pinned under
  480 with fresh PKCE/state), fitting tight-buffer servers; Akkoma
  logins are byte-identical to before (password grant has no URL
  anyway); Misskey family untouched (no OAuth scopes).
- Good: existing Mastodon sessions are unaffected — full-set caches
  read `current`, no re-auth forced, no revocation anywhere.
- Bad / accepted risk: an `unknown`-flavor mastodon-family session
  holding a triple token reads `needsUpgrade` against the full-set
  expectation. Rare (login always detects first) and self-healing: the
  upgrade re-auth re-detects, stores the real flavor, and reads
  `current`.
- Follow-ups: none — this closes ADR 0003 follow-up (a). Follow-ups
  (b) (`write:reports` → NOW, done) and (c) (admin scopes with the
  admin surface) are unaffected.
