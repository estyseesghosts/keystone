# ADR 0007 — Nullable `Notification.createdAt` (never fake dates)

Date: 2026-10-24
Status: accepted
Plan ref: `docs/audit_20261024/repair.md` R1.3

## Problem

Mastodon `adaptV2Notification` and `adaptV2Group` (`packages/fedi/src/mastodon/adapt.ts`)
fell back to `new Date().toISOString()` when the server omitted `created_at` /
`latest_page_notification_at`. Core `Notification.createdAt` was non-nullable
`string`, so the type forced the lie: a dateless row rendered as "now" and
sorted first. This violates the never-fake-data rule. `Account.createdAt`
(`packages/fedi/src/core/models.ts`) is already `string | null` — the
precedent this ADR extends.

## Options considered

1. Keep `string` and keep the fallback (status quo ante) — rejected: fabricates
   user-visible timestamps.
2. Widen to `string | null`, return null when the server omits the date,
   preserve server order, render dateless — chosen.
3. Drop dateless rows — rejected: a row the server sent must not vanish.

## Decision

`Notification.createdAt` is `string | null`. Missing server dates adapt to
null (never `new Date()`). No client-side date sorting exists for
notifications (server order is preserved in paging, live rows prepend); null
therefore sorts last by construction. `formatRelativeTime` already maps
null/"" to "" so rows render dateless with no restyling.

## Consequences

- Good: no fabricated "now" rows; grouped + flat v2 rows honest about absence.
- Bad / accepted risk: rows with null dates show no timestamp (empty caption,
  same as the announcements missing-date precedent).
- Follow-ups: Misskey adapters pass wire dates through unchanged (wire types
  require them); no fixture shape change needed.
