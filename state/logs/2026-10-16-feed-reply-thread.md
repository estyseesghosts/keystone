# 2026-10-16 — Feed reply threading (home/loose-reply fix)

**Goal:** replies in the home timeline read as loose posts with no link to
what they answer (`docs/home-unthreaded.png`). Match the detail view's
threaded language (`docs/detail-threaded.png`) and the competitor's home
connector (`docs/competitor-home-reply-thread.png`).

## What changed (frontend only, no API/backend changes)

- `frontend/src/api/thread.ts`: pure feed helpers — `replyParentId` /
  `replyParentNote` (displayed-note aware, so pure-repost wrappers link by
  their original), `isDirectReplyTo` (quotes/renotes alone never link, no
  self-links), `computeFeedThreadLinks` (adjacent-pair links on the visible
  order only).
- `frontend/src/components/NoteCard.tsx`: `showReplyContext` (default ON)
  renders a small grey `Replying to …` line above the note head. Packed
  one-level `reply` names the parent (avatar-free name + handle, emoji-aware
  via `DisplayName`); otherwise a generic `a post` link to the parent id.
  The link opens `/notes/:parentId` with its full thread. Click-to-open
  already ignores `a` clicks, so the line never hijacks card navigation.
- `frontend/src/components/TimelineFeed.tsx`: post-collapse visible order
  feeds `computeFeedThreadLinks`; each row wraps in `.feed-row` with
  above/below flags. Adjacent child-above-parent pairs share one
  avatar-column connector and drop the divider inside the run (Home, Local,
  Global, and antenna feeds — all go through `TimelineFeed`).
- `frontend/src/routes/Note.tsx` + `ReplyList.tsx`: thread contexts opt OUT
  (`showReplyContext={false}` on ancestors, main note, and branches) — the
  tree already shows the parent there.
- `frontend/src/styles/global.css`: `.reply-context` (13px muted, ellipsis,
  global focus rule covers the link) + `.feed-row-thread` connector (same
  `1.07em + 19px` avatar geometry as the detail thread, `pointer-events:
  none`, divider removed only inside a run). Black/white/grey only.
- Profile `All posts` / Search note lists get the context line for free
  (same `NoteCard` default); the avatar connector is `TimelineFeed`-only in
  this slice.

## Evidence

- `npx tsc --noEmit` clean (no output).
- `npm run build` green:
  `dist/assets/index-NgPyNWYx.css 37.41 kB`, `index-BOJ4eSg-.js 259.19 kB`,
  `✓ built in 1.04s`.
- 20/20 pure-helper checks (esbuild bundle + node,
  `/tmp/opencode/thread-check.mjs` + `thread-verify.mjs`): parent
  id/note, direct/quote/self/wrapper links, adjacent chains (incl. 3-chain),
  non-adjacent isolation, quote-adjacency, empty/single, plus `mergeNotes`
  + `orderAncestors` regression. Output: `20 passed, 0 failed`.
- SolidJS `solidjs.md` §10 checklist walked (props read reactively, no
  snapshots; memos for derived links; `<Show>`/`classList` reactive;
  `<For>` identity untouched; no new effects/cleanup; no React deps).
- Live-API suites NOT re-run here (no backends on this machine); browser
  behavior (context line, connector geometry at desktop/mobile widths and
  text scales, streaming-insert relink, keyboard) **not yet verified**
  (owner).

## Open questions

- Timeline pages already pack the one-level `reply` on Misskey/Sharkey in
  practice (the `notes/show` fallback path in `Note.tsx` proves the shape),
  but if a server ever omits it the line degrades to the generic link —
  no extra per-reply `notes/show` fetch was added deliberately (no N+1).
  Confirm on the test machine that home pages carry `reply`.
- Profile `All posts` runs and search results show the line but no
  connector; extend the connector there only if the owner wants it.

## Next step

Owner browser/live pass on the test machine (misskey `:5176`, sharkey
`:5177`): open Home with a reply directly above its parent — expect the
`Replying to @user` line plus one continuous avatar line and no divider
inside the run — then `npm run build` + smoke suites to taste.
