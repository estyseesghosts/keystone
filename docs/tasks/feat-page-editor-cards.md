# Page editor cards + formatting icon toolbar

Plan ref: owner request 2026-10-31 (post-program UI change; screenshots:
Misskey page editor card layout + Keystone post composer)
Status: done, branch `feat/page-editor-cards` (merge pending owner approval)
Branch: `feat/page-editor-cards`

## Goal

Every block in the page writer is a self-contained card; text cards are
composer-style with the formatting options as a vector-icon row on top,
visible only for the focused text field. "Show formatting in editor"
defaults to on.

## Read first

- `src/components/PageEditor/BlockList.tsx` (`BlockChrome` — card chrome)
- `src/components/PageEditor/BlockEditors.tsx` (`TextBlockEditor`)
- `src/components/PageEditor/FormatToolbar.tsx` (icon row)
- `src/components/Composer/CompactComposer.tsx` (ToolButton pattern)
- Misskey `packages/frontend/src/pages/page-editor/page-editor.container.vue`
  (reference card: panel bg, border, header row + body)

## Steps

- [x] 1. New stroke glyphs in `src/components/icons.tsx` (24×24 grid):
      Bold, Italic, Strike, Code, CodeBlock, Quote, Link, Center, Small.
- [x] 2. `FormatToolbar`: nine controls render as vector icons (was text
      labels); labels move to `accessibilityLabel`; testIDs unchanged;
      link dialog unchanged; web `onMouseDown` selection preservation
      unchanged.
- [x] 3. `BlockChrome` → card: bordered panel (`palette.edge`, radius md),
      header row (kind icon + label + MoreIcon block menu + collapse
      chevron) on `palette.bgSoft`, body padded below. Every block kind
      gets the card; sections nest cards inside cards.
- [x] 4. `TextBlockEditor`: composer-style borderless input inside the
      card; formatting icon row above the input with a divider, shown
      only while that text field is focused. Render-on-blur RichText
      kept.
- [x] 5. `pageShowFormatting` default `false` → `true` (schema default,
      `defaultDeviceState`, v1 migration fill, store `??` fallbacks).
      Explicit stored values still win.
- [x] 6. Tests: FormatToolbar visibility split into rendered-mode (tap to
      edit) + raw-mode cases, pref reset wrapped in `act`; storage schema
      fixtures updated for the new default (explicit `false` round-trips
      untouched).
- [x] 7. Antennas screen (owner follow-up 2026-10-31): create form and each
      antenna row reuse the card chrome; rename/delete are inline vector
      icon buttons in the card header (pencil/trash), two-tap delete
      confirm kept in the body; testID contract unchanged.
- [x] 8. Page-writer settings panel (owner follow-up 2026-10-31) uses the
      same card chrome: `SettingsIcon` + "Page settings" header row with
      a collapse chevron, fields in the padded body. TestIDs unchanged.
- [x] 9. New-page starter (owner follow-up 2026-10-31): new pages seed one
      untitled section with two text blocks, settings start collapsed,
      and the first text block is auto-focused once (formatting row
      visible). Dirty baseline = seeded form, so a pristine start is not
      dirty; the starter saves as real content.

## Acceptance

- [x] `pnpm typecheck` (ios+android+web) + `pnpm lint` clean
- [x] `pnpm test` → 332 suites / 4518 tests, 4428 pass, 90 fail — the
      pre-existing content/linkpreview/richtext/post set (13 suites),
      flat vs the merged baseline
- [ ] Owner visual check (web/device; open)

## Out of scope

- Drag-and-drop reorder (PG-6 stands: menu + buttons).
- Section title rename flow (stays a plain TextField in the card body).

## Log

- `state/logs/2026-10-31-page-editor-cards.md`
