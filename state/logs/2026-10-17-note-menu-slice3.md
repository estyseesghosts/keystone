# 2026-10-17 — Note menu slice 3: endpoint verification

## Goal

Slice 3 from `docs/note-options.md` §9: probe `notes/mute`,
`notes/favorites/create`, and `users/report-abuse` against live backends,
record results in `docs/api-surface.md`, and enable what passes.

## Environment blocker

No local backend exists on this machine: no `/root/fedifedifedi` checkouts,
and nothing listening on `127.0.0.1:3101` or `:3102`. The authenticated
flows could not be run. No test account exists on any backend.

## What was done instead

Unauthenticated existence probes against two public instances (`POST
/api/<ep>` with `{}`, no `i`). A route that exists answers 401
`CREDENTIAL_REQUIRED`; a missing one answers 404. Nothing was written.

```
misskey.io 2025.4.1-io.12b   dvd.chat 2025.4.7 (Sharkey)
notes/mute                   404   404   (route not found)
notes/thread-muting/create   401   401   (exists)
notes/favorites/create       401   401   (exists)
users/report-abuse           401   401   (exists)
mute/create                  401   401   (exists; slice 2 route)
```

Token scopes checked in `frontend/src/api/backend.ts`: `write:favorites` and
`write:report-abuse` are not requested, so a session would get 403 even
where the route exists.

## Outcome

- No row flipped live. Enabling the favorites or report row needs both
  scopes added to the sign-in permission set, plus an authenticated run on a
  local backend.
- The plan's `notes/mute` is wrong. Thread mute is `notes/thread-muting/*`.
  Its authenticated flow is unverified, so the row stays disabled.
- Menu reasons were corrected to name the real blockers:
  - Mute thread: "thread mute not yet verified with a session"
  - Add to favorites: "needs the write:favorites token scope"
  - Report: "needs the write:report-abuse token scope"

## Evidence

```
$ npx tsc --noEmit -p tsconfig.json   exit 0
$ npm run build                        ✓ built in 1.41s
```

## Not yet verified

- Authenticated `notes/thread-muting/create|delete`, `notes/favorites/create`,
  and `users/report-abuse` round-trips.
- Slice 2 mute/block round-trips (carried over from the slice 2 log).

## Next step

Owner decision needed to finish slice 3, one of:
1. Start a local Misskey and Sharkey backend (`KEYSTONE_BACKEND_ONLY=1`,
   see `state/STATE.md`) and provide a test account, or
2. Approve adding `write:favorites` and `write:report-abuse` to the
   permission set (a sign-in-screen change, so it needs a yes).

Slice 4 (clips, favorites, search route, RSS) stays unstarted per the plan.
