# 2026-10-16 — renote vs quote (retweet-style reposts + renote menu)

Goal: Keystone showed pure reposts as empty notes and had no quote option
from timelines. Clicking renote should offer Repost/Quote (Undo repost/Quote
when already reposted); pure reposts should read like retweets; quotes follow
Misskey semantics.

## Misskey semantics (verified in server source)

- `packages/backend/src/misc/is-renote.ts`: pure renote = `renoteId` set with
  no text/CW/reply/poll/files; anything else with `renoteId` is a quote.
- `NoteCreateService.ts`: renoting a pure renote → `CANNOT_RENOTE_TO_A_PURE_RENOTE`;
  replying to one → `CANNOT_REPLY_TO_A_PURE_RENOTE`. Every action on a pure
  repost must therefore target the renoted original.

## What changed (`frontend/` only)

- `src/api/types.ts`: `isPureRenote()` + `appearNoteOf()` (packed-notemirror
  of Misskey's helpers; wrapper fallback when the original is unavailable).
- `src/components/NoteCard.tsx`: pure reposts render `X reposted` banner +
  the original's avatar/name/handle/time/body/counts; quotes unchanged (own
  note + embed). All actions receive the shown (original) note. Renote button
  is now a menu (`aria-haspopup`, Escape/outside-click close): Repost/Quote,
  or Undo repost/Quote when `reposted`. New `onQuote` prop; logged-out
  fallback (static count) unchanged.
- `src/components/TimelineFeed.tsx`: repost state keyed by original id;
  `onQuote` toggles an inline `<Composer renoteId>` under the card; posted
  quotes prepend to the feed.
- `src/routes/Note.tsx`: same menu via `onQuote` (replaces the standalone
  "Quote this note" toggle; cancel button kept); post-action refresh reloads
  the page id so pure-wrapper detail never swaps content; "Renoted" section
  hidden for pure reposts (main card already shows the original); reply +
  quote composers target the original.
- `src/routes/Notifications.tsx`: textless notification notes with
  `renoteId` show muted "Reposted a note" instead of nothing.
- `src/styles/global.css`: `.renote-banner` (full-width, muted) +
  `.renotemenu` (grey popup); `.note` wraps so the banner sits above.
- `docs/frontend-plan.md`: Slice 3 records the new behavior.

## Evidence

- `npm run build`: green (155.76 kB JS).
- `/tmp/opencode/renote_probe.py` (Keystone-owned login → create → pure →
  quote → negative cases → timeline → unrenote → cleanup): **15/15 on
  Misskey (:5176/mk1) and 15/15 on Sharkey (:5177/sk1)**. Confirmed: pure has
  `text:null` + packed `renote`; quote keeps text + `renoteId`; renote-of-pure
  and reply-to-pure both 400; `unrenote` takes the original id.
- `smoke_writes.py` 14/14, `smoke_features.py` 47/47 (both servers).
- `smoke_flows.py`: 40 passed, 4 failed — all 4 are `GET / → 404` backend-UI
  checks (`:3101`/`:3102` answer 200). Pre-existing environment drift: those
  assertions hit the backends directly and no Keystone-repo change can affect
  them; the running backends are serving their web UI (flag not active).
- Menu open/close, banner layout, and quote-composer visuals: **not yet
  verified** (no browser here) — needs the owner browser pass.

## Open questions / next

- Commit + push (left uncommitted for owner review).
- Owner browser QA: menu keyboard flow, banner on desktop + mobile widths.
- Optional follow-up: pre-fill quote composer with `RE:` reference or focus
  it on open (currently neither).
