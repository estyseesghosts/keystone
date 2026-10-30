# 2026-10-30 — emoji picker groups (v1 parity) — agent

Branch: `feat/emoji-picker-groups` (from `main`; carries the uncommitted
like-button tree — precedent: gapfill cut from the polish tree)
Goal: v1 picker powers — collapsible groups (persisted), custom pin/hide
(+ settings restore), favourites on top, web right-click menu.

Did:

- `src/state/emojiPrefs.ts` — `collapsed()` set + collapse/expand on the
  device-global group store (persisted, restored every open); new
  `persistLikeEmojiServer` helper (device store stays source of truth,
  `'unsupported' | 'refused'` for callers to report).
- `model.ts` — unified order: favourites (moved above recents, still
  populated-only) → recents → pinned block in pin order (customs before
  unicodes on a name clash) → unpinned customs (server order) →
  unpinned unicodes. Hide covers custom categories. `sectionsToRows`
  carries counts + skips collapsed rows. Removed `orderedUnicodeGroups`
  (single internal consumer + its test, both updated).
- `EmojiPicker.tsx` — collapsible headers (chevron + `Title (n)`,
  `expanded` a11y state); search suppresses collapse; web right-click
  cell menu (`AnchoredPopup` + `PopupRow/Desc/RadioDot`): favourite
  toggle (closes menu, favourites section leads) / use-as-like (device
  set + server persist, toast only on failure). New `ChevronIcon`;
  web-only `onContextMenu` on shared Pressable (gated inside, native
  never sees it).
- `ReactionsSection.tsx` — shared `GroupToggleRow`; new custom-groups
  row (pin/hide; hidden-without-known names still list = the restore
  path); like persist refactored to the shared helper; favourites hint
  updated (top, not after recents).
- Tests: store (collapse set, persist helper 5 ways), model (order /
  hide / counts / collapse-skip), picker (toggle + persistence across
  remount, search expansion, menu open/preventDefault/favourite/like +
  toast), settings (custom rows, hide→unhide, restore-without-known).
- `intl:extract` + compile for the new strings.

Decided:

- Per-category collapse, NOT V1's single "Default Emoji (1915)"
  super-header: uniform with customs and aligned with per-category
  pin/hide in settings. Say the word for V1-literal (bigger remodel).
- No native long-press menu (settings rows stay the touch path).
- Same-name categories across servers share pin/hide/collapse state
  (device-global, same tradeoff as the existing store).
- Favourites above recents (V1 order + "above any pinned groups").
- Button-canonical rule reused for the menu radio (`sameEmojiKey`).

Tests / verification (paste commands + results):

- New/updated suites: emojiPrefs + EmojiPicker + ReactionsSection →
  26/26 pass. Wider set (model/store/settings/postactions/shell-chrome/
  nav-polish/polish-regression) → 133/133 pass (pre-rename; rename-only
  change re-verified by the 26).
- `pnpm typecheck` (ios+android+web) → clean. `pnpm lint` → clean.
  (Two gate fixes: `header?.count` narrowing in test; `useAsLike`
  renamed to `setAsLike` — hooks rule.)
- Full `pnpm test` → not run; must confirm flat at pre-existing 90
  before merge.
- Web/device runs → `not verified` (owner visual checks open).

Deviations:

- Branch carries the uncommitted like-button slice (ActionBar,
  postactions, api-emoji-like, its task/log). Files are disjoint from
  this slice; separate commits at merge time.
- `docs/v1-emoji.png` / `v2-emoji.png` left untracked (owner-provided
  reference; merge decision with the branch).

Next:

- Owner visual checks on web (collapse/pin/hide/right-click/menu).
- Full `pnpm test`, then merge (+ decide the reference PNGs).
