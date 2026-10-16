# 2026-10-16 — Word-mute Misskey parity

Owner correction: matching must work exactly like Misskey, verified against
source. Misskey repo now at `/Users/terezi/Local Documents/misskey`
(`ea2c3aedc7`). Sharkey server source still absent (raw fetch 404 on
`develop`/`dev`) — Sharkey forked the same files; assumed identical, flagged
for confirmation.

## Source of truth (read, not guessed)

- `packages/frontend/src/utility/check-word-mute.ts` — the browser matcher
  Keystone mirrors (JS RegExp, regex cache, empty-keyword drop, `lastIndex`
  reset, matched-filters-or-false).
- `packages/frontend/src/composables/use-note.ts` `checkNoteWordMute` —
  appear note → reply → renote; soft on `mutedWords`, hard only in
  `withHardMute` contexts with `hardMutedWords`.
- `packages/backend/src/misc/check-word-mute.ts` + `test/unit/misc/`
  (Aho-Corasick fast path = plain `includes` semantics; bare strings are
  `/pattern/flags` RE2, validated on save).
- `packages/frontend/src/pages/settings/mute-block.word-mute.vue`
  `render`/`parseMutes` — the editor transport (arrays space-join per line;
  regex lines verbatim + must compile or the save aborts with a line number;
  single-space split, not `\s+`).
- `packages/backend/src/misc/is-instance-muted.ts` — exact
  case-sensitive host `Set` match over author + reply + renote authors
  (also notifications; Keystone feeds only).
- `i/update.ts`: filters are `Array<string|string[]>`; `wordMuteLimit`
  policy + `invalidRegexp` server errors surface verbatim on save.

## Divergences fixed (old Keystone behavior)

1. Case-insensitive matching → case-sensitive (`Foo` no longer mutes `foo`).
2. No regex support → `/pattern/flags` with flags + `lastIndex` reset.
3. Text+CW haystack → CW+text (anchored `^` patterns now anchor at the CW).
4. Groups containing `""` never matched → empties dropped (backend-equivalent
   outcome); emptied groups never match.
5. `line.split(/\s+/)` transport → single-space split; `/…​/` lines kept
   whole; invalid regex now blocks the save with the line number
   (both settings and profile editor).
6. Appearance-only check → note→reply→renote cascade; own notes exempt
   (needs `myId`, now threaded through `TimelineFeed`).
7. Instance mutes case-insensitive + author-only → exact case-sensitive
   over author + reply + renote hosts.
8. `MeDetailed.mutedWords/hardMutedWords` widened `string[][]` →
   `Array<string|string[]>` (regex filters are stored bare strings).

## What changed

- `frontend/src/api/softMute.ts`: rewritten (`checkWordMute`,
  `checkNoteWordMute`, `isInstanceMuted`, `formatWordFilters`,
  `parseWordFilters`, `WordFilterParseError`); `parseMutedInstances` kept.
- `TimelineFeed.tsx`: hard/instance drop + soft badge via the new path.
- `Settings.tsx` (`MuteWordField`) + `ProfileEditor.tsx`: reference
  transport + line-numbered regex refusal.
- `docs/api-surface.md`, `docs/frontend-plan.md`: semantics recorded.

## Evidence

- `tsc --noEmit` clean; `npm run build` green (`index-BbktKN02.js`).
- 51/51 parity checks (`/tmp/opencode/wordmute-check/run.mjs` over an
  esbuild bundle): all 13 reference unit cases + case/empty/regex-shape/
  validity/flags/`g`-repeat/CW-order/blank/cascade/self/instance/transport
  cases. No backends here — live round-trip + browser QA **not yet
  verified** (owner).

## Deferred (not Misskey behavior)

- Sharkey's "Test patterns" expander (Sharkey-only UI, not in Misskey
  source) — a tester would invent semantics; skipped.
- Per-user mute-expander rows (`muted_users.png` chevrons, likely
  `expiresAt` display/edit; Keystone never sends expiry).
- Exact endpoint `kind` strings still to confirm in server source.
