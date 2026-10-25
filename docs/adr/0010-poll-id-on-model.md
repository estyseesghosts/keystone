# ADR 0010 — Poll id on the core `Poll` model (delete the Mastodon vote GET-then-POST)

Date: 2026-10-25
Status: accepted
Plan ref: `docs/audit_20261024/repair.md` R2.2 (out-of-scope note: "poll-id-on-model … ADR + separate slice")

## Problem

Mastodon `voteInPoll` (`packages/fedi/src/mastodon/endpoints.ts`) needs the
POLL id (`POST /api/v1/polls/:id/votes`), but core `Poll`
(`packages/fedi/src/core/models.ts`) carries no id — so the function GETs
the status first, reads `poll.id` off it, then POSTs the vote. That is an
extra round-trip per vote plus a TOCTOU race between the read and the vote
(the poll can close or be replaced in between), and it is inconsistent with
the Misskey path, which votes directly with no read (`notes/polls/vote`
takes the note id). Repair R2.2 deliberately left the GET-then-POST as-is
(`state/logs/2026-10-24-repair-r2.2.md` Next) because putting the id on the
model is a data-model change needing its own decision. The wire id is
available where it matters and dropped where it is built: Mastodon wire
`Poll.id` (`packages/fedi/src/mastodon/wire.ts`) is always present but
`adaptPoll` (`packages/fedi/src/mastodon/adapt.ts`) discards it; Misskey
wire `Poll` (`packages/fedi/src/misskey/wire.ts`) offers no id at all
(`multiple`/`expiresAt`/`expiredAfter`/`choices` only).

## Options considered

1. Keep `Poll` id-less and keep GET-then-POST (status quo) — rejected:
   preserves the extra request and the read/vote race on every Mastodon
   vote.
2. Put the poll id on core `Poll` (`id: string | null`), populate it per
   family at adapt time, vote from the model id with no GET, and DELETE the
   GET fallback — chosen. Missing id is an honest typed failure, never a
   silent refetch.
3. Keep GET-then-POST as a fallback for polls with a null id — rejected: a
   fallback preserves the exact race this ADR removes, and a null id must
   mean "unknown", never "go fetch it".

## Decision

`Poll` gains `id: string | null` (additive widening; IDs stay opaque
strings, never parsed). Population is per family, at adapt time only:

- Mastodon `adaptPoll`: `id` from wire `Poll.id` (always present on the
  Mastodon wire, including Akkoma/Pleroma).
- Misskey `adaptPoll`: `id: null` — the Misskey wire offers no poll id,
  and nothing is guessed. This blocks nothing: `votePoll` keys on the note
  id, not a poll id.

Vote-path contract:

- Mastodon `voteInPoll` takes the poll id (supplied by the caller from the
  already-loaded `Post.poll.id` — never refetched) and POSTs directly, no
  GET. A null/missing id throws the existing typed
  `FediError("This post has no poll to vote in.", "errors.shape.noPoll")`
  with zero requests. The status-GET fallback is DELETED, not kept.
- Misskey `votePoll` is unchanged in mechanism (noteId-keyed, sequential
  one-POST-per-choice with the `errors.poll.partialVote` partial-failure
  error — the R2.2 honesty precedent). A null `Poll.id` never blocks it;
  voting with no `Post.poll` at all is a typed error with no request on
  both families (never let the server 400 decide).

## Consequences

- Good: one fewer request per Mastodon vote; read/vote race eliminated;
  both families vote from already-loaded model state.
- Bad / accepted risk: callers holding a bare status id with no loaded
  `Post.poll` can no longer vote via the Mastodon path — they get the
  honest `noPoll` error instead of a transparent refetch.
- Follow-ups (separate code slice, not this ADR): update both `adaptPoll`s,
  both vote paths (+ the `PostCard` → `Backend.votePoll` id plumbing so the
  Mastodon path receives the poll id), and port/extend tests on both sides.
