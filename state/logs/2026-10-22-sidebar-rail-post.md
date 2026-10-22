# 2026-10-22 — Sidebar rail follow-up (Post + overflow) — agent

Branch: `p6.4-sidebar-reshuffle` (follow-up commit on same branch)
Goal: wider group spacing; Post below profile in both layouts; rail-only
Settings/Uploads overflow in the profile menu.

## Did

- `src/Navigation.tsx`:
  - `sideGroup` spacing 16 → 28.
  - Post button moved out of the pre-footer slot into the footer, directly
    below the identity row and above the quick actions; renders in full
    AND rail (narrow sidebar never loses it). Keeps the `postButton`
    outline (`borderWidth` + `edge` color) and the vector `PencilIcon` to
    set it apart from category tabs. New `testID="sidebar-post"`.
  - Rail quick actions filter out `settings` + `uploads` (Messages and
    Notifications stay as icon buttons).
  - `AccountButton`/`AccountMenu` gained `overflowActions`: when true
    (rail only) the menu carries `Settings` → Settings and `My Uploads` →
    Drive (misskey only). Expanded sidebar and mobile strip pass nothing,
    so those rows appear in exactly one place per layout.
- Tests (`shell-chrome.test.tsx`): Compose screen mock + 6 new tests —
  Post opens composer on full and rail; rail hides settings/uploads but
  keeps messages/notifications; rail menu overflows settings (+uploads on
  misskey, settings press lands); expanded menu carries no overflow rows.

## Tests / verification

- `pnpm run typecheck` (ios+android+web) → clean
- `pnpm run lint` → clean
- `pnpm test` → **187 suites / 2374 tests green** (+6)
- Device/web runs → `not verified` (owner visual pass still pending)

## Next

- Owner desktop-large + rail-width visual pass
- Merge to `main` after sign-off
