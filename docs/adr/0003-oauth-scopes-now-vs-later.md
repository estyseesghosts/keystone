# ADR 0003 — OAuth scopes: SCOPES_NOW vs SCOPES_LATER

Date: 2026-10-22
Status: accepted
Plan ref: n/a (`docs/clickstone.md` §0.5; full-audit risk 9)

## Problem

The Mastodon-family OAuth request (`POST /api/v1/apps`, `/oauth/authorize`,
the Akkoma password grant) asks for one flat list, `MASTO_SCOPES`: the
umbrella scopes `read write follow` plus every granular scope the client
had ever needed. That list is not a feature list — it is a historical
accumulation — so every new login consents to authority the client cannot
use yet, and `scopeHealth` diffs stored sessions against the same
over-broad set. Two failures follow:

1. Least privilege is violated at the consent screen: scopes for
   unshipped features (DMs, push, admin, reports) end up in the request,
   and the umbrella `write` grants `write:conversations`/`write:reports`
   on Mastodon whether or not they are listed.
2. `scopeHealth` cannot answer the only question that matters — "can this
   token do what THIS build does?" — because a granular-only or
   pre-umbrella token reads `needsUpgrade` even when every shipped feature
   already works.

We need one rule for what is requested, and one rule for when a session is
considered stale, that later feature slices can extend without inventing a
second mechanism.

## Options considered

1. **Umbrellas only (`read write follow`).** Simplest, universally
   accepted, and exactly what Akkoma needs. Rejected: it grants the widest
   possible authority (including DMs and reports), makes granular consent
   impossible, and leaves no signal for future per-feature upgrades.
2. **Granular only (shipped surfaces).** Best consent text on Mastodon and
   the smallest grant there. Rejected: Akkoma rejects it for shipped
   behavior — `/api/v1/suggestions` 403s a granular-only token while the
   umbrella form succeeds (live probe 2026-10-21, `docs/DECISIONS.md` W5),
   and Explore's suggestions/trends/news tabs are shipped. Dropping the
   umbrellas would break shipped Akkoma screens, and the rig is not
   available in this slice to re-probe every Akkoma endpoint.
3. **Hybrid: `SCOPES_NOW` (shipped) + `SCOPES_LATER` (unshipped), umbrellas
   kept inside NOW.** Accepted (below).

## Decision

Split the scope list in `packages/fedi/src/mastodon/oauth.ts`:

- **`SCOPES_NOW`** — required by features this client ships today. Every
  authorization request defaults to exactly `SCOPES_NOW.join(" ")`:
  `registerApp`, `getCachedApp`'s scope binding, `buildAuthorizeUrl`
  callers (via the cached app), and `passwordGrant`. It keeps
  `read write follow` because Akkoma checks the umbrella itself for the
  shipped Explore surfaces (live probe above) and because follow/block/
  mute are shipped relationship writes; it keeps the granular scopes for
  the shipped screens only (timelines/threads, posting, favourites,
  notifications + markers, search, relationships, blocks, mutes,
  bookmarks, filters, lists, media, profile editor).
- **`SCOPES_LATER`** — scopes for features that do not ship yet:
  `write:reports` (report composer, docs/clickstone.md §1.5),
  `read:conversations`/`write:conversations` (DMs), `push`,
  `admin:read`/`admin:write`, `read:featured_tags`/`write:featured_tags`,
  and `read:favourites` (a Mastodon favourites timeline; favouriting
  itself is `write:favourites` and shipped). **Nothing requests these.**
- **`scopeHealth`** (`src/state/session/store.ts`) diffs the per-origin
  cached app against `SCOPES_NOW` only. A token that has every NOW scope
  reads `current` even when LATER scopes are absent; a token missing one
  or more NOW scopes reads `needsUpgrade` with exactly those scopes in
  `missingScopes`. The existing generation logic stays: `pre-scopes`
  (umbrella-only cache), `granular` (granular cache missing at least one
  NOW entry), `current`.
- `MASTO_SCOPES` remains as a deprecated alias of `SCOPES_NOW` so
  out-of-tree callers keep compiling; in-tree code uses `SCOPES_NOW`.

No session is revoked, cleared, or re-authorized by this slice. Old tokens
keep working with exactly the authority they already carry; only **new**
authorization requests change.

## Consequences

- Good: the requested scope string is now a reviewed, feature-backed list;
  DMs, push, admin, reports and featured tags are never requested (and
  `scopeHealth` never demands them), so the upgrade prompt means
  "this token predates a scope Keystone actually uses" — no longer
  "this token predates the audit list".
- Good: a later slice ships a feature by moving its scope from
  `SCOPES_LATER` to `SCOPES_NOW`; existing sessions then surface
  `needsUpgrade` and re-authorize through the already-wired prompt. There
  is exactly one place to change and one prompt to reuse.
- Good: current sessions are unaffected. The pre-split set and
  `SCOPES_NOW` are the same tokens today, so cached apps still match and
  no login round-trip is forced.
- Bad / accepted risk (Akkoma): keeping the umbrellas keeps the broad
  grant. Akkoma's umbrella-scope checks are not fully mapped, so a
  granular-only request cannot be shipped without a live re-probe; a
  strict Akkoma-side least-privilege reduction is deferred.
- Bad / accepted risk (Mastodon): Mastodon expands `read`/`write` to every
  `read:*`/`write:*`, so a Mastodon token still implicitly carries
  `read:conversations`, `write:conversations` and `write:reports` through
  the umbrellas. This slice fixes the *requested list* and the upgrade
  signal; it does not shrink the Mastodon grant.
- Follow-ups: (a) probe Akkoma per endpoint (suggestions first) and, if
  only a few endpoints need umbrellas, split the scope string per flavor
  (granular-only on Mastodon, umbrella + granular on Akkoma) with the
  flavor known at login; (b) `write:reports` moves into NOW in the report
  slice (docs/clickstone.md §1.5), which will mark existing granular
  sessions `needsUpgrade` — that is the intended behavior; (c) admin scopes
  are added only when the admin surface ships, gated on an admin
  capability, never preemptively.
