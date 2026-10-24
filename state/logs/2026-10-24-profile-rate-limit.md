# 2026-10-24 — Honest 429s on profile load (mstdn.ca rate limits) — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner report — opening profiles on a Mastodon session shows
"profile not available" while Misskey works; repro winds through the
federated feed + browser back. Owner-supplied devtools then showed
the truth: `accounts/verify_credentials` AND `accounts/:id` both
`429`. Global bucket exhaustion, not a resolution bug (local users
fail too — lookup is the most reliable call there is).

## Decided

- The misleading copy was the defect to fix: a 429 rendered "Could
  not load this profile. It may be deleted, suspended, or
  unreachable." — wrong on every word during throttling. Static
  analysis exonerated the rest: lookup fallbacks, scopes
  (`read:search` present), id/acct navigation, relationship
  error-swallowing all read correctly.
- Out of scope, noted below: request-volume work (what heats the
  bucket) and web back-button/tab-stack behavior.

## Did

- `src/screens/User.tsx`: a 429 (`ApiError.status === 429`) renders
  "Rate limited by the server. The server is throttling requests
  right now. Wait a moment, then try again." with the existing Retry
  (which re-fetches). Every other failure keeps the generic copy.
- `src/screens/User.test.tsx`: 429 → rate-limit copy (never the
  deleted/suspended line) + Retry recovers on the next fetch;
  404 keeps the generic copy.

## Adjacent defects observed, NOT fixed (follow-ups)

- Profiles open in the User TAB (`navigate('Main', {screen:
  'User'})`), not a pushed screen — browser-back leaving the tab
  lands wherever the tab stack dictates (owner saw Home). Whether
  back *should* return to the federated feed is a navigation-design
  question, not this fix.
- Stale-params suspicion (unverified): `navigate` merges params, so
  the Profile tab may keep showing the last-viewed stranger's id
  after viewing them. Needs a repro before touching.
- Volume leads for the hot bucket (unverified): hover prefetch fan
  (`useFullAccount` + `useRelationship` per hovered author), feed
  refetch cadence on tab return. Needs measurement, not guesses.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2604 tests green**.
- Live 429 rendering: `not verified` (needs a throttled server).

## Next

- Owner: re-check profile opens past the limit window; push `main`.
