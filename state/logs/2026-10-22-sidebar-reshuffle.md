# 2026-10-22 — Sidebar reshuffle (pre-Wave-3 quick change) — agent

Branch: `p6.4-sidebar-reshuffle`
Goal: reshape the desktop sidebar per `docs/sidebar.jpg` (grouped sections,
platform labels, footer quick actions, culled account menu, unified collections).

## Did

- `src/Navigation.tsx`:
  - Replaced `StackEntryKey`/`stackEntries`/`stackEntryLabel` with
    `CollectionTarget` (`Channels|Clips|Antennas|Lists|Favorites`) +
    `collectionEntries` (misskey: Channels-cap-gated, Clips-cap-gated,
    Antennas-family-gated; mastodon: Favorites-always + Lists-cap-gated) +
    `collectionEntryLabel` (Favorites → `Bookmarks`) + `messageTarget`
    (Conversations vs ChatRooms, null hides) + `pagesStubReason`.
  - Sidebar: three padding-spaced groups (feeds / channels+Pages /
    collections), no divider lines (removed `navuser` top border).
    Notifications + Profile removed from the main list (Notifications →
    footer button; Profile → footer identity popup row).
  - Footer identity shows displayName + `@handle@host`; quick actions:
    Settings / Messages / [My Uploads misskey-only] / Notifications —
    1×3 row mastodon, 2×2 grid misskey, icon column on rail. Post button kept.
  - AccountMenu culled to sessions, Add account, Profile, Announcements;
    Messages/stacks/Settings rows deleted (shared with mobile strip).
- `src/components/icons.tsx`: new `PageIcon` (document) for the Pages stub.
- Pages: misskey-only disabled stub row (`sidebar-pages`, reason "Pages ship
  in a later slice"), never an inert tap. No backend/screen (in scope later).
- Screens: Clips→Favourites link, Antennas→Lists link (misskey only);
  Favorites↔Clips and Lists↔Antennas back-links; Favorites title per
  platform (mastodon `Bookmarks`, misskey `Favourites`) via shell
  `navigationRef` (hook-free, safe outside a container).
- Tests: rewrote `shell-chrome.test.tsx` reshuffle block (11 tests: groups,
  footer grid, presses to Settings/Drive/Conversations/ChatRooms/
  Announcements, signed-out nulls, menu cull); `Favorites.test.tsx` copy
  → `Favourites…` (misskey backend). Added Conversations/ChatRooms/
  Announcements screen mocks for deterministic presses.

## Decided

- Mastodon shows no Channels/Communities group (no backend — group hides
  rather than going inert). No Mastodon Pages (Misskey concept).
- Announcements: menu + deep-link only, no sidebar row (not in sketch;
  not in the cull list so it stays reachable).
- Mobile: untouched except via the shared AccountMenu cull; mobile entry
  points return in the planned mobile overhaul (→ DECISIONS line).

## Tests / verification

- `pnpm run typecheck` (ios+android+web) → clean
- `pnpm run lint` (oxlint + eslint) → clean
- `pnpm test` → **187 suites / 2368 tests green**
- Device/web runs → `not verified` (owner visual pass pending — step 8)

## Deviations

- `docs/sidebar.jpg` is untracked (owner drop); left untracked, not committed.
- `en` catalog not re-extracted (convention: end-of-program i18n sweep;
  new strings fall back to source text).
- Footer `navuser` divider border removed per "no lines, padding only".

## Next

- Owner desktop-large visual pass (acceptance step 8)
- Merge to `main` after visual sign-off
- Wave 3.3 user moderation (per STATE.md)
