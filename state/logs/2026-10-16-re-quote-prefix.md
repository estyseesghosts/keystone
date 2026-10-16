# 2026-10-16 — leading-`RE:` triple fix + mention-chip avatars

Goal: kill the triple representation in `docs/re-quote.png` (leading
`RE:` chip line + duplicate LinkCard + quote card for one target), and
show avatar + display name (not bare `@acct`) in mention chips.

## Leading `RE:` (`frontend/src/api/quote.ts`, `NoteBody.tsx`)

- `TextualQuoteMatch` gains `position: "prefix" | "suffix"`. New
  `RE_PREFIX_PATTERN = /^RE:[ \t]*(\S+)[ \t]*(\r?\n|$)/` (same narrow
  rules as the suffix: case-sensitive `RE:`, exactly one absolute
  http(s) URL on its own line, trailing-punct trim, credentials/non-web/
  relative rejected). New `parseLeadingQuote()` + `parseTextualQuotes()`
  (0–2 matches, occurrence order; a whole-text lone marker collapses to
  one union range so stripping never double-applies).
- `getQuoteTarget()` precedence unchanged: structured always wins;
  textual fallback prefers the suffix, prefix feeds the same source when
  no suffix matches. Two different URIs never guess two cards.
- `NoteBody`: `coveredMarkers()` evaluates each marker independently —
  textual markers hide when their own resolved card shows; structured
  duplicates hide when the structured card (or unavailable fallback)
  renders. Ranges strip back-to-front; only touched edges trim. Failed
  `ap/show` keeps text AND card (the link is the only path there).
  `cardUrls` additionally suppresses URLs on stripped markers, so the
  prefix form never unfurls a duplicate LinkCard. Profile-URL path
  unchanged. Pipeline order (markers → tags → fold/translation) kept.
- Known residual: a marker whose URL shares no normalized form with
  `structuredUrisOf()` (e.g. pretty `/@user/id` vs AP `/notes/id`
  schemes) still triples — string equality is the only available
  correlator across id schemes. The dvd.chat screenshot case resolves
  only if the packed `renote.url` carries the pretty URL.

## Mention chips (`MfmRenderer.tsx`, `global.css`)

- `mentionCache` now keeps the full `UserLite` (was id-only); resolved
  chips render avatar (16px circle, initial-letter fallback) + display
  name linking to the profile, full `@acct` on `title`. Unresolved/miss
  rendering is byte-identical to before (verbatim acct, no link).
  Applies everywhere `MfmRenderer` runs (notes, quotes, notifications).

## Evidence

- esbuild-bundle + node `/tmp/opencode/quote-re-check.mjs`: **45 passed,
  0 failed** (suffix legacy, prefix shapes, both-ends same/conflict,
  all rejects, structured-wins both ends, suffix preference, matchers).
- `tsc --noEmit` clean; `npm run build` green
  (`dist/assets/index-5ruGYxbe.js`).
- Live `ap/show` probe vs `:3101`/`:3102`: **not run here** — no local
  backends on this machine (both `curl` probes empty). Owner covers on
  dvd.chat; any leading-`RE:` quote exercises prefix-strip +
  no-LinkCard-duplicate, and any @mention exercises the avatar chip.
- `docs/quote-posts.md` heuristic widened (terminal → leading-or-
  terminal); scope line in `docs/frontend-plan.md` below.
