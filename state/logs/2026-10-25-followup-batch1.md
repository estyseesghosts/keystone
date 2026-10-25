# 2026-10-25 — followup-batch1 — coordinator

Branch: `main`
Goal: Land repair follow-up Batch 1 (fedi correctness: externalMe-204, B11 ADR, translator lang-key, explore.users partial failure).

Did:

- (a) `packages/fedi/src/misskey/external.ts` — `fetchExternalMe` guards empty/non-object `/api/i` body with `FediError("errors.shape.account")` before `adaptMe` (was untyped `TypeError` off `undefined`). Code reuses the existing `errors.shape.account` shape code (same as Mastodon `getAccount`). Test in `misskey-w8-modules.test.ts`: empty-204 pins `FediError` + code + not-`TypeError`; plus a non-object-200 sibling case.
- (b) `docs/adr/0009-misskey-server-info-nulls.md` (new) + `docs/adr/README.md` index row. `docs/DECISIONS.md` B11 line already present, left untouched.
- (c) `packages/fedi/src/misskey/translate.ts` — all five per-instance maps (`completed`, `inflight`, `failedAt`, `outcomes`, `retries`) keyed by `(noteId, targetLang)` via `keyOf` (`\u0000` join). Outcome/retry bus + `onTranslationMetaChange` gain optional trailing `targetLang?` (omitted → `"en"` default, existing 1-arg callers unaffected). 3 new tests in `misskey-session-caches.test.ts` (per-lang refetch, per-lang failure suppression + default retry, per-lang bus + backward compat).
- (d) `packages/fedi/src/misskey/backend.ts` `explore.users` only — `Promise.all` → `Promise.allSettled`; one side failing still resolves from the other; both failing rethrows the first error (no fake empty page). 3 new tests in `misskey-backend.test.ts`.
- Subagent note (d): new tests mock failure with `return Promise.reject(...)`, not `throw`, because the file's `stubTransport.call` invokes `respond` synchronously inside `Promise.resolve(...)` — real transports return rejected promises, so production matches the tests.

Decided (→ ADR or DECISIONS entry if load-bearing):

- ADR 0009 (B11 nullability) written before this commit — satisfies the R1.1 deferred-ADR follow-up.
- `errors.shape.account` reuse for the empty-`/api/i` body (not a history/emoji shape code — those would mis-localize a login-verify failure).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` (`oxlint --quiet src && eslint .`) → green, no output.
- `pnpm test` → 217 suites / 2894 tests passed (pre-batch: 217 / 2887; +7: explore +3, externalMe net +1, translator +3).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. 7 modified files + 1 new ADR, all inside the Batch 1 file list.

Next:

- Batch 2 (seams and types): quote seen-optimization re-seed via `useQuoteTarget` + per-backend resolver registration; Mastodon `voteInPoll` GET-then-POST (ADR first); narrow six mastodon `as any` casts; re-plumb 13 lint-allowlisted transport files onto injected `fetchImpl` seams.
- Batch 3 (screens/minors) and Batch 4 (locale extract/compile) after Batch 2.
