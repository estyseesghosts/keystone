# 2026-10-26 — composer-slice1 — coordinator

Branch: `main`
Goal: Composer slice 1 — durable in-progress draft + web persistence check.

Did:

- `src/storage/drafts.ts` — per-session `openDraftId` pointer (`keystone.drafts.<sessionId>.open`): `get/set/clearOpenDraftId` (missing/empty → null, never throws). Additive `hadMedia: boolean` (default false) on `localDraftSchema` — old rows validate and read false. Session-keying, `MAX_LOCAL_DRAFTS`, validation-drop unchanged.
- `Composer.tsx` — open resolution in one mount-time `useState` initializer: explicit `draftId` wins → targeted opens (reply/quote/edit/redraft) force a fresh id, never follow the pointer → else pointer row adopted WITH its id (autosave keeps updating the same row, no duplicate fork); stale pointer cleared inline, idempotent/StrictMode-safe. Restore reuses the `draftId` path via `restoreId` (state init + target re-attach effect) — no fork. Autosave sets the pointer on non-empty saves, clears on empty; submit/edit-submit clear it. Notice initializes to the honest attachments line (en-source `msg`, no locale churn) iff pointer-restore with `hadMedia`.
- Web backing: NO new file. Verified `react-native-mmkv@3.3.3` ships a `createMMKV.web.ts` localStorage-backed variant resolved by platform rules (in-memory fallback with console.warn when localStorage is unavailable). `sharedMmkv()`/`appKeyValueStore()` already persist on web; `tokens.web.ts` already depends on it.
- Coordinator fix: the slice's staged-attachment test waited on `/^composer-upload-/`, which matches several nodes per row (container/alt/sensitivity) — `getBy` throws multiple-match and `findBy` retries to timeout. Re-pointed at the unique `/^composer-upload-sensitive-/` toggle like the existing media tests. One-line test-only change; product code untouched. (Debug file `dbg-media.test.tsx` created for diagnosis, removed after.)

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- Targeted: `Composer.test.tsx` 33/33 (after the locator fix; before: the 1 new upload test timed out, everything else passed).
- Full: `pnpm test` → 217 suites / 2927 tests passed (pre-slice: 217 / 2913; +14: pointer lifecycle, refresh simulation, full-field restore, hadMedia notice paths, stale/targeted/explicit-id cases).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- One-line test locator fix (this log, above) — same file the slice owned.

Next:

- Slice 2: close guard (dirty → Save / Discard / Keep writing sheet; clean closes silently; backdrop + close button + back nav).
- Slice 3: server drafts where offered (smart-default save destination; list merges server + local; Mastodon local-only).
