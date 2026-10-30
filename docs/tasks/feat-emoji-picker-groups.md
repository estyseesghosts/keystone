# Emoji picker groups (v1 parity)

Plan ref: owner request 2026-10-30 (v1/v2 screenshots in `docs/`)
Status: done, merged to `main` 2026-10-30 (`ae638e4`; owner visual checks open)
Branch: `main` (was `feat/emoji-picker-groups`, pruned)

## Goal

Picker groups catch up to v1: independently collapsible (persisted), pinnable/hideable custom groups (restore in settings), favourites quick-access on top, web right-click cell menu.

## Read first

- `src/components/EmojiPicker/model.ts` (ordering, collapse shape)
- `src/components/EmojiPicker/EmojiPicker.tsx` (headers, menu)
- `src/state/emojiPrefs.ts` (collapsed set, like persist)
- `src/components/Settings/ReactionsSection.tsx` (groups rows)

## Steps

- [x] 1. Store: `collapsed()` list + collapse/expand (device-global, persisted); `persistLikeEmojiServer` shared helper (device store stays source of truth).
- [x] 2. Model: unified order (favourites → recents → pinned block → unpinned customs → unpinned unicodes); hide covers custom categories; `sectionsToRows` carries counts + skips collapsed rows. Removed `orderedUnicodeGroups` (consumers updated).
- [x] 3. Picker: collapsible section headers with counts (search suppresses collapse); web right-click cell menu (favourite toggle / use-as-like with radio + toasts); `ChevronIcon`; web-only `onContextMenu` on shared Pressable.
- [x] 4. Settings: `GroupToggleRow` shared by unicode row; new custom-groups row (pin/hide; hidden-without-known lists for restore); favourites hint updated; like persist refactored to the shared helper.
- [x] 5. Tests: store (collapse set, persist helper), model (order/hide/counts/collapse), picker (toggle + persist across remount, search expansion, menu actions), settings (custom rows, restore path).
- [x] 6. `intl:extract` + compile for the new strings.
- [x] 7. Gate: typecheck + lint clean; targeted suites green; full `pnpm test` flat at pre-existing 90 (verified pre-merge 2026-10-30: 305/4278, 90 fail = known set).
- [ ] 8. Owner visual checks on web (collapse/pin/hide/right-click) (open).

## Acceptance

- [x] Every group independently collapsible; state persists across opens
- [x] Custom groups pinnable to top, hideable, restorable in settings
- [x] Favourites quick-access on top (above pinned), only when populated
- [x] Web right-click menu: pin to favourites / use as like
- [x] Full suite: no NEW failures (verified pre-merge) vs 90 pre-existing
- [ ] Owner visual checks pass (open)

## Out of scope

- V1-literal single "Default Emoji" super-header (per-category collapse instead — see log).
- Native long-press equivalent of right-click (settings rows stay the touch path).
- Same-name custom categories across servers share pin/hide/collapse state (device-global, same as existing).
- Remote-search section collapsibility (search always expands).

## Log

- `state/logs/2026-10-30-emoji-picker-groups.md`
