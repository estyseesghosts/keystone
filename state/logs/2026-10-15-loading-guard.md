# 2026-10-15 — Timeline never loads (loading-guard bug)

**Goal:** diagnose "no timeline logged out or as alice; post gave no feedback".

## Diagnosis

Servers were fine (backend + vite both up; local-timeline API returns notes).
Bug was in `frontend/src/components/TimelineFeed.tsx`: `loading` starts `true`
and `load()` began with `if (loading() || loadingMore()) return` — the initial
`onMount` fetch early-returned every time. Feed stuck on "Loading…" forever;
posted notes prepended into a list that never rendered, so posting looked
like it did nothing. (They did send — verified `bambam` from alice in
`notes/local-timeline`; the empty-text note beside it is the earlier
verification script's renote, not a UI phantom.)

## Fix

Replaced the self-blocking guard with a dedicated `busy` signal (starts
`false`, set alongside `loading`/`loadingMore`, cleared in `finally`).
`tsc` clean; no other instance of the pattern in `src/` (`Login`'s guard is
correct). Dev HMR applies it — user hard-refreshes to confirm.

## Evidence

- `grep "if (loading()" src/` → only the fixed site (now `busy()`).
- `npx tsc --noEmit` → clean.
- `curl` local-timeline shows user's post persisted server-side.

## Next

User confirms timelines render + post appears; then continue `keystone.md` §12
browser pass (auth restore across reload, paging, react, profile, notifications,
mobile widths, console errors).
