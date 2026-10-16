# 2026-10-16 — Drive groups (mosaic + miniplayers)

**Goal:** Drive auto-groups files into Images / Videos / Audio / Files;
image/video sections are tile mosaics, audio rows are miniplayers with
metadata.

## What changed (`frontend/src/components/DriveBrowser.tsx`, `global.css`)

- Dropped the server-side type-filter dropdown; every `drive/files` page is
  grouped client-side by top-level mime into Images / Videos / Audio /
  Files sections with counts. Uploads, refresh, paging, permission and
  upload-only (Pinetree) states unchanged.
- Images: mosaic tiles (square `object-fit: cover` thumbs). Click opens the
  full file (or toggles Attach in composer select mode, with ✓ ring).
- Videos: mosaic tiles with ▶ overlay + packed-duration badge when the
  server provides one. Click swaps in an inline `<video controls autoplay>`
  with a Close preview button (select mode still toggles Attach).
- Audio: miniplayer rows — native `<audio controls preload="metadata">`,
  title from packed `properties.title` (fallback filename), artist/album
  byline when packed, comment, size, duration from the element's own
  `loadedmetadata` (nothing fabricated; shown only when known).
- Files: previous list rows unchanged. All tiles/rows keep Attach (select
  mode), sensitive toggle, and two-step delete.

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green.
- **Not yet verified:** visual mosaic/miniplayer behavior in a real browser
  (owner rig) — no browser here. Worth checking: mixed-type pages, paging
  across sections, composer attach flow from tiles, mobile widths.
