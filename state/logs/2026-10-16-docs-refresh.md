# 2026-10-16 — Docs refresh (README + router + plan)

## Goal

README and supporting docs lagged the tree (theme toggle, settings
pages, new routes, profile tabs, streaming, external auth all
unmentioned; router.md still claimed "no other routes in v1").

## What changed

- `README.md`: intro (external-instance mode, colour mode + text
  size), rewritten "What you get" (timelines + Stage A streaming,
  note/thread view, profile tabs + follow pages, composer + drafts,
  reactions/reposts/polls/follows, Drive groups, antennas, search,
  dual auth + account switching, settings pages, responsive sidebar),
  extended not-yet list (fields[], list-antennas, Stage B, Featured
  pinned source).
- `docs/router.md`: full route table (followers/following, drive,
  antennas, search, settings ×3) with data sources; layout note
  updated past light-mode-only.
- `docs/frontend-plan.md`: Slice 1 route list completed.
- No code changes.

## Evidence

- Docs-only: `git diff --stat` shows `.md` files only.
- Live route table cross-checked against `frontend/src/App.tsx`
  (all 17 routes present on both sides).

## Next step

Commit + push with the stack.
