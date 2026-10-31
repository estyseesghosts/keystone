# 2026-10-31 — Merge P6.5 Pages + P6.6 Drive/Clips into main — agent

Owner approved the merge. Order: `p6.5-pages` fast-forwarded onto `main`
first (`0b9a01d`), then `p6.6-drive-clips` merged with a merge commit
(independent branches, neither contained the other).

## Conflicts (16 files, all resolved)

- `src/state/queries/keys.ts`: adjacent additions (page/pages keys vs
  drive keys) — kept both.
- `src/state/queries/persistPolicy.ts`: adjacent additions — kept both
  (`page`/`pages` + `clips`/`clip-mosaic`/`drive-*`, all persist:false).
- `src/state/queries/index.ts`: kept all four exports
  (pages + clips + favourites + drive).
- `packages/fedi/src/core/models.ts`: kept both fields (`pinnedPageId`/
  `pinnedPage` + `limits?: AccountLimits`).
- `docs/DECISIONS.md`: kept PG-1..PG-11 + DC-1..DC-14 rows.
- `state/STATE.md`: fresh merged pointer (both programs merged).
- `src/locale/*` (12 catalogs): took P6.6 side, regenerated via
  `pnpm intl:extract && pnpm intl:compile` from merged source.

## Post-merge fix (real incompatibility, not a conflict)

- `src/components/DrivePicker.tsx` (P6.5 slice 4, new file) was written
  against the pre-P6.6 folder API (`folders.list()` → array). P6.6 changed
  it to `list({parentId, limit}) → Page`. Fixed the call site:
  `list({parentId: folderId, limit: PAGE_SIZE})` + `setFolders(items)`.
  Typecheck caught it; no test change needed.

## Verification (on the merged tree)

- `pnpm typecheck` clean; `pnpm lint` clean.
- Targeted (Pages/DrivePicker/Clips/Drive/Collection/Page/queries +
  fedi pages/clips/drive/driveOps): 44 suites, 498/498.
- Full suite: 332 suites / 4517 tests → 4427 pass, **90 fail — exactly the
  pre-existing content/linkpreview/richtext/post set (13 suites)**. Flat.
- Device/web screenshots + rig live-checks: `not verified` (owner items,
  carried in both programs' live-check lists).

## Bookkeeping

- `docs/tasks/p6.6-drive-clips.md` → done, merged; `docs/tasks/p6.5-pages.md`
  → done, merged; `docs/tasks/README.md` rows updated.
- `state/STATE.md` pointer → merged phase.
- Branches `p6.5-pages` + `p6.6-drive-clips` pruned locally after the merge.
- NOT pushed — no push approval (`git status` clean vs origin after commit
  except the merge itself sitting on local `main`).
