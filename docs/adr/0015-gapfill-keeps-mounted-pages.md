# ADR 0015 — Gap-fill never rewrites a mounted feed's pages

Date: 2026-10-29
Status: accepted
Plan ref: task `docs/tasks/fix-feed-gapfill-jump.md`

## Problem

A live-socket reconnect ran `gapFillSessionFirstPages`, which trimmed
*every* `post-feed` query of the session to page 1 — including the list
the user was scrolled inside — then invalidated. The mounted list's data
collapsed mid-scroll: the scroll offset clamped to the shortened content,
rows remounted (every image cross-fading from its blurhash placeholder),
and the pager fast-forwarded pages back underneath. On web (no
`maintainVisibleContentPosition` in RNW 0.21.4) there is no anchoring to
absorb it, so it reads as a soft-reload + gradient fade + jump to the
wrong position. The trigger widened when the notification stream mount
went global (`NotificationsBadgeHost`, shell-level), so a blip on any
screen now gap-fills the Home feed.

The trigger itself was also half-wired (audit 2026-10-26 M2): only the
`reconnecting -> connected` shape filled, so Misskey error-path redials
and Mastodon dead-handle retries lost their outage windows until the
30 s stale refetch happened to run.

## Options considered

1. **Keep trim-everything (status quo).** One-request refetch, but it is
   the jump. Rejected: it is the defect.
2. **Don't touch active queries at all (no invalidate either).** No
   jump, but outage windows on the visible feed never fill until stale
   refetch. Rejected: drops the M7 guarantee for the most visible list.
3. **Invalidate active queries, trim only inactive ones (chosen).** An
   active infinite-query invalidate refetches all cached pages and
   commits once, so the list updates in place with no collapse; an
   inactive query keeps the one-request trim-then-refetch shape and
   refetches its single page on next mount. Costs N requests on a
   reconnect instead of 1 — accepted, reconnects are infrequent.
4. **Anchor-based scroll restore instead.** Worth doing (web has no
   platform anchoring) but it treats the symptom; the trim must still
   go. Follow-up, not this slice.

## Decision

- `gapFillSessionFirstPages` reads the cache's active set once
  (`findAll({type: 'active'})`, fail-open toward keep-pages) and never
  rewrites a mounted query's `pages`/`pageParams`; it still invalidates
  everything, so gaps fill via refetch either way. Tests inject the
  activeness predicate (`GapFillOpts.isActiveKey`).
- `watchStreamGapFill` tracks a was-away flag (any observed
  `connected -> non-connected` transition) instead of matching one
  predecessor, so error/stopped reconnect paths fill too. A fresh
  mount never fills (flag starts false — the mount fetch owns the
  head, no boot-time double fetch).

## Consequences

- Good: a reconnect while scrolled can no longer collapse the visible
  feed; the outage window still fills (active refetch-all, inactive
  trim + mount refetch).
- Bad / accepted risk: reconnect refetch costs N page requests on the
  active feed instead of 1. No debounce yet — a flapping socket queues
  one fill per reconnect cycle.
- Follow-ups (not this slice): anchor-based scroll restore for web,
  `meta.original` dimensions for Mastodon media (layout-shift
  amplifier), gap-fill debounce.

## Amendment 2026-10-29 — ranked feeds never background-refetch

- Problem: the recommendations feed blinked and repositioned with no user
  input. Sharkey's `notes/recommendations` re-scores every request, so the
  gap-fill invalidate (kept for active queries by the decision above) is a
  reroll there, not a refresh — rows remount and the pixel offset lands on
  different posts. Same for the foreground refetch on tab return. There is
  no live channel to stay in sync with, so skipping loses nothing.
- Change: `isRecommendationsFeedKey` (`#/state/queries/keys`) matches
  `post-feed` keys with descriptor `recommendations` (with/without the
  `|rec-params` suffix). `gapFillSessionFirstPages` skips those keys
  entirely (no trim, no invalidate — the prefix invalidate carries a
  predicate); `isForegroundRefetchKey` returns false for them.
- Consequence: the ranked feed only rerolls on explicit user action
  (fresh mount, pull-to-refresh, tab re-press). Timelines are untouched.
