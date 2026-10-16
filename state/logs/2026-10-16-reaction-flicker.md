# 2026-10-16 — Reaction flicker (stable feed row identity)

Owner report: liking/unliking flickered/redrew the emoji button and
chips row.

## Root cause

`refreshNote` swaps a fresh Note object into `notes()`, and Solid's
`<For>` keys rows by object identity — so every reconciliation remounted
the whole card (popup/composer state lost, media re-resolved: the
flicker). This affected any in-place feed refresh, noticed first on
like/unlike.

## What changed (`frontend/src/components/TimelineFeed.tsx` only)

- New `feedIndex` memo: `{ ids, byId }` derived from `notes()` in one
  computation. The feed `<For>` iterates stable id strings; each row is
  one reactive scope resolving `note()` / `target()` through `byId` on
  every read. Reconciliation now updates rows in place — counts, chips,
  and like state change with no remount.
- No handler/prop changes: `setReaction`, collapse gating, quoting keys,
  and `NoteCard` are untouched. Note detail never had this bug (`<Show>`
  function children don't remount on truthy→truthy changes); profile /
  search / replies never replace items in place.

## Evidence

- `tsc --noEmit` clean, `npm run build` green.
- Visual confirmation **not yet verified** (no browser here) — owner rig:
  like/unlike should now update heart + chips with no card flash and no
  popup/composer state loss.
