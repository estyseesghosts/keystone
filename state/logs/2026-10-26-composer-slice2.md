# 2026-10-26 — composer-slice2 — coordinator

Branch: `main`
Goal: Composer slice 2 — close guard (dirty → Save / Discard / Keep writing; clean closes silently; all exits guarded).

Did (subagent, working tree):

- `Composer.tsx` — `isCloseDirty()` reads LIVE state (`!isDraftEmpty(text/cw/poll/visibleUserIds)` OR staged attachments count as dirty — uploads-in-progress would be silently lost otherwise), `requestClose()` (clean → `onClose`, dirty → `confirmingClose`), `saveAndClose` (local `saveDraft`, clears pointer, suppresses pending autosave tick via `postedRef`), `discardAndClose` (deletes row + pointer, no second confirm), `keepWriting`. `snapshotDraft()` helper extracted from autosave (zero behavior change).
- `CloseConfirmDialog.tsx` (new) — renders through the shared `Dialog` primitive (no new modal style); en-source copy; backdrop/Escape/✕ = Keep writing.
- `CompactComposer.tsx` — Cancel routes through `requestClose`; exposes `{requestClose, isDirty}` via `closeGuardRef` (`useImperativeHandle`, new `CloseGuardHandle`); renders the dialog.
- `ComposeScreen` — backdrop → `requestGuardedClose`; `beforeRemove` blocks dirty back-nav (`preventDefault` + sheet); `dismissedRef.forceClose` lets the guard-approved close proceed without re-triggering the guard. Guard-less states close directly.
- Tests: `Composer.test.tsx` +6, `Compose.test.tsx` +5 new guard tests.

Coordinator fixes (test harness only, no product change):

- `Compose.test.tsx` had no `I18nProvider` — the new `Dialog` (`useLingui`) threw. Wrapped `setup()` tree + `i18n.load/activate('en')` (same as `Composer.test.tsx`).
- `useNavigation` mock returned a fresh object per call → `beforeRemove` effect re-subscribed every render. Stabilized to a module-level `mockNav` (mirrors prod stability; nothing asserts on `dispatch`).
- Back-nav test invoked the listener outside `act` → state update never flushed before the sheet assertion. Wrapped in `act`.
- Full-mount `setup()` takes 2-4s on a loaded box; the 5s default flakes under full-suite load (same class as the postquote-emoji 20s precedent — verified via worktree-style A/B reasoning: the sheet test fails slow, passes immediately after with no code change). Added `jest.setTimeout(20000)` per describe block in `Compose.test.tsx` (3 lines, no product change).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2938 tests passed (pre-slice: 217 / 2927; +11). One transient single-suite failure mid-investigation under parallel load; immediate re-runs green (load flake, not a product regression — no product code touched in response).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- `Compose.test.tsx` harness fixes above — same files the slice owned.

Next:

- Slice 3: server drafts where offered (smart-default save destination: `backend.serverDrafts` when present, local otherwise; drafts list merges both; Mastodon local-only, no invented endpoint).
