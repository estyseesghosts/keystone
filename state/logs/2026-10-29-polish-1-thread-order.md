# 2026-10-29 — polish/1 thread ordering (Deliverable 1) — agent

Branch: `polish/1-thread-order` (cut from `p6.5-unread-counter`; other tree
dirt left alone; never `git push`)
Goal: chronological reply chains (oldest/root first, newest last) with the
main feed staying newest-first (`docs/visual-polish.md` Deliverable 1).

Did:

- Read `AGENTS.md`, `state/STATE.md`, P6.5 log, `docs/visual-polish.md`,
  `docs/tasks/visual-polish.md` in order; confirmed branch
  `p6.5-unread-counter`, cut `polish/1-thread-order`.
- Traced all four layers the brief names before touching anything:
  1. query results — Misskey `threadReplies` (`callNotes`→`pageOf`,
     `misskey/backend.ts:199`) passes server order through untouched;
     Mastodon `threadReplies` (`mastodon/backend.ts:584`) filters
     `context.descendants` by `replyToId` preserving context order.
     Neither backend re-sorts.
  2. per-level chain selection — `chronological()` (`Note.tsx:99`) applied
     at all four read sites (root list, `ChainSpine`, `RootReply`,
     `FullSubtree`); lineal child is always `items[0]` (oldest).
  3. branch rendering — `ChainSpine`/`FullSubtree` recurse depth-first,
     oldest-first; reveal renders terminal children then skipped younger
     siblings per level (each level renders its own `youngerAbove`, so the
     per-level `youngerAbove` replacement drops nothing).
  4. final list order — `FlatList data={rootItems}` (chronological).
- Reproduced empirically with a scratch screen test (deleted after):
  branched fixture (A1→B1→C1 + B1b, A2) under newest-first (Misskey) and
  oldest-first (Mastodon) server orders rendered identically:
  pre-reveal `[A1,B1,C1,A2]`, post-reveal `[A1,B1,C1,B1b,A2]`;
  3-level fixture revealed `[A,B,C,D,C2,B2]`; ancestors `[a0,a1,a2]`.
- Finding: **no visible inversion reproduces on this tree.** Slice B
  (`8e99a58`) + redo (`3326732`) already fixed thread chronology with the
  `chronological()` read-site sort. Per the binding constraint I did NOT
  blindly reverse anything — a prod change here would regress correct
  behavior. Slice output is therefore proof-of-correctness regression
  coverage for the previously unpinned acceptance points (zero prod
  changes; `MODEL_SHAPE_HASH`/`SCHEMA_VERSION` untouched).
- Added 7 regression tests (test files only, +190 lines):
  - `src/screens/Note.test.tsx` (+4): explicit A→B→C row-order array with
    latest-last pre/post reveal; identical render under oldest-first
    (Mastodon) server order with chronological siblings; 3-level sibling
    reveal order `[ta,tb,tc,td,tc2,tb2]`; multi-level ancestor row order
    `[a0,a1,a2]`.
  - `src/screens/HomeFeed.test.tsx` (+1): feed `feed-list` data stays
    `[p-new, p-old]` — thread chronology never leaks into the feed.
  - `packages/fedi/test/mastodon-backend.test.ts` (+1): `threadReplies`
    preserves context order across siblings (screen owns the sort).
  - `packages/fedi/test/misskey-backend.test.ts` (+1): `thread()` orders a
    3-note `notes/conversation` answer oldest-first + pins the
    `{noteId, limit: 30, offset: 0}` call shape.
- Checked the box in `docs/tasks/visual-polish.md` step 1. Left
  `state/STATE.md` alone (coordinator owns it).

Decided (→ ADR or DECISIONS entry if load-bearing):

- None load-bearing. Noted for the record: `docs/replies.md` §3.2 line 71
  ("preserve newest-first sibling ordering") is superseded by
  `docs/visual-polish.md` Deliverable 1 (oldest-first everywhere in
  threads); the v2 rebuild already made that reversal in Slice B, this
  slice only pins it. No ADR (plan-level deliverable, not a new decision).
- Depth-first pre-order (not global-newest-last) is the correct reading
  of "latest reply at the bottom": the latest reply of each visible
  chain sits at that chain's bottom; a global newest-last would detach
  children from parents. Matches Mastodon's own thread convention.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → clean, no output.
- `pnpm lint` (oxlint + eslint) → clean, no output.
- Touched suites: `Note.test.tsx` 37/37, `HomeFeed.test.tsx` 14/14,
  `misskey-backend` + `mastodon-backend` green — combined run:
  `Test Suites: 4 passed, 4 total / Tests: 151 passed, 151 total`.
- Full `pnpm test` → `Test Suites: 13 failed, 282 passed` (unique suites;
  jest lists each under two projects) / `Tests: 90 failed, 4072 passed,
  4162 total`. The 13 suites / 90 tests are ALL the pre-existing
  content/link/richtext/post reds (content-ast, content-html,
  content-link-disclosure, linkpreview, linkpreview-policy, LinkCard,
  PostCard-privacy, body, body-tags, quotes, profileFields, richtext,
  richtext-wsb) — identical set to the 2026-10-28 clean-tree baseline
  (13 suites / 90 failures). Delta is exactly my +7 new tests, all green
  (4155→4162 total, 4065→4072 passed, failures flat at 90). Confirmed via
  grep that none of the 13 failing files imports anything touched (they
  can't — touched files are test-only, never imported). Zero
  slice-attributable failures.
- Device/web runs → `not verified` (rig servers owner-run; no push).

Deviations (files touched outside the slice + why):

- None. Only the 4 test files above (all in-slice: thread ordering
  regression coverage) plus the task-tracker checkbox. No prod code
  touched — deliberate, see finding. Scratch repro file
  `src/screens/ThreadOrderRepro.test.tsx` created, run, and deleted.

Next:

- Slice 2 (`polish/2-shell`) can start from this branch or main per
  coordinator; this slice leaves no loose ends (no TODOs, no prod diff).
- Owner device check for thread order stays `not verified` until pasted
  (wide/narrow viewports, Misskey + Mastodon families).
- Bluesky reference paths consulted: none (no new pattern needed).
