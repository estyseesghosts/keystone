# 2026-10-22 — RichText chips + newline fixes — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner k1k2 comparison (`docs/k1k2-20261022/`): v1 renders bare
URLs and mentions as chips, v2 dumps raw wrapping text; newline trouble.

## Did

- `packages/fedi/src/core/content/ast.ts`: new pure `shortenBareUrl`
  (scheme stripped, 32-char `…` truncation) + `bareLinkLabel`
  (Misskey bare URLs shorten; Mastodon `invisible`-span-shortened links
  keep the server's visible label; labeled links and non-web schemes
  never qualify).
- `RichText.tsx`: bare/shortened links and resolvable mentions render as
  inline atomic pills (`richtext-link-chip`, `richtext-mention-chip`;
  border `edge`, glyph + handle for mentions) — the line-box never
  splits them mid-word. Unresolvable mentions stay plain text (never a
  dead chip); labeled links unchanged. Press routing unchanged.
- Newlines: `fromHtml` drops whitespace-only text adjacent to block
  boundaries (pretty-printed HTML no longer yields phantom blank
  lines); `fromMfm` normalizes `\r\n?` → `\n`.
- Tests: fedi `content-ast` (shorten + chip-label cases), `content-html`
  (inter-block whitespace, inline spacing kept), `content-mfm`
  (`\r\n`); `richtext-wsb` (bare chip + press, server-shortened chip,
  mention chip + press, labeled link stays text).

## Decided / follow-ups

- Mention chips carry the handle + glyph, not the avatar: no account
  lookup infra exists (Post.mentions is ids-only). Avatar resolution
  needs a mention→account query + cache — separate slice.
- Hovercards (v1 `v1-hovercard.png`) not built: profile preview popup
  is its own slice; mention taps already route in-app to User.

## Tests / verification

- Targeted: fedi content suites + richtext-wsb → 91 green
- `pnpm run typecheck` + `lint` → clean (pending full suite at commit)
