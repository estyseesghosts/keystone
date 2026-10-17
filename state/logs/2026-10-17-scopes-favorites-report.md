# 2026-10-17 — Token scopes for favorites and report (slice 3 follow-up)

Supersedes the "Next step" of `2026-10-17-note-menu-slice3.md`, which asked
for an owner decision on these scopes. The owner approved it and will test
on a live external server, not on a local backend.

## Changed

- `frontend/src/api/backend.ts` — `KEYSTONE_PERMISSIONS` adds
  `write:favorites` and `write:report-abuse`. Existing sessions lack them and
  get 403 until the owner re-authenticates.
- `frontend/src/components/NoteMenu.tsx` — the Add to favorites and Report
  reasons now say "not yet verified on a live server", replacing the scope
  reasons.

## Left disabled, on purpose

- Add to favorites (`notes/favorites/create`) and Report
  (`users/report-abuse`) stay disabled. The owner's live test decides when
  they go live. Report sends a moderation report, so it should not be wired
  before a verified round-trip.
- Mute thread (`notes/thread-muting/*`) stays disabled, same reason.

## Evidence

```
$ npx tsc --noEmit -p tsconfig.json   exit 0
$ npm run build                        ✓ built in 1.36s
```

## Not yet verified

- Re-auth with the new scopes on a live server (owner).
- `notes/favorites/create`, `users/report-abuse`, `notes/thread-muting/*`
  round-trips (owner live test).

## Next step

Owner reports the live results. Then wire only the rows that pass.
