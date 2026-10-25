# P — Notification requests and policy (repair X4.5)

Plan ref: `docs/audit_20261025/repair.md` §X4.5 (Wave 4, Mastodon correctness).
Audit ref: `docs/audit_20261025/results/mastodon.md` finding 12
(policy/requests paragraph). Owner decision D8 = YES (build it).

Status: done (working tree; `not verified (coordinator runs the batch-green check)`)
Branch: main (shared tree per coordinator; no branch, no commit — working tree only)

## Goal

Mastodon 4.3+ files non-follower notifications under "requests"; without
support they are invisible. Make them reachable: backend paths, a
probe-backed `notification_requests` capability, and a Filtered-notifications
surface on the Notifications screen.

## Read first

- `docs/audit_20261025/results/mastodon.md` finding 12
- `packages/fedi/src/mastodon/endpoints.ts` (notifications section,
  `isAbsent`, paging helpers)
- `packages/fedi/src/mastodon/backend.ts` (`notifications()`,
  `dismissNotification`, capabilities wiring)
- `packages/fedi/src/core/backend.ts` (Backend interface, `PageOpts`)
- `packages/fedi/src/core/detect.ts` (`FEATURE_KEYS`, probe-only precedent)
- `packages/fedi/src/misskey/like.ts` (per-origin probe-cache pattern)
- `src/screens/Notifications.tsx` (X4.1 owns the dismiss regions — keep clear)

## Steps

- [x] 1. This task file.
- [x] 2. Backend (`packages/fedi` only, pure TS):
  `GET /api/v1/notifications/requests` (Link-paged),
  `POST .../requests/:id/accept`, `POST .../requests/:id/dismiss`,
  `GET /api/v2/notifications/policy`, `PATCH /api/v2/notifications/policy`
  (only defined fields sent); capability `notification_requests` is
  probe-backed, never flavor-guessed (unknown until a real 2xx/404 verdict
  caches per origin, `like.ts` pattern).
- [x] 3. UI (`src/screens/Notifications.tsx` ONLY — Filtered entry + list +
  actions + policy section; X4.1 owns dismiss regions, keep clear): a
  "Filtered notifications" entry with a pending-count badge, a requests
  list with accept/dismiss actions, and a small policy settings section.
  All strings via Lingui `msg`/`plural` ONLY.
- [x] 4. Tests with fixtures (fail before / pass after by construction;
  not run in-slice per program hard rules) + live checks for X12.1 (in log).

## Support / visibility contract

- Supported server: filtered items live in the requests inbox (main list
  excludes them server-side); the entry shows with the pending-count badge.
- Unsupported server (probe 404/405) or Misskey family (no member): the
  entry hides WITH a reason (never an inert control) — and every filtered
  item remains visible in the MAIN list, so notifications never silently
  vanish.

## Acceptance

- [ ] `not verified (coordinator runs the batch-green check)` — tree is
  shared; no gates run in-slice. Full diff re-read by eye instead.
- [ ] Probe, never flavor-guess: no flavor table seeds `notification_requests`.
- [ ] Unsupported → entry hides with a reason; main list still shows everything.
- [ ] Ported-test counts do not drop (new suites only, no deletions).

## Out of scope

- Dismiss/search/polls/markers/adapt models, streams, oauth, queries
  (other slices own them). `misskey/backend.ts` untouched.
- `docs/mastoapi-contract.md` / `docs/api-surface.md` sync (X11.3 owns docs).
- Non-English catalogs (English `msg` source only).

## Log

- `state/logs/2026-10-25-repair25-x4.5.md`
