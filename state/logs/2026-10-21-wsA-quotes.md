# 2026-10-21 — WS-A Quotes, full-mile — subagent

Branch: `pA-quotes` (from `main@eb37e02`)
Goal: WS-A from `docs/V2_GAPS.md` — show all quotes by default; wire
Misskey `resolveQuoteUri` + Mastodon textual fallbacks, strip-only-when-rendered,
Settings opt-in toggle, tests.

Did:

- `src/storage/schema.ts`: device pref `onlyAuthorizedQuotes`
  (`z.boolean().default(false)` — old payloads parse, default OFF).
  Migration carries v1→`false`. `defaultAccountState` untouched (WS-B owns the `contentMode:'mfm'` fix).
- `src/state/appearance.ts`: `get/setOnlyAuthorizedQuotes` +
  `useOnlyAuthorizedQuotes` (device-local, same pattern as contentMode).
- `src/components/Post/body.ts` (quote-strip region only):
  `postBodyNodes(post, {coveredQuoteUris?})` — strips MFM/HTML markers
  only when covered. Omitted option = legacy default (packed structured
  targets); `[]` keeps everything. No WS-B region touched.
- `src/components/Post/PostQuote.tsx`: tap-to-reveal concealed row
  (`concealed`/`onReveal`, status label preserved above the hint);
  nested quotes render with empty coverage (one-level rule, v1 parity).
- `src/components/Post/PostCard.tsx` (quote sections only):
  `resolveQuoteUri?` + `onlyAuthorizedQuotes?` props (LivePostCard
  injects the session backend's resolver, memoized). Pending-URI logic
  mirrors v1 (`NoteBody` pendingUri/showUnavailable): structured
  URI-only without packed note/id, MFM textual fallback, server-HTML
  marker (bare quote URLs included). States: packed/resolved card,
  `Resolving quote…` indicator (marker kept), structured-failure
  unavailable fallback (marker stripped, per spec), textual-failure
  keeps text (v1 parity), renote-id-without-packed renders unavailable
  without fetching. `registerSeenNote` wired for the Misskey `ap/show`
  reuse set. Covered URIs re-derive on reveal (concealed keeps markers).
- `src/components/Settings/DisplaySection.tsx`: `QuotePolicyRow`
  (switch, default Off, persisted per device) between Content mode and
  the placeholder rows.
- Tests: new `src/components/Post/quotes.test.tsx` (17: structured
  renote, URI fallback success/fail+indicator, renote-id-no-packed,
  textual success/fail, HTML bare-URL success, packed-HTML strip,
  unauthorized shown-by-default, opt-in conceal+reveal, authorized
  untouched, PostQuote reveal row, nested-marker-kept, strip/keep
  matrix), new `src/state/quotePolicy.test.ts` (5: store + schema).
  Required fallout: full-prefs literals updated in
  `schema.test.ts` (3), `index.test.ts` (2), `appearance.test.ts` (1).

Decided (→ proposed DECISIONS lines in report, not written — coordinator owns the file):

- No new `Capabilities` flag: resolution reuses existing
  `Backend.resolveQuoteUri` (both families); the toggle is a
  device-local display filter, not a server action.
- `resolveTextualQuote` (mastodon endpoints) not rebuilt — wired via
  the backend method that already wraps it with the TTL cache.

Tests / verification (exact commands + results):

- `node_modules/.bin/tsc -p tsconfig.check.{ios,android,web}.json` → all three exit 0.
- `node_modules/.bin/eslint` on all touched files → clean; `oxlint --quiet src` → exit 0 (only pre-existing warnings elsewhere).
- `NODE_ENV=test npx jest --forceExit --testTimeout=20000` → **129 suites / 1543 tests pass** (baseline 127/1521; +2 suites/+22 tests, all mine).
- Web-visual (worktree expo on :8091, Helium CDP :9222, Akkoma :4000
  akk1 signed in via UI password grant): `state/logs/assets-wsA/`
  `display-toggle-below.png` (row, Off default),
  `display-toggle-on.png` (toggled On, persists across reload —
  verified by re-goto), `home-akk1.png` (signed-in feed),
  `quote-live.png` (`Resolving quote…` with marker kept),
  `quote-live2.png` (resolved card rendered, marker stripped —
  strict URI match against the probe target, probe post deleted after,
  rig timeline confirms 404 + only pre-existing posts remain).
- Misskey-family quote live = `not verified` (:3101/:3102 refused).
- Live unauthorized-conceal = `not verified` (no pending-quote
  fixture on the rig; unit-proven).

Deviations (files touched outside the slice + why):

- `src/storage/index.test.ts`, `src/state/appearance.test.ts`,
  `src/storage/schema.test.ts`: full-prefs literals updated — required
  compilation/correctness fallout of the new schema field (minor).
- Consulted v1 read-only (behavior only, no copying):
  `frontend/src/components/NoteBody.tsx` (≈262–560),
  `frontend/src/misskey/quote.ts`, mastodon quoteMarker concept via
  the ported `packages/fedi` modules (no fedi changes were needed).
  No Bluesky source needed.

Next:

1. Coordinator: tick WS-A boxes in `docs/V2_GAPS.md`, record
   DECISIONS lines, merge `pA-quotes`.
2. WS-B note: `postBodyNodes` gained an optional 2nd param
   (backward-compatible; default = today's behavior) — tag-block work
   should route coverage through it, not around it.
3. Live gaps for a later rig session: Misskey-family quote card,
   unauthorized-conceal against a real pending quote.
