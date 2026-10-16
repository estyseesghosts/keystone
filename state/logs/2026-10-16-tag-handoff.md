# 2026-10-16 — Tag/chip/fold/scroll handoff analysis

Goal: owner specced five patches (tag-block bubbles, inline chips,
750-char fold, global infinite scroll, CW-translation probe) with
`beeline_1.jpg` / `beeline_2.jpg` as functionality references. Task: analyze
and write the implementer handoff, not implement.

## Analysis performed (no code changed)

- Re-read `beeline_1.jpg` after the owner flagged a wrong file: it shows a
  truncated tag bubble top-right of the note header opening a popup panel
  with the full per-tag pill list — so the bubble lives in the header row,
  not inline in the text. (`beeline_2.jpg`: inline mention/link pills.)
  Owner clarified: functionality only, Keystone monochrome throughout.
- Mapped every implementation site: `NoteCard` header (bubble), new
  `src/api/tags.ts` (block detection — AST runs of `hashtag` nodes with
  whitespace/emoji spacers, sequential-indexOf prune mapping),
  `MfmRenderer.renderNode` (chips, keeping MentionLink/ExternalLink safety),
  `NoteCard→NoteBody→TranslatableText` `foldText` threading (detail opts
  out), four infinite-scroll sites (`TimelineFeed`, `Profile` ×2,
  `Notifications`, `Note` replies) with the `DriveBrowser` sentinel as the
  house pattern, `Search` confirmed single-shot (out of scope).
- Verified tag search needs no new endpoint (`/search?tag=` +
  `notes/search-by-tag` already work); the 750-char budget rule
  (links/mentions 0, hashtags counted) and prune→fold ordering are pinned
  in the handoff; CW translation is probe-gated and explicitly deferrable
  per the owner.
- Handoff written to `docs/tag-bubbles-fold-scroll-handoff.md` (workstreams
  A–E in dependency order, with file:line pointers, decided-where-possible
  specifics, unit-check precedent, and browser test matrix). `STATE.md`
  Next pointer updated. No verification to report (analysis only).
