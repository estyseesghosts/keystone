# 2026-10-31 — Antennas cards (follow-up to page-editor-cards) — agent

Branch: `feat/page-editor-cards`
Goal: antennas borrow the page-writer card design; rename/delete become
little vector buttons inline with the header/antenna name.

## Did

- `src/components/icons.tsx`: `TrashIcon` (24×24 stroke grid, lid +
  handle + can, matches the Butterfly set).
- `src/screens/Antennas.tsx`:
  - `AntennaRow` → card: bordered panel (`palette.edge`, `radius.md`,
    `palette.bg`), header row on `palette.bgSoft` with `AntennaIcon`, the
    antenna name (still the open link), then two inline vector buttons —
    pencil = inline rename, trash = arm delete. Body holds the summary
    caption, the inline rename form, and the two-tap delete confirm
    (destructive confirm kept — no one-tap deletes).
  - `CreateRow` → same card chrome with a "New antenna" header
    (`AntennaIcon` + label); field label became "Antenna name" so the
    card header owns the section title (no duplicated label).
  - testID contract unchanged (`antennas-row-*`, `-open-*`, `-rename-*`,
    `-rename-input-*`, `-rename-save-*`, `-rename-cancel-*`,
    `-delete-*`, `-delete-confirm-*`, `-delete-cancel-*`, create ids).

## Decided

- PEC-3 in `docs/DECISIONS.md` (antennas reuse the card chrome; actions
  inline in the header; two-tap delete confirm stays).

## Tests / verification

- `pnpm typecheck` (ios+android+web) → clean
- `pnpm lint` → clean
- Targeted: `src/screens/Antennas.test.tsx src/screens/Antenna.test.tsx
  src/components/PageEditor` → 3 suites, 23/23.
- Full `pnpm test` → 332 suites / 4518 tests: 4428 pass, **90 fail —
  the pre-existing content/linkpreview/richtext/post set (13 suites)**.
  Flat.
- Device/web visual check: `not verified` (owner item).

## Deviations

- `docs/DECISIONS.md`, `docs/tasks/feat-page-editor-cards.md`, `state/*` —
  bookkeeping.

## Next

- Owner visual check of the Antennas screen (cards + inline pencil/trash).
- Merge `feat/page-editor-cards` to `main` after approval.
