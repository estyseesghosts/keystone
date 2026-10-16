# 2026-10-16 — Account footer with name/handle (then commit)

## Goal

Owner override of the previous turn: the expanded sidebar footer shows
avatar + name + handle again (competitor-style); rail and mobile strip
stay avatar-only.

## What changed

- `frontend/src/components/AccountCard.tsx`: footer button renders the
  `accountcard-text` block (plain `displayNameOf`, no emoji deps) with
  full card chrome again; header comment updated.
- `frontend/src/styles/global.css`: text rules restored; name/handle
  hidden in the rail band and in `.mobile-account` (avatar-only there).

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (see push output below for the final hashes).

## Note for the commit

Committed together with the whole stack per owner "commit and push":
settings pages, appearance, global text scaling, adaptive layout,
no-hscroll + rail sidebar + this footer, plus the earlier profile-tabs
slice it depends on. Parallel emoji-slice files in the tree are NOT
staged (separate workstream, left uncommitted).

## Next step

Owner visual pass (footer card in expanded, avatar-only in rail and
mobile strip), then this is landed.
