# 2026-10-16 — Packed emoji maps: `:name@host:` keys (follow-up)

## Goal

Owner reports custom emoji still don't render in display names and
post reactions — after the load fix landed. Find the real cause.

## Diagnosis (live wire data, Sharkey dvd.chat `global-timeline`)

Two findings, both confirmed against 100 live notes:

1. **Reaction keys pack the host.** Custom reactions arrive as
   `:name@host:` (`:blobcat_under_discussion@misskey.io:`) — the
   common case in the wild. The old `^:([A-Za-z0-9_+-]+):$` parse
   returned null for every one of them, so every custom chip fell
   back to literal text. The global listing only holds bare local
   names and could never resolve these either.
2. **Notes and users pack their own URL maps.** `note.reactionEmojis`,
   `note.emojis`, `user.emojis` are all bare-inner → URL
   (`"blobcat_under_discussion@misskey.io": "https://…"`) — including
   remote-hosted files for local shortcodes (e.g. a `:kowaii:` in a
   name mapping to `media.misskeyusercontent.com`). These were
   already in the client types (`api/types.ts`) but no renderer read
   them. Display-name codes are overwhelmingly bare `:name:` (splitter
   was fine); the missing piece was purely URL resolution.

## What changed

- `frontend/src/api/emoji.ts`: `stripEmojiColons`, `bareEmojiName`,
  `sameEmojiKey` (exact, or bare `:name:` ≡ local `:name@.:`;
  distinct remote hosts never equate), `lookupPackedEmojis`
  (exact-inner → bare → colon-wrapped variants, tolerant both
  ways). `isLikeActive`/`shouldHideChip` compare by identity, so a
  custom like never leaks into the chips under a `@.`-suffixed key
  either. `customEmojiNameFromReaction` reduces host forms to the
  bare name for global-list fallback.
- `frontend/src/api/customEmoji.ts`: `customEmojiUrl` accepts all
  three key shapes; listing cache keyed per target
  (`ext:<host>` / `int:<backend>`) so account switching refetches
  instead of serving another instance's list.
- Resolution order everywhere: packed per-object map → global
  listing → literal text (never fabricated). Threaded via new
  optional props: `EmojiGlyph packed`, `DisplayName packed`,
  `MfmRenderer emojis` (through `TranslatableText`), all fed from
  the object in hand (`note.reactionEmojis` for chips/like,
  `note.emojis` for text/CW/polls, `user.emojis` for names/bios).
  Notification `reacted :code:` rows render the glyph too.
- `frontend/src/App.tsx`: `loadCustomEmojis()` fires once at
  startup (was picker-open only — names/reactions rendered literal
  until the user opened the picker even with a working fetch).
- `AccountCard` needs nothing: the uncommitted card rework made it
  avatar-only (names appear only as handles/aria strings, correctly
  raw).

## Evidence (real output)

- Live `global-timeline` probes (100 notes): `:name@host:`
  reaction keys + `reactionEmojis` samples; populated
  `user.emojis` maps (`:kowaii:`, `:spats:`, …) against matching
  `:code:` display names.
- Pure checks (esbuild-bundle + node over the real module):
  **59/59 passed** (prior 42 + 17: colon strip, bare names, key
  identity incl. distinct-host rejection, packed lookup incl.
  colon-wrapped keys and misses).
- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-DVVY7rlK.js`, 257.49 kB;
  `index-BwOYy7b5.css`, 36.08 kB). Dev serves 200.
- Solid checklist (`solidjs.md` §10) walked: props read at use,
  memos for parts/keys, effects are closers/startup-kick only,
  `onCleanup` on timers/listeners. No backends on this machine —
  API suites N/A. Visual confirmation **not yet verified** (owner).

## Open questions

- Local Misskey's `emojis` shape is assumed identical to Sharkey's
  (verified) — owner confirms on `:3101` alongside the visual pass.
  A local custom reaction may arrive as `:name:` or `:name@.:`;
  both resolve by construction.

## Next step

Owner visual pass on dvd.chat: a post with remote custom
reactions (chips as images), display names with `:code:`, quote
heads, hover cards, notification reaction rows. Then commit the
emoji work as one slice.
