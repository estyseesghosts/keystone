# 2026-10-16 — Quote-composer duplication + Post-button contrast

Owner report: (1) the inline quote composer opened under every feed copy
of the same post (acted-on copy plus repost wrappers / other copies);
(2) the Post/Quote/Reply button text had no contrast (dark on dark).

## Root causes

1. `TimelineFeed` keyed the open composer by quote *target* id
   (`quotingId() === target.id`, where `target = appearNoteOf(note)`).
   A pure-repost wrapper and its original share one target, so both
   matched and both rendered a `<Composer>`.
2. `.composer .toolbar button` (specificity 0,2,1) overrode
   `.btn-primary`'s background (0,1,0) without touching its text color:
   raised fill + body-colored text — dark-on-dark in dark mode,
   washed out in light mode.

## What changed (`frontend/` only)

- `src/components/TimelineFeed.tsx`: the composer key is now the acted-on
  feed item id (`quotingId() === note.id`); the quote *target* (original
  id) rides in a separate `quoteTargetId` signal feeding
  `Composer renoteId`. Toggle-off, post-success clear, and feed-reset
  clear both signals. Server semantics unchanged: `renoteId` is always
  the original (renoting a wrapper is server-rejected).
- `src/styles/global.css`: dedicated `.composer .toolbar .btn-primary`
  base/hover/active/disabled rules (specificity wins in all four states;
  verified by audit — the `[aria-pressed]` toggle rule cannot collide
  since the Post button carries no `aria-pressed`).

## Evidence

- `tsc --noEmit` clean, `npm run build` green.
- Logic verified by inspection (no browser here): wrapper id W ≠ target
  id T, so exactly one `<Show>` matches; feed dedupe forbids duplicate
  wrapper ids. Contrast verified by specificity audit (see above).
- Visual confirmation of both fixes is **not yet verified** — owner
  browser QA.

## Commit

- Committed + pushed with the two pending quote slices (renote menu,
  quote-posts) as one reviewed unit per owner instruction.
