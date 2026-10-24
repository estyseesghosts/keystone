# 2026-10-24 — Translation skips + original-tag routing — agents

Branch: `main` (direct; standing owner instruction).
Goal: owner-ordered delegation (two subagents, frozen contract) —
same-language posts never auto-translate (and same-language results
are discarded), tag/link-only posts never translate, translated tags
click through to the ORIGINAL tag (#fotografia, not #photography).

## Core finding (agent A, documented in code)

Both families translate server-side by id/status — tokens CANNOT be
excluded request-side. So protection is skip-side (don't send) +
render-side (post-process). `Post` carries no language metadata, so
same-language pre-fetch skip is impossible; it is render-side
discard (+ fetch gate only when the injector knows the source).

## Did

- Shared (agent A):
  - `translationPolicy.ts`: `isSameLanguagePost` (primary-subtag
    compare, then `!translationDiffers` for display names; null/empty
    → false/proceed).
  - `ast.ts`: `hasTranslatableNodes` (HTML-tree twin of
    `hasTranslatableText`; deliberate deltas documented — code
    opaque, matrix excluded as a structured token),
    `originalTagsOf` (DFS document order),
    `contentFromTranslatedText(text, originalTags?)` (count-equal →
    positional `{tag: original, children: [verbatim translated
    label]}` hashtag nodes; mismatch/absent → byte-identical old
    output). Confirmed hole: `hasTranslatableText` gated NOTHING
    (nothing imported it) — PostCard fetched on mere non-empty text.
  - `misskey/translate.ts`: finding comment only.
- Mastodon + call sites (agent B): PostCard fetch gates
  (known-same-language via new `TranslationSource.sourceLang`;
  tag/link-only via parsed nodes; manual path deliberately ungated),
  render discard shared by auto+manual (null-label foreign-script
  escape still shows), original-tags pass-through at the translated
  render (only `contentFromTranslatedText` call site in src/).
  Mastodon endpoint files verified untouched (sourceLang already
  surfaced).
- Lead integration: removed agent B's defensive adapter layer (import
  `*` + runtime fallbacks) now that the helpers exist — direct
  imports fail loudly on drift instead of silently guessing.
  Verified green after.

## Tests

- Agent A: same-language table, skip tables (MFM + nodes), mapping
  incl. mismatch fallback (114 tests across 3 suites).
- Agent B: `post-translation.test.tsx` (9: skips, discard, manual
  on-demand, tag tap → original).
- `pnpm typecheck` + `pnpm lint` clean at agent handoff; full suite
  in the final verification below.

## Tests / verification (lead)

- Targeted re-run post-simplification: 85/85 green.
- Full suite + typecheck + lint: see log tail after commit run.

## Next

- Owner live check (same-language + tag-only + tag routing);
  push `main`.
