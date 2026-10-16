# 2026-10-16 — Drive categories + infinite scroll + client skeletons

**Goal:** Drive landing shows three category boxes (Images/Videos/Audios)
with loose files below; no more "Load older" in Drive; skeleton loading
everywhere data loads.

## What changed

- `frontend/src/components/Skeleton.tsx` (new): static grey placeholder
  blocks shaped like the content they replace — `NoteSkeletonList`,
  `ProfileSkeleton`, `NotificationSkeletonList`, `RowSkeletonList`,
  `MosaicSkeleton`, `AudioSkeletonList`, `DriveBoxesSkeleton`. No
  animation (product guard); each group is `role="status"` with an
  sr-only label (new `.sr-only`, `.skel` CSS).
- `DriveBrowser`: `view` state (`main`/`images`/`videos`/`audios`).
  Landing shows the three boxes + loose "Files" below; a box switches to
  that category (server-side `type` filter per view) with a "← Back to
  Drive" button. Paging is an IntersectionObserver sentinel (400px
  root margin) — short first pages keep filling until the view scrolls
  or the server exhausts. Skeletons for initial + more loads per view.
  Uploads, refresh, permission/upload-only states, select mode unchanged.
- Skeleton swaps (initial loads; plus appended skeletons while
  paginating): TimelineFeed (+AntennaFeed content via it), Note
  (+replies), Profile header/notes/FollowList, Notifications,
  Antennas list, AntennaFeed header, Search busy per tab.
  `LoadingState` remains only for instant `authReady()` shell fallbacks
  (Login/Settings/Home/Drive/Antennas/Notifications gates).
- Timelines, notifications, profile notes, and replies keep their manual
  "Load older" buttons — only Drive went infinite-scroll this slice.

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green.
- **Not yet verified:** browser pass (owner rig) — category switching,
  sentinel auto-paging (incl. no-spin on error/exhausted), skeleton
  shapes at desktop + mobile widths, composer attach from category views.
