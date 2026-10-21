# 2026-10-21 — WS-G Scroll memory + S4 streaming UI — subagent

Branch: `pG-streaming` (base `main@8e16108`, merged WS-A/B/C/D/E/F)
Goal: WS-G per `docs/V2_GAPS.md` §WS-G: scroll memory (N14) + S4
streaming UI mount (live feed insert, live-fed pill, delete/update
capture, notification channel, stream status badge).

## Did

- **Scroll memory (N14).** No new entry cache: the persisted
  react-query cache (24h MMKV persist, 30min in-feed GC, keys
  `[sessionId,'post-feed',descriptor]`) already serves notes/cursor/
  exhausted per session+descriptor — including across restarts, which
  is strictly beyond v1's in-memory `feedCache`. Duplicating entries
  into `feedMemory.ts` would be redundant state, so `feedMemory.ts`
  is untouched (offsets + last tab stay its whole job). Wired the
  save/restore half in shared `FeedView` (`src/screens/HomeFeed.tsx`):
  offset mirror saved on every scroll AND on unmount (covers
  descriptor switches — cleanup runs with the outgoing key), restore
  once per mount with a reset-to-top when the new key has no saved
  offset (a descriptor switch otherwise keeps the old feed's scroll
  position). `goBackOrFeed` untouched.
- **S4 streaming UI mount.**
  - `feedSourceForDescriptor()` (`src/state/streaming.ts`): timelines/
    lists/antennas/tags → `FeedSource`; clips/user/search/explore/
    bookmarks/mentions/channels → null (v1 `hasChannel` parity — paging
    only, never faked). Unparsable → null.
  - `useFeedLive()` (same file): `streaming`-capability gate
    (`=== 'supported'` only — unknown never unlocks live), handle read
    once per backend identity inside the effect, disabled channels
    stand down silently (no stuck "connecting" badge), per-session keys
    (account switch disposes). `onInsert` prepends into the feed query
    (dedupe vs cache + batch), deleted-while-buffered ids are filtered
    at flush; `onDelete` removes cache-wide + arms the flush filter;
    `onUpdate` reconciles via `backend.post()` (v1 `refreshNote`
    parity, failure keeps the row). Capture sync watches newest 50
    (v1 `CAPTURE_LIMIT` parity); `watch()` also seeds the dedupe set
    so a streamed race with a cached row drops at arrival, not flush.
    React discipline: subscription in effects only, `watchIds` flow
    through a join key, mutable sets in refs, exhaustive deps
    (eslint-clean).
  - `FeedView`: pill count is live-fed when mounted (replaces
    local-diff), local-diff stays the fallback for paging-only feeds;
    pill tap flushes into the cache + scrolls to top. `StreamStatusBadge`
    (`src/components/StreamBadge.tsx`, new) renders in-flow when live:
    Live / Connecting… / Reconnecting… / error + Retry (resubscribe).
    Unavailable → null. Connection state only, never a number — the W4
    unread badge is untouched (no double counters). The pill msgid
    keeps the `{newCount}` placeholder (no catalog churn).
  - `useLiveNotifications()` mounted in `NotificationsScreen`: arrivals
    prepend (dedupe) into the session's `all` listings (both grouping
    modes) so the badge + list update without reload; every other
    filter view is invalidated, never guessed (server is the filter
    authority; filter type strings differ per family). Same capability
    gate.
  - Mastodon adapter seam: NO adapter change needed. `subscribePost`
    is implemented on the shared `user` stream (the old "no-op" comment
    predates MD10) — proven by new transport tests both families route
    watched-id deletes/updates. Feed-level deletes are intentionally
    unsubscribed on both families (no `onDelete` in the `StreamHandle`
    interface — an unwatched id has no cached row to remove); the stale
    S4-seam comment in `streaming.ts` is corrected to say so.
  - `badges.ts` untouched (no `span.mchip`/badge overlap, per spec).
  - `Navigation.tsx` untouched (`goBackOrFeed` + `feedMemory`
    re-exports intact); no shell-chrome change was needed.

## Decided (proposals for `docs/DECISIONS.md` — coordinator owns the file)

- 2026-10-21 WS-G: no feed-entry cache in `feedMemory.ts` — the
  persisted react-query cache (24h MMKV, session+descriptor keys)
  already serves entries; `feedMemory` stays offsets + last tab.
  Propose N14 → `partial` with wording below.
- 2026-10-21 WS-G: live mount requires
  `capabilities.streaming === 'supported'` AND a non-null handle AND
  a non-disabled channel; anything else is paging-only with the
  local-diff pill (never a stuck badge, never faked inserts).
- 2026-10-21 WS-G: live notifications prepend into `all` listings
  only; filtered views invalidate and refetch (server is the filter
  authority; never guess cross-family type strings).
- 2026-10-21 WS-G: Mastodon `subscribePost` is NOT a no-op (shared
  `user` stream, id-filtered) — the MD10 remainder comment was stale;
  feed-level delete frames stay unsubscribed by interface design.

## Tests / verification (exact commands + results)

- `./node_modules/.bin/tsc -p tsconfig.check.ios.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.android.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.web.json` → exit 0
- `./node_modules/.bin/eslint` on all touched/new files (incl.
  `keystone/no-hardcoded-color`) → clean; `./node_modules/.bin/oxlint
  --quiet` same set → clean.
- `NODE_ENV=test ./node_modules/.bin/jest --forceExit
  --testTimeout=20000` → **141 suites / 1665 tests pass** (base
  138/1638 → +3 suites/+27: `HomeFeed.live.test.tsx` 11,
  `streaming.test.ts` +12, `mastodon-stream-delete` 3,
  `misskey-stream-capture` 1).
- `./node_modules/.bin/lingui extract --clean --locale en` → 4 new
  strings, purely additive (no msgid removed; pill placeholder kept);
  `lingui compile` → all locales compiled (non-en render English
  fallback for the 4 badge strings, established precedent).
- Live Akkoma :4000 probe (esbuild-bundled temp script, deleted after;
  writes cleaned + verified): `login ok; caps.streaming supported;
  stream.handle non-null; subscribeTimeline channel=pending;
  post.create <id>; stream.arrival home-timeline delivered <id>;
  post.favourite <id>; stream.delete <id> (per-post capture);
  post.cleanup deleted-post-no-longer-fetchable; stream.noPhantom
  arrivals-stable; status connecting-after-unsubscribe`. One honest
  gap: `stream.update` — Akkoma sent no `status.update` for a
  self-favourite in 8s (server doesn't broadcast it); client routing
  is transport-test-proven instead.
- Misskey-family live → `not verified` (:3101/:3102 down, unchanged).
  Helium web-visual → `not verified` (CDP :9222 answers but :8088/:
  8095 serve other sessions' trees; booting another expo + driving the
  shared tab would disturb in-flight work).
- iOS/TalkBack → `not verified` (still blocked, per STATE).

## Deviations (files touched outside the slice list + why)

- `src/screens/Notifications.tsx`: one hook mount + import (the S4
  "notification channel" has to mount somewhere that owns the
  notifications queries; `useLiveNotifications` is a `streaming.ts`
  consumer). No UI/behavior change otherwise.
- `src/locale/**`: `en/messages.po` + compiled `messages.ts` ×8 (the
  4 new badge strings; additive only, pill msgid preserved).
- New tests listed above; temp probe script deleted after the run
  (outside file ownership).
- Untouched as ordered: `RichText.tsx`, `PostCard.tsx`,
  `PostQuote.tsx`, `body.ts`, `menuModel.ts`, emoji files,
  filters/grouped-notification files, `Navigation.tsx`,
  `state/STATE.md`, `docs/*`, `badges.ts`.

## V1 + Bluesky references consulted (behavior only, no verbatim code)

- `~/Local Documents/Keystone/frontend/src/components/TimelineFeed.tsx`
  (feedCache save/restore on mount + source-switch, direct insert with
  dedupe, newest-50 live capture with in-place delete + refetch-update,
  `hasChannel` incl. the clip exclusion, `CAPTURE_LIMIT = 50`).
- `~/Local Documents/Keystone/frontend/src/state/feedCache.ts`
  (in-memory `{notes,cursor,exhausted,scrollY}` keyed
  `accountId::JSON(source)` + scroll-only entries).
- `~/Local Documents/Keystone/frontend/src/components/StreamBadge.tsx`
  (renders nothing when disabled/settling; live/connecting/
  reconnecting(n)/unavailable + retry).
- No Bluesky source needed (no Bluesky equivalent for this UI).

## Next

1. Coordinator: tick the three WS-G boxes in `docs/V2_GAPS.md`
   (proposed lines below), append the four DECISIONS lines, review/
   merge `pG-streaming`.
2. Follow-ups (not this WS): live `status.update` observation needs a
   server that broadcasts one (Akkoma doesn't for self-favs);
   web-visual of badge/pill when a rig port is free; N14 `partial` →
   done only if entry-level restore is ever shown lacking.

STATUS: complete.
