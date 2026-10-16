# 2026-10-16 — Emoji picker + favourites + custom like

## Goal

Owner request: copy the Misskey emoji picker (`docs/misskey_emoji_picker.png`)
in Keystone styling — a floating panel over the active context (reacted
post, composer) — plus a `vispick`-styled right-click menu on emojis
(Add to favourites, with a stuck Favourites group next to Recently
used), and "Use emoji as like" setting the like button's emoji with an
animated heart→emoji transition on click. Scoping answers: device-local
for now (per-account with Pinetree), right-click on picker cells only,
custom like excluded from the chip row.

## What changed

- `frontend/src/api/emoji.ts` (new, pure): `HEART_REACTION` /
  `isHeartReaction` (canonical home now), `isLikeActive`
  (exact-or-both-hearts; a legacy heart under a custom like reads as
  unliked so clicking upgrades it via delete-then-create),
  `shouldHideChip` (hearts + configured like),
  `visibleReactions(reactions, likeEmoji?)`, `QUICK_REACTIONS` /
  `COMPOSER_EMOJI`, custom `:name:` code helpers, category grouping +
  name/alias/unicode filters, `parseStoredList` / `touchRecent` /
  `addFavourite` / `removeFavourite`, `parseLikeEmoji`.
- `frontend/src/api/customEmoji.ts` (new): public `POST /api/emojis`
  with session cache + in-flight dedupe (translate.ts pattern) and a
  reactive URL map (`customEmojiUrl`) so chips, like button, and picker
  cells re-render when the listing lands. 404 → `unavailable` (section
  omitted — the Pinetree path); other failures → `error` + Retry.
- `frontend/src/state/emojiPrefs.tsx` (new, mirrors
  `state/appearance.tsx`): `EmojiPrefsProvider` + `useEmojiPrefs` —
  favourites, recents, likeEmoji over `keystone_emoji_*` localStorage
  keys with try/catch persistence.
- `frontend/src/components/EmojiPicker.tsx` (new): `EmojiGlyph`
  (hosted img when a packed URL is known, else literal text — never
  fabricated), `EmojiPickerButton` (trigger + floating
  `.emojpick.popup` panel, outside-click/Escape dismiss). Panel:
  quick row, Favourites (hint when empty), Recently used, Custom
  Emoji (collapsible `Category (n)` rows, 120-per-grid cap + search
  hint), bottom Search (unicode + lists + custom names/aliases,
  deduped, capped 60), `:code:` form in reaction mode, Remove
  reaction + Close. `EmojiCtxMenu`: cursor-fixed `vispick`-styled
  `role=menu` (favourite toggle + Use-emoji-as-like radio),
  dismissing on outside click / Escape / scroll / resize. Every pick
  records Recently used in both modes.
- `frontend/src/components/ReactionPicker.tsx`: chips read the
  configured like and exclude it (`visibleReactions` second arg);
  chips render `EmojiGlyph` (custom images where known, text
  otherwise — unicode rendering byte-identical). `LikeButton` rewired
  to `onReact(reaction | null)`: likes with the configured emoji,
  liked state shows the real reaction (filled heart for hearts),
  heart→emoji swap plays a 0.22s pop (`prefers-reduced-motion`
  disables it — the no-elaborate-animation guard stands, this is one
  transform on an explicit user action). `EmojiButton` +
  `COMMON_REACTIONS` deleted (superseded by the shared button).
- `frontend/src/components/NoteCard.tsx`: `LikeButton onReact` +
  `EmojiPickerButton mode="reaction"`; logged-out fallback unchanged.
- `frontend/src/components/Composer.tsx`: bespoke 16-emoji popup
  replaced with `EmojiPickerButton mode="insert"` (caret insert
  preserved; custom `:name:` picks insert literally so the server
  renders them).
- `frontend/src/components/FloatingComposer.tsx`: Escape-yield
  selector updated (`.emojpick`, was `.reactpicker`).
- `frontend/src/routes/Settings.tsx` + `App.tsx`: `/settings/reactions`
  ("Reactions and emoji" row) — current like emoji + Reset to heart +
  favourites list with Remove (keyboard/touch path for the
  right-click actions); `EmojiPrefsProvider` mounted in `App`.
- `frontend/src/styles/global.css`: `.emojpick.*` panel language,
  `.emojictx-menu` (fixed, inherits `vispick-menu`), `.likepop`
  keyframes + reduced-motion guard, `.like-current` / `.favlist`
  settings rows; dead `.reactpicker` rules removed (`.reactcustom`
  form styles kept — still used).
- `docs/api-surface.md`: `emojis` endpoint row + capability row
  (Misskey: not yet verified; Sharkey: probed live; Pinetree: 404).
- `docs/frontend-plan.md`: new slice checklist.

## Evidence (real output)

- `POST https://dvd.chat/api/emojis` `{}` → 200
  `{emojis: [...]}`: **3,488 items / 51 categories**, item keys
  `{aliases, category, name, url}`; `POST /api/emojis/list` → 404
  (route not registered — the bare `emojis` route is the one);
  `meta.defaultLike` is `'❤️'` (informational only).
- Pure checks (esbuild-bundle + node over the real module):
  **37/37 passed** (hearts, like-active incl. legacy-heart-upgrade,
  chip exclusion, code parse incl. remote-key null, grouping,
  filters, stored-list validation/caps, recents MRU, favourites
  stick/dedupe/cap, like-emoji parse).
- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-BIUgEyQc.js`, 254.99 kB;
  `index-eFBF2uzq.css`, 35.35 kB).
- `vite --port 5199` serves 200.
- Static: no `from "react"`, no `COMMON_REACTIONS`/`EmojiButton`
  remnants, no new colors (grey-only), every settings row navigates
  to a real page. Solid checklist (`solidjs.md` §10) walked: props
  read at use (no destructuring), `<For>`/`<Show>` throughout,
  memos for results/groups/chip-keys, effects are closers only
  (`loadCustomEmojis()` is an idempotent module-guarded kick in the
  panel body, not derived state), `onCleanup` for listeners/timers.
- No backends on this machine — API suites N/A (only the public
  `emojis` probe above). Browser behavior (panel position over
  note/composer, ctx-menu placement, like pop, settings page,
  mobile widths, both themes, logged-out chips) **not yet verified**
  (owner).

## Open questions

- None blocking. Remote `:name@host:` reactions stay literal text
  (no packed URL known) — matches the mfm rule.
- `defaultLike` from `meta` is currently informational; the like
  emoji stays purely a client setting per the request.

## Next step

Owner browser pass on dvd.chat: open the reaction picker and the
composer picker (quick/favs/recents/custom/search), right-click a
cell (favourite + use-as-like), like/unlike with a custom emoji,
`/settings/reactions` round-trip, Pinetree mode (no Custom
section). Then commit this slice.
