# 2026-10-21 — pf-navigate (E7 follow-up) — coordinator

Branch: `main` (direct; completes the E7 nav gap)
Goal: make the Drive page reachable — it was registered but had no entry point.

## Did

- Read v1 `Layout.tsx:239` (`/drive` sitenav entry, misskey-family gated) as the
  parity source. v2 `Sidebar`/`AccountMenu` had no trace of it.
- `src/components/icons.tsx`: added `ListIcon`, `ClipIcon`, `DriveIcon`,
  `AntennaIcon` (butterfly stroke set, own paths).
- `src/Navigation.tsx`: `stackEntries(session, backend)` gated exactly like v1
  (Lists/Clips need `capabilities === 'supported'` + backend member;
  Drive/Antennas need `family === 'misskey'`; Favorites needs a session),
  rendered in the Sidebar (desktop/rail) and the AccountMenu (desktop footer
  + mobile strip avatar menu — the mobile entry point). Mobile tab bar
  untouched (5 tabs already). Backend resolved via pure `backendForSession`
  (no new provider dependency, no cycle: HomeFeed never imports Navigation).
- `src/__tests__/shell-chrome.test.tsx`: DriveScreen mock, `family` param on
  `renderShell`, 4 new tests (mastodon hides, misskey shows + lands,
  menu carries on mobile, mastodon menu hides).
- Corrected the E7 record in `docs/V2_FUNCTIONAL.md`: `pf-drive` delivered the
  folders backend + rename wiring only — no live round-trip happened
  (no Misskey-family host up); the "round-trip" commit message overclaimed.
  E7 stays OPEN pending a live Misskey-family pass.

## Decided

- Gate on family/capability (never render), never a disabled placeholder row —
  product rule is no inert controls. Screens keep their honest fallbacks.

## Tests / verification

- `tsc` ios+android+web: clean.
- `oxlint --quiet src` + `eslint` on touched files: clean.
- `jest src/__tests__/shell-chrome.test.tsx`: 17/17 green (4 new).
- Full `jest --ci`: see commit (tailed; must be 146+ suites green).
- Helium web-visual vs expo `:8100`, Akkoma `:4000`, akk1 (screenshots in
  `state/logs/assets-pf-navigate/`):
  - signed-out sidebar: Home/Network/Explore only (no stack entries);
  - signed-in (akkoma/mastodon): sidebar shows Lists + Favorites, NO Drive
    (family gate working live);
  - `/drive` deep link: Drive page with honest "not available on this server".
- Misskey-family entry rendering is unit-pinned only (`:3101`/`:3102` down,
  Pinetree unauth; no fake session seeded to pose as proof).

## Deviations

- Touched `Sidebar`/`AccountMenu`/`icons` — outside the original pf-drive scope,
  because the drive agent never made the page reachable. Justified under E7
  ("audit the full surface").
- Also exposed Lists/Clips/Antennas/Favorites — same one-line pattern, same
  missing-parity bug, v1-gated identically.

## Next

- E7 live round-trip the moment `:3101`/`:3102` are up (browse + upload +
  rename/sensitivity/delete), then tick E7.
- pf-bio (E4/E6) + pf-detail (E8/E10) still running in worktrees; merge
  serially on completion.
