# ADR 0013 — Poll hidden totals: `PollOption.votesCount: number | null`

Date: 2026-10-25
Status: accepted
Plan ref: `docs/audit_20261025/repair.md` §X4.3

## Problem

Mastodon sets each poll option's `votes_count` to `null` while a
`hide_totals` poll is open. The Mastodon adapter defaulted it to `0`
(`adapt.ts` `o.votes_count ?? 0`), so an open hidden-total poll rendered
"0" with an empty bar — fabricated data (audit mastodon finding 7,
"never ship fake data", AGENTS.md §6). The app can itself create such
polls (`polls_hide_totals` is `supported` for Mastodon). Same-slice
related gaps: option titles ignore `poll.emojis` (finding 20), the
`expired` flag is frozen at adapt time so cached rows stay open past the
deadline (misskey M16), and poll expiry can become `expires_in: 0`,
which Mastodon rejects (minimum 300 s; finding 22).

## Options considered

1. Keep `votesCount: number` and keep rendering 0 for null — rejected:
   fake data, against AGENTS.md §6.
2. Widen to `number | null` (null = hidden until closed), pass wire nulls
   through both adapters, render a translated "hidden" label with no bar
   and no zero; merge `poll.emojis` into the post's packed emoji map (no
   new model field); compute closed at render time from `expiresAt`;
   clamp `expires_in` to ≥ 300 s — chosen.
3. Add an `emojis` field to core `Poll` — rejected for this slice (X4.4
   owns the next model change); merging into the existing packed map
   covers rendering with a one-line adapter change.

## Decision

- Core `PollOption.votesCount` widens to `number | null` (additive:
  every existing numeric payload still typechecks). Null means "the
  server hid this total" — never "zero".
- Mastodon `adaptPoll` passes `votes_count` through (null stays null);
  Misskey `adaptPoll` is unchanged (its wire votes are always numbers).
- Mastodon `adaptStatus` merges `poll.emojis` into the post's packed
  emoji map, so option titles resolve through the same
  `splitNameEmojis` + `CustomEmojiGlyph` + `lookupPackedEmojis` pipeline
  as display names. No new core field.
- `PostPoll` computes closed at render (`expired || expiresAt <= now`),
  never relying on the frozen snapshot alone; null totals render
  "hidden until closed" (via `msg`) with no bar and no fake zero.
- Composer: `buildPostDraft` clamps Mastodon poll durations to ≥ 300 s
  and `statusBodyOf` clamps `expires_in` to ≥ 300 s (never 0); the
  composer UI rejects a sub-300 s Mastodon poll duration with a
  translated message before submitting.

## Consequences

- Good: no fabricated zeros; hidden polls read honestly; no server 422
  on short expiries; option emoji reuse the vetted packed pipeline.
- Bad / accepted risk: polls adapted before this change that cached a
  `0` for a hidden total keep showing it until refetched (in-memory
  only — nothing is persisted that outlives the session's cache policy).
- Follow-ups: X4.4 owns the next core-model change (nested quotes,
  draft fields); Wave 9 owns the remaining literal strings in poll
  footers/counts.
