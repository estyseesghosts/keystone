# 2026-10-16 — Streaming Stage A + push + pinetree enablement check

Goal (owner tasking, three items in order): (1) push the 7 unpushed roadmap
commits, (2) build the streaming client Stage A against Misskey/Sharkey,
(3) flip on pinetree-mode capabilities as its Phase 3 lands them. Human
browser QA is owner-handled — every browser-rendered behavior below stays
**not yet verified**.

## 1. Push: nothing to push

After `git fetch`, `git rev-list --count origin/main..HEAD` = 0 and
`HEAD..origin/main` = 0 — the 7 roadmap commits were already on
origin/main (STATE.md pointer was stale). Corrected STATE.md. No push
needed; the 2 new streaming commits below stay local until the suites are
all green (features suite is 429-blocked, see §5).

## 2. Rig fix (no commit): backends lost their backend-only flag

`smoke_flows.py` rerun showed 40/44: `GET / -> 200` on `:3101`/`:3102`
(expected 404 UI-off). Root cause: both backend processes were running
**without** `KEYSTONE_BACKEND_ONLY=1` (verified via `/proc/<pid>/environ`;
pids 485843/485862, process name `Misskey (master`). Killed and relaunched
per `docs/setup.md` §3 (misskey with Node v24 first on PATH). After:
`/` → 404, `/api/meta` → 200 on both. Flows suite back to 44/44, writes
14/14.

## 3. Streaming Stage A (committed locally, 2 commits)

`a-stream-client` — `frontend/src/api/stream.ts` (new, ~440 lines, native
WebSocket, zero new deps) + wiring into `TimelineFeed`, `Notifications`,
`Note` detail, `StreamBadge`, `.streamstate` style, streaming contract
section in `docs/api-surface.md`.
`b-stream-suite` — `scripts/smoke_streaming.py` (stdlib-only WS client,
through the Vite WS proxies) + Slice 7 in `docs/frontend-plan.md`.

Client coverage (all verified live first via `/tmp/opencode/stream-probe.js`
12/13, then the checked-in suite 27/27): anonymous + authed connect,
subscribe/unsubscribe for main/homeTimeline/localTimeline/hybridTimeline/
globalTimeline/antenna, subNote/unsubNote + noteUpdated
(reacted/pollVoted/deleted), main-channel `notification` events, reconnect
with capped backoff, stale/error states (10s ack timeout → `unavailable`;
5 quick closes → terminal `error` + retry).

Server facts verified in source (both backends identical): WS handshake
requires `read:account` on app tokens (else HTTP 401 —
`StreamingApiServerService.ts`); per-channel kind matrix in
`channels/*.ts`; unservable channels silently ignored (no ack, socket
open); unknown channel names log an unhandled rejection server-side but
leave the connection alive (proven 3/3 direct + proxied); server pings
every 60s and reaps conns idle >2min. Pinetree has NO `/streaming` route
(`src/streaming/*` are empty stubs, `NoopStreamingSink`); the client never
opens a socket in pinetree mode. (This corrects the old api-surface row
that said "streaming exists" for Pinetree.)

UI rules kept: paging + refresh work with no socket; streamed notes
prepend with an in-updater id check (race-proof dedupe); reactions/polls
re-read from the API; notifications only raise a "N new — Refresh" count
(no unread model); sign-out token change recaptures (fixed in review:
feed captures now reset on token change like note detail).

Evidence: `npx tsc --noEmit` clean, `npm run build` green
(`index-C5O4JRuA.js 149.36 kB`), `smoke_streaming.py` 27 passed 0 failed
(full output in commit message scope), static greps clean (no innerHTML,
no React, window.location is URL parsing only).

## 4. Pinetree enablement check: nothing to flip

Probed live `:3000` (authed as ks1): `users/notes`, `notes/replies`,
`users/followers|following`, `drive/files`, `antennas/*`, `notes/search*`,
`/streaming` all → 404 `UNKNOWN_API_ENDPOINT`. Pinetree HEAD source has
handlers, but the running binary (Oct 15 15:30) predates them and the
implementer's Phase-3 work is uncommitted/in-flight (21 files, +2912);
their manifest declares only `notes/global-timeline` newly frozen — which
Keystone already serves in pinetree mode (verified 200 + proper Note[]
through `:5173`). No UI flips; api-surface pinetree column unchanged
(still honest). Rebuilding their binary is the pinetree implementer's
work, not this session's.

## 5. Open / not yet verified

- `smoke_features.py` was 42/44 on two Sharkey `signin-flow` **429s**
  (bucket: size 10, 1/min drip — this session's many suite/probe logins
  from one IP drained it), not product. Re-ran after refill: **47/47**,
  then pushed both commits (`bf91cf4`, `c5933d4`; 0 ahead of origin/main).
- Two unexplained single-socket drops seen once each during probing
  ("peer closed", "close frame"); never reproduced in isolation (3/3
  survive) and the suite is strict (no retry masking). Watch item only —
  the client's reconnect path exists precisely for these.
- Browser QA (visuals, focus, playback, console errors, actual live-badge
  behavior): not yet verified, owner-handled.

Next: rerun `scripts/smoke_features.py` → all green → `git push` →
update STATE.md.
