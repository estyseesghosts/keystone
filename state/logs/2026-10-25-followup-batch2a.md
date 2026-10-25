# 2026-10-25 — followup-batch2a — coordinator

Branch: `main`
Goal: Land repair follow-up Batch 2a (quote re-seed, `as any` narrowing, transport re-plumb, voteInPoll ADR).

Did:

- (e) Quote seen-optimization re-seeded session-scoped: `Backend.seedSeenQuote?(note)` additive optional (`core/backend.ts`); Misskey backend delegates to its resolver's `registerSeenNote`; `useQuoteTarget` gains 4th optional param + seeding effect (seeds `effective` + non-quote `renote` + `visibleQuote` only when rendered — concealed cards seed nothing, same-or-stricter than the deleted R1.2 effect); `LivePostCard` memoizes and threads via optional `PostCardProps.seedSeenQuote`. Test in `misskey-session-caches.test.ts`: A's seed serves A with zero wire calls, B still fetches/fails alone.
- (g) Six mastodon `as any` casts narrowed to zero: file-local `isAccountRow` + exported `isStatusRow` in `adapt.ts` (narrowing casts match existing file idiom); 4 grouped-notification sites → `isXRow(v) ? adaptX(v) : null`; 2 listing maps (lists-timeline, bookmarks) → `filter(isStatusRow).map(adaptStatus)`. Malformed rows degrade where absent rows already degrade. Tests: `mastodon-grouped.test.ts` +1, `mastodon-w4-rows.test.ts` +1, both in place.
- (h) Transport re-plumb: `core/http.ts` is the single seam edge (structural `FetchImpl` type + lazy call-time `defaultFetchImpl`); 10 files take optional `fetchImpl` defaulting to the edge (detect, config, sessions, api/composer, api/linkpreview, both clients, external, remotepost, customEmoji; plus non-allowlisted `mastodon/instance.ts` threading). `SEAM_ALLOWLIST` 13→3 (`core/http.ts` edge + 2 stream `globalThis` socket constructions, documented remainder). Rule logic unbanned-weakened; rule tests updated. 8 new seam tests in existing suites (recording stubs pinning URL/body).
- (f-ADR) `docs/adr/0010-poll-id-on-model.md` (new) + README index row + one `docs/DECISIONS.md` line. Decision: core `Poll` gains `id: string | null`; Mastodon adapt populates, Misskey adapt null; `voteInPoll` uses the model id, GET fallback deleted; null → typed `errors.shape.noPoll`, zero requests. Code slice follows as Batch 2b.

Decided (→ ADR or DECISIONS entry if load-bearing):

- ADR 0010 written BEFORE the voteInPoll code lands (Batch 2b implements it).
- Seam edge design: one lazy `defaultFetchImpl` in `core/http.ts`; structural `FetchImpl` type so seam modules never name the banned global even in type position.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2905 tests passed (pre-batch: 217 / 2894; +11: quote +1, narrowing +2, seams +8).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- (e) additive optional `seedSeenQuote?` on the `Backend` interface (`core/backend.ts`) — unavoidable: the live card only holds the `Backend`. No existing signature changed. Mastodon backend omits it (no seen set).

Next:

- Batch 2b: implement ADR 0010 (poll id on model, both adapts, both vote paths, no GET fallback) + tests.
- Batch 3 (screens/minors), Batch 4 (locale extract/compile) after.
