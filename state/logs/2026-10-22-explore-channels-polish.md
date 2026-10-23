# 2026-10-22 — Explore + Channels polish — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner batch (separators, avatars, news photos, channel tabs).

## Did

- `src/screens/Explore.tsx`:
  - `RowSeparator` (1px theme-border, v1 feed rule) wired as
    `ItemSeparatorComponent` into all four profile/tag/news lists
    (users, tags, news, account search).
  - `AccountRow` now leads with a 44px round avatar (`ExploreAvatar`:
    photo or initial fallback) left of the name/handle.
  - `NewsCard` is a row: photo left (`image`, 84 wide, stretches the
    row's full height, rounded) with all text right; no box at all when
    the link has no image.
- `src/screens/Channels.tsx`:
  - Row separators via `ItemSeparatorComponent`.
  - `My channels` / `Server channels` tabs (shared `Tabs`, default mine):
    mine pages `channels/followed`, server pages `channels/list`
    (directory). Mine empty state links into the server tab
    (`channels-browse-server`).
- Tests: `Explore.test` (avatar testIDs, sep counts, photo only when
  image present), `Channels.test` (mine default calls `followed`,
  server tab calls `list`, browse-server hop, sep count, retry now
  fails `followed`, server empty state via server tab).

## Tests / verification

- `pnpm run typecheck` (ios+android+web) → clean
- `pnpm run lint` → clean
- `pnpm test` → **189 suites / 2391 tests green** (+3)
- Device/web runs → `not verified` (owner visual pass pending)

## Next

- Owner visual pass (news photo full-height behavior wants eyes on a
  real multi-line description; rail/tablet widths)
