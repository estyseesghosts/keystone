# 2026-10-30 — batch merge to main + prune — agent

Branch: `main` (only branch left)
Goal: owner-ordered merge of all program branches, single commit, prune.

Did:

- Verified preconditions: all 11 branches at `f4c3020`, no stashes,
  `dist/` gitignored, 95 changed/new paths all legitimate program work.
- Full suite re-run saved to `/tmp/fullsuite.log`: 303 suites / 4260
  tests, 4170 pass, 90 fail. Failing set is exactly the 13 known
  pre-existing suites (5 `packages/fedi` content/linkpreview +
  `body`, `body-tags`, `richtext`, `profileFields`, `richtext-wsb`,
  `PostCard-privacy`, `quotes`, `LinkCard`) — zero new failures.
  (First run kept only the tail; re-ran to capture the FAIL list.)
- `git checkout main` (dirty tree carried over, same base — no conflicts
  possible); merged all ten branches (each `Already up to date`,
  documented) — the work was the uncommitted tree, not the refs.
- `git add -A` + one commit `6f49197` ("Batch: P6.5 unread badge,
  visual polish 1-8, feed gap-fill fix"). Tree clean after.
- Pruned with `git branch -d` (all ancestors — safe): p6.5,
  polish/1–8 (incl. 7-feed-fill, 8-media-caps), fix/feed-gapfill-jump.
  Only `main` remains. No push (standing owner order: never `git push`).
- Bookkeeping: STATE.md pointer (merged phase, gate numbers, links);
  `docs/tasks/README.md` (P6.5 + fix + new visual-polish rows →
  done/merged); `docs/tasks/fix-feed-gapfill-jump.md` (status done,
  steps 6–7 closed as verified/owner-open).

Decided:

- One commit, not per-slice: the branches never carried commits (all at
  the same base), so per-slice history did not exist to preserve.
- Merged with owner repros still open (their standing choice — checks
  are device/rig-only and tracked in the task file).

Tests / verification (paste commands + results):

- `pnpm test` (full, pre-merge) → 303 suites (13 failed) / 4260 tests
  (90 failed): failing suites listed above, all pre-existing. `FULL_EXIT:0`
  (tail-pipe artifact; jest itself reported failure as expected).
- `pnpm typecheck` + `pnpm lint` → clean (both fix rounds; batch adds no
  new source).
- `git status --porcelain | wc -l` → 0 after commit; `git branch` → `* main`.

Deviations:

- None. Merge-local docs only (STATE/tasks/log); no source touched.

Next:

- Owner: Home deep-scroll + socket-kill and rec-feed hands-off repros on web.
- Owner: 25 device checks + 12 rig live-checks (unchanged standing items).
- Release track still out of scope (signing, App Links, app.config identity).
