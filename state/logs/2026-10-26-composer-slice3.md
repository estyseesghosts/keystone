# 2026-10-26 — composer-slice3 — coordinator

Branch: `main`
Goal: Composer slice 3 — server drafts where offered (smart-default save; merged list; Mastodon local-only).

Did (subagent, working tree):

- `Composer.tsx` — `saveAndClose` is now async with the smart default: `backend.serverDrafts` present → shared `useSaveServerDraft` mutation (create, or UPDATE the tracked `serverDraftId`), then drop the local row + pointer (no double copy) and close. 404/405 (`isUnsupportedError`) → silent local fallback (server lacks the endpoint — probe, don't assume). Other failures (network/500/validation) → preserve content locally, surface via the error line, STAY OPEN (never close over an invisible error). `saveCloseRef` single-flight (second Save mid-await dropped; resets in `finally` so failures stay retryable). `serverDraftId` set by new `restoreServerDraft`, cleared by local `restore` and all post paths.
- `ComposerSections.tsx` — `DraftsSection` gains the "On this device" caption only when `backend.serverDrafts` exists (Mastodon renders byte-identical output); `ServerDraftsSection` restores/saves delegate to the controller (`restoreServerDraft`/`saveServerDraftNow`) so explicit and guard saves both update in place; removed the local build/save fork + dead error slot. Close-dialog copy untouched ("Save draft" — destination is an implementation detail).
- Mastodon: verified no `serverDrafts` member (grep) — section null, save pure local, zero server calls.
- Tests: `Composer.test.tsx` +7 (server create/no-local-row, 404 silent fallback, 500 honest + stay-open + preserved, update-not-duplicate, Mastodon local-only, merge labels, Mastodon bare), `ComposerSections.test.tsx` delegation + locations block. No new suites, no locale churn, no endpoint invented.

Coordinator fixes (test-only, no product change):

- `serverDraftsMock` missed `ServerDraftsApi.count` → added `count: jest.fn(async () => list.length)`; mock typed as `ServerDraftsApi & typeof mock` so jest.Mock methods stay visible at use sites (bare-cast hides `mockRejectedValueOnce`).
- Two merge/label tests asserted the drafts list without opening it (`showDrafts` gate) → added the `composer-drafts-toggle` press, matching the section's actual UX.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2951 tests passed (pre-slice: 217 / 2938; +13).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. 4 files (2 prod, 2 test), all inside the slice surface.

Next:

- Composer drafts program complete. Owner live-tests externally (refresh-restore, close-sheet choices, server-draft round-trip on a Sharkey/Misskey with `notes/drafts`, Mastodon local-only).
