# 2026-10-16 — Mutes & Blocks settings replication

Goal: replicate the reference client's Mutes and Blocks page
(`docs/mutes_blocks.png`, plus `muted_users.png`, `hard_mute.png`,
`instance_mutes.png`) functionally in Keystone styling. Two subagents used:
endpoint map + settings/UI audit (both completed).

## Backend truth (endpoint probe; checkouts absent, kinds to-verify in source)

- No `word-mute/*`, `hard-word-mute/*`, or `instance-mute/*` endpoint exists
  on either backend. All three are `i/update` fields (`mutedWords`,
  `hardMutedWords`, `mutedInstances`) — verified via callers + smoke probes.
- `blocking/*`, `mute/*`, `renote-mute/*` (create/delete/list, `{userId}` /
  `{limit, sinceId?, untilId?}`) + `users/relation` drive per-user actions.
  "Muted users (Boost)" = renote-mute (reposts only).
- Keystone never sends `mute/create expiresAt`.

## What changed (all in `frontend/`, uncommitted)

- `src/api/backend.ts`: `KEYSTONE_PERMISSIONS` += `read:blocks`,
  `write:blocks`, `read:mutes`, `write:mutes` (pre-scope sessions 403 →
  existing re-sign-in hint).
- `src/routes/Settings.tsx` (`MutesSettings`):
  - `MuteWordField`: per-field `i/update` editors for Word mute / Hard word
    mute / Instance mutes, seeded from `auth.me()`, `refreshMe()` after
    save; 404 or 400 `UNSUPPORTED_FIELD` → honest unavailable note;
    permission errors → re-sign-in hint. Same backend fields the profile
    editor saves (kept; last-write-wins).
  - `MuteBlockSearch`: `users/search` + relation-driven Mute / Mute-reposts /
    Block toggles (self excluded, create-only fallback when `users/relation`
    is missing, quiet list reload after actions).
  - Lists reordered to reference order (Repost-muted, Muted, Blocked);
    section hint updated.
- `docs/api-surface.md`: new scopes + block/mute/renote-mute/relation/
  word-mute rows. `docs/frontend-plan.md`: new "Mutes and blocks
  management" slice entry.

## Evidence

- `./node_modules/.bin/tsc --noEmit` clean; `npm run build` green
  (`index-DMwUbARX.js`, 329.71 kB).
- API suites NOT re-run (no backends on this machine). Live mute/block/
  word-filter round-trips + browser behavior **not yet verified** (owner).

## Open questions / follow-ups (not in this slice)

1. Matcher parity: reference word mutes are case-sensitive substring +
   `/regex/` (`hard_mute.png`); Keystone's local `matchesWordGroups` is
   case-insensitive with no regex — client over-matches vs the server
   (extra soft badges; hard mutes may hide notes the server would show).
   Align `softMute.ts` to server semantics once verifiable in server
   source + add a "Test patterns" checker. Descriptions document the
   AND/OR/regex transport format only.
2. `muted_users.png` rows have a per-user expander — likely mute expiry
   display/edit (`expiresAt`, which Keystone never sends). Follow-up.
3. Exact endpoint `kind` strings must be confirmed in
   `packages/backend/.../endpoints/*` once checkouts are mounted; adjust
   `KEYSTONE_PERMISSIONS` if any differ.
4. ProfileEditor still carries the same three fields — consider pointing
   it at the settings page instead of duplicating editors.

Next step: owner live-tests on dvd.chat (word save round-trip, mute/block
from search, list reload, Pinetree unavailable notes), then commit.
