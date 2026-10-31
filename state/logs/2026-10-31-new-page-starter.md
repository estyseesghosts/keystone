# 2026-10-31 — New-page starter layout (follow-up) — agent

Branch: `feat/page-editor-cards`
Goal: a new page opens with the writer settings collapsed and three
blocks already added — one section containing two text blocks — with the
first text field already open (formatting row visible).

## Did

- `src/state/pageEditor.ts`:
  - `blankForm` now seeds a starter (`starterBlocks()`): one untitled
    section with two empty text blocks (fresh ids per init).
  - `PageEditorState` gains `baseline` (the seeded form for new pages,
    null for saved pages). `isPageDirty` compares a new page's form to
    its baseline instead of "anything non-empty", so a pristine starter
    is clean — no discard prompt, no draft write, Save stays disabled
    until the first real edit. Side benefit: slug-only/font/switch-only
    edits on a new page are now correctly dirty.
  - `firstTextBlockId()` exported (depth-first, pure) for the focus
    target; unit-tested.
  - The starter is real content: `pageDraft` sends it on create (an
    untitled section + empty text blocks render nothing in the reader).
- `src/screens/PageEdit.tsx`:
  - `settingsOpen` starts `false` for every page (was `isNew`); the
    settings card opens on tap.
  - After init on a new page, `autoFocusBlockId` = first text block
    (one-shot; cleared as soon as the block mounts).
- `src/components/PageEditor/BlockList.tsx`: `BlockEditorContext` gains
  `autoFocusBlockId` + `onAutoFocused` (one-shot focus contract).
- `src/components/PageEditor/BlockEditors.tsx` `TextBlockEditor`: starts
  focused when it is the auto-focus target, focuses the native input on
  mount, then clears the request.

## Tests / verification

- `pnpm typecheck` (ios+android+web) → clean
- `pnpm lint` → clean
- Targeted: `src/state/pageEditor.test.ts src/screens/PageEdit.test.tsx
  src/components/PageEditor` → 3 suites, 43/43.
- Full `pnpm test` → 332 suites / 4521 tests: 4431 pass, **90 fail —
  the pre-existing content/linkpreview/richtext/post set (13 suites)**.
  Flat (3 new tests added).
- Device/web visual check: `not verified` (owner item).

Test changes (intentional behavior change):

- `pageEditor.test.ts`: create payload now carries the starter content
  (was `content: []`); new "new-page starter" describe (seed shape,
  pristine-clean, edit→dirty, saved page has no baseline).
- `PageEdit.test.tsx`: new-page tests open the settings card first
  (settings now start collapsed); the show-formatting test uses the
  seeded first text block (blurs it before toggling) instead of adding
  one, and the image-block test waits on the add menu instead of the
  settings title.

## Deviations

- `docs/DECISIONS.md` (PEC-4), `docs/tasks/feat-page-editor-cards.md`,
  `state/*` — bookkeeping.

## Next

- Owner visual check: new page opens with section + two text blocks, the
  first field focused with the formatting row, settings collapsed.
- Merge `feat/page-editor-cards` to `main` after approval.
