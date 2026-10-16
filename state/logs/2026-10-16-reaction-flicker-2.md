# 2026-10-16 — Reaction flicker, round 2 (chip remounts + disabled flash)

Owner report after hard reload: the emoji button and chip row still
flickered on like/unlike. The row-identity fix was necessary but not
sufficient — two more flash sources were found by tracing the update
path (see `2026-10-16-reaction-flicker.md` for round 1).

## Root causes

1. Chip remounts: `visibleReactions()` builds fresh `[key, count]`
   tuples on every note-object change, so `<For>` saw all-new item
   identities and disposed/recreated every chip on each reconciliation.
2. Disabled-style flash: the `reacting` busy flag drove `disabled` on the
   like/emoji/chip controls for the whole multi-round-trip flight, so
   `:disabled` styling visibly toggled twice per action.

## What changed (`frontend/` only)

- `ReactionPicker.tsx`: chips iterate stable key strings (primitives
  compare by value — refreshes move/leave chips, never remount them);
  counts/ownership flow through accessors into a `Chip` child for
  in-place text updates. `disabled` removed from `LikeButton`,
  `EmojiButton` (popup included), and chips.
- `api/types.ts`: pure `withReaction(note, reaction)` end-state helper.
- `NoteCard.tsx`: `reacting` prop removed (no consumer left).
- `TimelineFeed.tsx` / `routes/Note.tsx`: `setReaction` applies the
  optimistic end state first (instant feedback, no style flash), then
  delete + create, then reconciles; the busy guard stays as a silent
  duplicate-click guard, and failures roll back via re-read.

## Evidence

- `tsc --noEmit` clean, `npm run build` green.
- `withReaction`: 5/5 (like, unlike, switch moves only my vote,
  same-reaction no-op, count floor); prior suites still green
  (reactions 10/10, collapse 16/16, quote-target 64/64).
- Visual confirmation **not yet verified** (no browser here) — owner rig:
  like/unlike/chip-toggle should now apply instantly with no flash on
  the buttons or chips row.
