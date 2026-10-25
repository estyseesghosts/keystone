# 2026-10-25 — followup-batch4 — coordinator

Branch: `main`
Goal: Batch 4 (locale): extract/compile the R2.2 poll-partial copy; confirm the 8 English-only keys are queued for the fr+7 sweep, not machine-translated.

Did:

- `pnpm intl:extract` (`lingui extract --clean --locale en`): R2.2 poll-partial copy (`"Recorded {0} of {1} choices. Retry sends only the rest."`, `PostPoll.tsx:190`) now in `en/messages.po` with source msgstr. Only `en/messages.po` modified (large diff is mostly `#: file:line` reference churn from the D3.x splits; no string changes except the new msgid).
- `pnpm intl:compile`: all 8 locales recompiled (`messages.ts` blobs). Non-en compiled catalogs carry the English fallback for the new key (e.g. fr `U7sa4E` = English segments; fr `messages.po` has zero "Recorded" hits) — standard Lingui missing-key fallback, queued for translation, not translated.
- 8-key check (D3.8 list) across `de fr hi ja yue-HK zh-CN zh-TW`: `savePending`, `badPath`, `unreachableBare`, `likeUnsupported`, `invalidDescriptor`, `createdList`, `updatedList` present with EMPTY msgstr; `profileField` absent entirely. All render the English source at runtime. Nothing machine-translated — the fr+7 sweep owns them, per D3.8 ticket.

Decided (→ ADR or DECISIONS entry if load-bearing):

- None. No translations invented (per slice rule).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2913 tests passed (pre-batch: 217 / 2913; no delta — locale only).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. 1 `.po` + 8 compiled `messages.ts` files only.

Next:

- Program complete (Batches 1–4 landed). Owner-only items remain (see final report): compose-sheet keyboard tracking, 200-post scroll + Android removeClippedSubviews, native bundle after next pnpm install, Sharkey/Misskey duplicate-vote live behavior, cross-account quote visibility, Mastodon /oauth/revoke + i/revoke-token live, chat attachment open on device.
