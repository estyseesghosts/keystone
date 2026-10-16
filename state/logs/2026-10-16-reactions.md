# 2026-10-16 — Misskey-style reactions (chips row + like/emoji split)

Owner request (from `docs/misskey.png`): chips row (emoji + count each)
above the actions only when reactions exist; like counter includes all
reactions incl. hearts; heart button = ❤ only; hearts never in the emoji
row; separate stateless smiley emoji-picker button.

## What changed (`frontend/` only)

- `src/components/ReactionPicker.tsx` (rewritten exports): `HEART_REACTION`
  + `isHeartReaction` (both ❤ forms); `visibleReactions` (non-heart,
  positive counts, desc; tolerates transient null maps); `ReactionChips`
  (toggle buttons when logged in, static otherwise, `mine` highlight);
  `LikeButton` (heart + total `reactionCount`); `EmojiButton` (stateless
  `SmileIcon`, popup picker with presets + custom + remove + close,
  outside-click/Escape close). ❤ removed from presets.
- `src/components/icons.tsx`: `SmileIcon` (stroke set, file convention
  is "no emoji in controls" — the old "+" / selected-emoji button text
  violated it).
- `src/components/NoteCard.tsx`: chips row between body and actions;
  actions use Like + Emoji buttons; logged-out static heart + count.
- `src/components/TimelineFeed.tsx`, `src/routes/Note.tsx`: `setReaction`
  set-semantics — delete-then-create on change (server answers
  ALREADY_REACTED on double-create, verified in source); counts always
  reconciled from the server (optimistic count edits removed).
- `src/styles/global.css`: `.reactions` / `.rxn` (+ `.mine`) / `.emojwrap`
  / `.reactpicker.popup` (absolute under the button, like the renote menu).
- `docs/frontend-plan.md`: Slice 3 reaction bullet records the behavior.

## Evidence

- `tsc --noEmit` clean, `npm run build` green.
- `visibleReactions`/`isHeartReaction`: **10/10** against the real module.
- Live both servers: like → `myReaction: ❤`, count includes it; switch
  via delete+create → only the new emoji remains; remove → `myReaction:
  null`, count 0. (One Sharkey read transiently packed `reactions: null`
  mid-sequence — re-run clean; UI hardened with `?? {}` regardless.)
- Visual confirmation **not yet verified** (no browser here) — owner rig.
