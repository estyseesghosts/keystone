# 2026-10-21 — WS-E Misskey correctness — subagent

Branch: `pE-misskey` (from `main@eb37e02`)
Goal: WS-E (V2_GAPS §WS-E): drafts dupe, like key, Pinetree polls, reactionActions, menu copy.

## Did

- **MK6 drafts dupe — DELETED (not frozen).** `packages/fedi/src/misskey/drafts.ts` deleted; barrel line removed (`index.ts:24`); `misskey-w8-modules.test.ts` drafts import + 4-test describe removed. Verified safe: zero `src/` importers ever (git history: `carryLegacyDrafts`/`misskey/drafts` never touched `src/`), authority `src/storage/drafts.ts` uses a different key format (`keystone.drafts.<sessionId>` vs `keystone_drafts_<sessionId>`) so there is no legacy key to carry — `carryLegacyDrafts` was dead, now gone, per spec ("RUN or DELETED, never dead"). No `src/` edit needed.
- **MK16 reactionActions — DELETED.** `misskey/reactionActions.ts` + `misskey/myReactions.ts` (only importer was reactionActions; Phase-4 post-shadow in `src/state/cache` owns the logic) + `misskey-reaction-actions.test.ts` (4 tests) deleted; barrel lines removed. No production importer (`src/` only uses `myReactions` as a data-field name). Wiring the provider was rejected: no caller exists, a third state is banned.
- **MK13 like key — DONE (fedi-side, no `src/` touch).** `"like"` added to `FeatureKey` + `FEATURE_KEYS` (`core/detect.ts`); flavor facts: misskey `unsupported`, sharkey `supported`, mastodon/akkoma/pleroma `unsupported`, catodon/pinetree/unknown absent (= unknown, unverified). `misskey/like.ts` gains `seedLikeSupport(origin, false)` + a short-circuit in `likeViaNotesLike` (known-absent refuses without touching the wire). `createMisskeyBackend` seeds the per-origin cache from the flavor table, so stock Misskey reports `isSupported() === false` and the app toggle queue (`postActions.ts`, already checks `isSupported()`) falls straight back to ❤ — the doomed 404 never fires, not even once per launch. New tests: detect facts (1), seed/short-circuit (2), backend seeding incl. zero-wire-call assertion (2).
- **MK14 Pinetree polls — NO FACT CHANGE (probed, blocked as predicted).** Pinetree `:3000` IS up (`/api/meta` 200, version `2026.10.1-alpha.0`, `translatorAvailable: false`; nodeinfo self-reports `misskey`). Unauthenticated `notes/create` returns identical 401 `CREDENTIAL_REQUIRED` for no-poll, single-poll, and multi-poll bodies — auth gate runs before poll validation, so the probe carries zero poll signal. No seed creds, no signin-flow (matches W3). `polls_multi: "unsupported"` for pinetree stands; composer submit already clamps `multiple` to false when the gate is off (`api/composer.ts:321`) and the poll toggle is capability-gated (`CompactComposer.tsx:271-275` reads `c.gates.poll`). v1 parity kept: offer, let server reject. Proposed DECISIONS line in report.
- **MK17 menu copy — ALREADY RESOLVED, no diff.** `menuModel.ts:170` already uses `cachedRemotePostUrl(uri) ?? uri` (resolver cache with raw-URI fallback) and `PostCard.tsx:499` warms the cache on mount. The sync menu model cannot await the async resolver; the cache+warm pattern is the resolver-with-fallback. Tests (`menuModel.test.ts` cold-fallback + warmed-preference + spoof-rejection) pass unchanged.

## Decided (→ proposed DECISIONS lines, coordinator owns the file)

- WS-E MK14 (propose): `2026-10-21 Pinetree :3000 live-probed (meta 200, v2026.10.1-alpha.0): unauth notes/create 401s before poll validation for all poll shapes — polls_multi stays "unsupported", no fact change; never probed Sharkey/Akkoma as vanilla evidence.`
- WS-E MK6 (propose): `fedi misskey/drafts.ts deleted (zero src importers ever; app store key format differs so no legacy carry); Q6 register row needs coordinator tick.`
- WS-E MK16 (propose): `fedi reactionActions.ts + myReactions.ts deleted with their suite (Phase-4 post-shadow owns the path; no producer ever set the provider).`
- WS-E MK13 (propose): `"like" joins FEATURE_KEYS (misskey/mastodon-family unsupported, sharkey supported, forks unknown); backend seeds the per-origin cache from the table + short-circuits known-absent — stock Misskey never fires notes/like. gates.ts untouched (fedi-side gate satisfies the acceptance behaviorally).`

## Tests / verification (exact commands + results)

- `node_modules/.bin/tsc -p tsconfig.check.ios.json` → exit 0
- `node_modules/.bin/tsc -p tsconfig.check.android.json` → exit 0
- `node_modules/.bin/tsc -p tsconfig.check.web.json` → exit 0
- `node_modules/.bin/eslint packages/fedi/src packages/fedi/test src/components/Post/menuModel.ts src/components/Post/menuModel.test.ts` → exit 0
- `node_modules/.bin/oxlint --quiet src packages/fedi` → exit 0
- `NODE_ENV=test node_modules/.bin/jest --forceExit --testTimeout=20000` → **126 suites / 1518 tests pass** (baseline 127/1521: −4 reaction-actions suite, −4 drafts block, +5 new MK13 tests = 1518 ✓)
- Focused: `jest packages/fedi/test/detect.test.ts packages/fedi/test/misskey-like.test.ts packages/fedi/test/misskey-w8-modules.test.ts src/components/Post/menuModel.test.ts` → 4 suites / 99 tests pass
- Rig: Akkoma `:4000` up (sanity 200); Pinetree `:3000` up but authed probes blocked (401 pre-validation — documented above); Misskey `:3101` / Sharkey `:3102` ECONNREFUSED → Misskey-family live rows `not verified`, never faked. No device/web runs → `not verified`.

## Deviations (files touched outside the slice + why)

- None outside file ownership: `packages/fedi` (detect, like, misskey backend, index barrel) + owned tests only. `menuModel.ts`/`PostCard.tsx`/`CompactComposer.tsx`/`gates.ts` intentionally untouched (MK17/MK14 already satisfied; MK13 gate achieved fedi-side so the forbidden `gates.ts` edit was unnecessary).

## Next

- Coordinator: tick V2_GAPS WS-E boxes, add DECISIONS lines above, resolve Q6 register update (`docs/parity-gaps.md:189` MK6 row → done via deletion).
- Still blocked (unchanged): Misskey-family live probes (`:3101`/`:3102` down), Pinetree authed probe (no creds), iOS/device runs.

STATUS: complete.
