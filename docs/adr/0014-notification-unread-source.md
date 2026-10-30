# ADR 0014 — Notification unread count is server-authoritative

Date: 2026-10-28
Status: accepted
Plan ref: `~/.opencode/plan/p6.5-unread-counter.md` (task `docs/tasks/p6.5-unread-counter.md`)

## Problem

The bell badge counted unread rows out of the already-fetched notification
cache. That count was empty at launch (nothing fetched yet), capped at the
newest page size, and permanently zero on Misskey/Sharkey, where rows carry
no read state (`isRead` exists only on Pinetree). The badge was effectively
dead on the Misskey family.

## Options considered

1. **Cache-only (W4 N18, status quo).** No new requests; stays empty at
   boot and dead on Misskey. Rejected: it is the defect.
2. **Poll the notifications list.** Correct but heavy (a full page per
   poll) and still read-less on Misskey. Rejected.
3. **Server count with presence-dot fallback (chosen).** Mastodon 4.3+
   answers `GET /api/v1/notifications/unread_count`; Misskey/Sharkey/
   Pinetree pack `unreadNotificationsCount` (+ `hasUnreadNotification`)
   into `i`. Servers that cannot count (older Mastodon, Akkoma/Pleroma)
   get an honest presence dot, never a fabricated number.

## Decision

`Backend.notificationsUnreadCount()` is the single source of truth behind
one `notifications-count` query per session; chrome derives from
`useUnreadBadge` only — never a second counter. This deliberately reverses
W4 N18 ("cache-derived only").

## Consequences

- Good: real numbers at launch (placeholder-seeded from warm `me`) and
  live (shell-level stream mount + `+1` on arrival) on both families.
- Good: no model widening — the Misskey value rides the existing `ext.me`
  bag, so `MODEL_SHAPE_HASH` and `SCHEMA_VERSION` are untouched.
- Bad / accepted risk: Mastodon caps the count at its `limit` (default
  100); the UI caps display at `99+` and never promises exactness above
  that. Grouped counting can differ from visible rows; that is expected
  on both families, not a bug.
- Bad / accepted risk: dot-only servers show a dot only after a presence
  signal exists (warm `me` flag or an opened list); no signal, no dot.
- Follow-ups: none — push/OS badge stays Wave 4, out of scope.
