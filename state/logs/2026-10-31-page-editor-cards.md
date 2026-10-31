# 2026-10-31 — Page writer cards + formatting icon toolbar — agent

Branch: `feat/page-editor-cards`
Goal: turn every page-writer block into a self-contained card; text cards
go composer-style with the formatting options as a vector-icon row on top
(visible only for the focused text field); "Show formatting in editor"
defaults to on.

## Did

- `src/components/icons.tsx`: nine new stroke glyphs (24×24 grid, same
  Base as the rest of the Butterfly set): Bold, Italic, Strike, Code,
  CodeBlock, Quote, Link, Center, Small.
- `src/components/PageEditor/FormatToolbar.tsx`: the nine MFM controls
  render as vector icons in a horizontal row (was Caption text labels).
  Labels kept as `accessibilityLabel`, testIDs (`tb-*`) unchanged, link
  URL dialog unchanged, web `onMouseDown preventDefault` selection
  preservation unchanged. Active = `palette.text` icon, inactive =
  `palette.muted`.
- `src/components/PageEditor/BlockList.tsx` `BlockChrome` → card chrome
  (Misskey `page-editor.container.vue` pattern): bordered panel
  (`palette.edge`, `radius.md`, `palette.bg`), header row on
  `palette.bgSoft` (kind icon + label + collapse chevron + block menu as
  a MoreIcon trigger), padded body below. Every block kind is a card;
  sections render nested cards inside their card body.
- `src/components/PageEditor/BlockEditors.tsx` `TextBlockEditor`:
  composer-style (CompactComposer pattern) — borderless input inside the
  card (the card border is the container), formatting icon row above the
  input with a divider under it, shown only while that text field is
  focused. Render-on-blur RichText preview kept as-is.
- `pageShowFormatting` default `false` → `true`: `src/storage/schema.ts`
  (zod `.default(true)`, `defaultDeviceState`, v1-migration fill),
  `src/state/pageFormatPref.ts` (`?? true` fallbacks). Explicit stored
  values still win — only a missing key fills the new default.

## Decided (→ DECISIONS.md)

- PEC-1: card per block + top icon toolbar (was loose chrome + text
  labels).
- PEC-2: reverses PG-2's default (`false` → `true`); stored `false`
  still reads `false`.

## Tests / verification

- `pnpm typecheck` (ios+android+web) → clean
- `pnpm lint` → clean
- Targeted: `src/components/PageEditor src/screens/PageEdit.test.tsx
  src/storage src/state/pageFormatPref src/state/appearance.test.ts` →
  10 suites, 122/122.
- Full `pnpm test` → 332 suites / 4518 tests: 4428 pass, **90 fail —
  exactly the pre-existing content/linkpreview/richtext/post set
  (13 suites)**. Flat vs merged baseline (4427 pass + 1 new test).
- Device/web visual check: `not verified` (owner item).

Test changes (not counts-flattening: behavior intentionally changed):

- `FormatToolbar.test.tsx`: visibility case split in two — rendered mode
  (default on: RichText until tapped, then toolbar + input) and raw mode
  (pref off: toolbar only while focused). Pref writes wrapped in `act`.
- `src/storage/schema.test.ts` + `index.test.ts`: default-filled
  expectations now `pageShowFormatting: true` (v1 migration + missing-key
  fills); explicit `false` round-trips unchanged.
- `src/screens/PageEdit.test.tsx`: `pageFormatPrefStore.set` in the
  test's `finally` wrapped in `act` (was a store-emit warning).

## Deviations (files touched outside the slice + why)

- `docs/DECISIONS.md`, `docs/tasks/*`, `state/*` — bookkeeping per
  AGENTS.md protocol.

## Next

- Owner visual check on web/device (card look, icon row, focus-gated
  toolbar, default-on rendered text).
- Merge to `main` after owner approval.
