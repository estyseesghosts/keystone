# ADR 0012 — MiAuth `keystone://` callback: accepted interception risk + mitigations

Date: 2026-10-25
Status: accepted
Plan ref: `docs/audit_20261025/repair.md` §X2.3 (owner decision D7)

## Problem

Misskey-family browser sign-in (MiAuth) returns to the app through a
custom-scheme deep link (`keystone://auth/callback?session=<session>`).
On Android any installed app can register the same `keystone://` scheme
and receive the redirect. The MiAuth
`miauth/<session>/check` endpoint needs no other secret, so an
interceptor that wins the redirect race can redeem the approved token.
(Mastodon is protected by PKCE; MiAuth has no equivalent.) The real fix
is an https App Link / Universal Link callback, which needs a release
signing identity plus a hosted domain — both out of scope (signing is
skipped by owner decision; no domain exists).

Findings: security M3; networking L5 (token-in-URL logging); D7.

## Options considered

1. Switch the callback to https App Links now — rejected: needs a
   release keystore (skipped, security H1) and a domain with
   `assetlinks.json`; neither exists in this program.
2. Drop the MiAuth browser flow (password-only for third-party Misskey)
   — rejected: the product rule is that a password typed into this app
   must only ever go to its own server; third-party Misskey sign-in has
   no password path.
3. Accepted risk with every mitigation that does not need signing —
   chosen.

## Decision

The custom-scheme callback stays, and the interception risk is accepted
(D7). The following mitigations ship in §X2.3:

- Session ids come from X2.1's CSPRNG (`core/random.ts` `randomUuid`;
   no `Math.random` fallback anywhere in the auth path).
- The pending row (`keystone_pending_miauth_<session>`) binds the exact
   `scheme` + `host` the approval page opened on and expires after
   15 minutes; the callback consumes it read-and-delete (single-use —
   a replayed or guessed link finds nothing).
- Completion verifies the row against the session being signed in
   (origin match) and discards the result when the verified `account`
   names a different host than the pending row.
- Android `intentFilters` keep `autoVerify` off but claim exactly the
   `keystone` scheme + `auth` host + `/callback` path (narrowest claim
   Expo expresses; the scheme-generated broad filter coexists, so this
   is depth, not a boundary).
- One-time params never linger: the web callback strips query/fragment
   from the address bar after consumption.
- The Misskey `?i=` stream token never reaches logs: debug output uses
   `core/redact.redactUrl`, and a grep test pins that no `console` /
   logger call in either stream client receives the URL.

## Consequences

- Good: interception needs a same-device malicious app winning an exact
   moment race for a single-use, 15-minute, origin-bound secret; every
   other callback property is verified before any token is stored.
- Bad / accepted risk: a malicious app that registers `keystone://`
   can still observe or steal a callback on Android. No in-app code can
   close this while the scheme is custom.
- Follow-ups (not this slice): https App Links / Universal Links once
   release signing and a domain exist; then the scheme callback becomes
   the fallback only. Web token storage stays a release blocker (D2,
   `docs/web-hosting.md`).
