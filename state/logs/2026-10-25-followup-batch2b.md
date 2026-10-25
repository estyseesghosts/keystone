# 2026-10-25 — followup-batch2b — coordinator

Branch: `main`
Goal: Implement ADR 0010 (poll-id-on-model; kill Mastodon `voteInPoll` GET-then-POST).

Did:

- `core/models.ts` — `Poll` gains `id: string | null` (first field; null = unknown, never "go fetch it").
- `mastodon/adapt.ts` — `adaptPoll` populates `id` from wire `Poll.id`; `misskey/adapt.ts` sets `id: null` (verified `misskey/wire.ts` poll has no id: `multiple/expiresAt/expiredAfter/choices` only).
- `mastodon/endpoints.ts` — `voteInPoll(client, pollId, choices)`; status-GET fallback DELETED; null/missing id → typed `FediError("errors.shape.noPoll")`, zero requests, then single POST.
- `core/backend.ts` — `votePoll(id, choices, poll?)` optional third param, backward compatible, contract documented per family.
- `mastodon/backend.ts` — forwards `poll?.id` (status id param now unused `_id`).
- `misskey/backend.ts` — `poll === null` → typed `noPoll`, zero requests; `undefined` (legacy) proceeds; present-poll null id never blocks (vote keys on note id).
- `PostCard.tsx` — `LiveBits.votePoll` + callback take the optional poll; call site passes `effective.poll`. `postActions.ts` has no vote path — untouched.
- Tests: endpoints vote test rewritten in place (no GET, single POST); +1 backend `it` per family; 4 adapt assertions; core-Poll literals gained `id` in `models/PostPoll/contrast/redraft` suites. No new suite files.
- UI: no call site reads `poll.id`; vote control already gated on `effective.poll !== null` (read-only render without `onVote`, never inert). Mastodon null-id unreachable via adapt; hand-built nulls fail to the honest inline error.

Decided (→ ADR or DECISIONS entry if load-bearing):

- None new — implements ADR 0010 as written.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2907 tests passed (pre-batch: 217 / 2905; +2).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`. Live duplicate-vote behavior → owner-only (unchanged).

Deviations (files touched outside the slice + why):

- None. 8 prod files + 9 test files, all inside the ADR's prescribed surface.

Next:

- Batch 3 (screens/minors): D3.7 leftovers, avatar `safeHttpUrl` gates, softMute LRU cap.
- Batch 4 (locale extract/compile + English-only queue check).
