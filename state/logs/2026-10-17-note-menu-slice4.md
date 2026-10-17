# 2026-10-17 — Note menu: slice 3 wiring and slice 4

## Goal

Owner decision: no local Misskey testing on this machine. The owner verifies
on a live Misskey after push. So the slice 3 rows are wired now, and slice 4
is completed before pushing.

## Slice 3 rows wired (unverified live)

- **Add to favorites**: `notes/favorites/create {noteId}`. Label stays "Add
  to favorites"; no state read-back, so the server's own conflict message
  surfaces if the note is already a favorite.
- **Mute thread**: `notes/thread-muting/create {noteId}`. Calls `onChanged`.
  No unmute, because there is no state read-back.
- **Report**: `users/report-abuse {userId, comment}`. Confirm step with a
  required reason (max 1000); the Report button is disabled until the reason
  has text. Hidden on own posts and signed-out viewers.
- All three disabled "Unavailable on Pinetree" on Pinetree, because their
  Pinetree behavior is unverified. Hidden when signed out.
- Fix: confirm questions are now functions. The Block question was built at
  setup, so it kept naming the old author after a feed swapped the note.

## Slice 4

- **Favorites page** `/favorites` (`routes/Favorites.tsx`, `api/favorites.ts`):
  `i/favorites` with `untilId` paging (20 per page), "Remove from favorites"
  via `notes/favorites/delete`, nav entry for signed-in users. Rows reuse
  `NoteCard`.
- **Clips** (`api/clips.ts`): the Clip row expands inline. It lists clips
  with `clips/list {limit: 100}` each time it opens, and adds the note with
  `clips/add-note {clipId, noteId}`. Empty, loading, and failed states are
  disabled rows with reasons.
- **Copy RSS**: `https://<host>/@<username>.rss` for remote authors. Local
  authors only when `VITE_KEYSTONE_API_URL` is an http(s) origin; otherwise
  the row is disabled with the reason. The `.rss` path is the Misskey
  convention; not checked against a live server.
- **Search route**: `/search` already exists (slice 6). The per-user note
  search row stays disabled, because `notes/search` returns `UNAVAILABLE` on
  these servers.
- Token scopes added: `read:favorites`, `read:clips`, `write:clips` (plus
  `write:favorites`, `write:report-abuse` from earlier). Existing sessions
  get 403 until re-auth.

## Evidence

```
$ npx tsc --noEmit -p tsconfig.json   exit 0
$ npm run build
dist/assets/index-Dliihvki.js     359.22 kB │ gzip: 103.34 kB
✓ built in 1.43s
```

## Not yet verified

Everything in this entry is unverified against a live server, to be tested by
the owner on a live Misskey after push:
- `notes/favorites/create`, `notes/favorites/delete`, `i/favorites` paging
- `notes/thread-muting/create`
- `users/report-abuse` (sends a real report: test against an account you
  control)
- `clips/list`, `clips/add-note`
- The `/@user.rss` route on Misskey
- Re-auth: the new scopes (`write:favorites`, `write:report-abuse`,
  `read:favorites`, `read:clips`, `write:clips`) are granted
- Browser behavior: favorites page, clip list, RSS copy, report confirm

## Open

- Favorites and thread mute have no unfavorite or unmute, because no state
  read-back exists. Add once the live response fields are known.
- Pinetree is not wired for these rows.
