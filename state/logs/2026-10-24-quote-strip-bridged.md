# 2026-10-24 — Quote review + hashtag redirect strip + bridged in-app — agent

Branch: `main` (direct; owner review + two directives, no plan slice).
Goal: (1) verify RE/quote parsing incl. bsky.brid.gy; fix gaps.
(2) `[#tag](url)` markdown / redirect links always become plain
hashtags (phishing surface). (3) bridged posts open in-app, never the
browser.

## Review findings (verified, not assumed)

- Misskey structured quotes, Mastodon 4.5+ `{state, quoted_status}`,
  Akkoma nesting, `quote_id`-without-quote, RE prefix+suffix with
  marker+link+newline truncation — all covered, with tests.
- Two real gaps: MFM `RE:` prefix rejected leading blank lines (HTML
  side already tolerated them), and no menu path kept bridged posts
  in-app (body taps + quote cards already do).
- `mfm-js` parses `[#photo](url)` labels as plain text (never a
  hashtag node), so the strip must happen at AST build; verified live
  against the installed parser.

## Did

- `core/content/ast.ts`: `hashtagLabelOf` — entire label is one `#tag`
  (or a lone hashtag node) → tag, else null. Comment marks it as the
  anti-phishing rule.
- `fromMfm` link case + `fromHtml` anchor: hashtag-labelled links
  convert to href-less hashtags (no embed, chip, unfurl, browser);
  anything richer stays a link. Classed anchors keep precedence.
  Verified tag blocks unaffected (detected on raw mfm nodes pre-build).
- `misskey/quote.ts`: prefix tolerates + swallows leading blank lines.
- `core/models.ts`: `isBridgedAccount` / `isBridgedPost` (bridge host
  or bsky.app canonical URL) + `BRIDGED_*` constants.
- `menuModel.ts`: `open-in-app` (Note screen) and `open-in-app-user`
  (profile) rows replace browser/remote-link rows for bridged content;
  absent in-app handlers fall back to the browser rows (never inert).
  `PostCard` wires both via the existing navigation refs. Copy-link /
  share keep the canonical URL (sharing out is the user's choice).

## Decided

- No ADR. Bare bsky.app links inside bodies still open externally
  (only the explicit remote-view rows go in-app). Videos keep `contain`
  (unsafe metadata never crops playback).

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2529 tests green** (+22: mfm/html
  strip + non-cases, prefix blank lines, RE+newline truncation ×3,
  bridged unit + menu rows + fallbacks).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched fedi content/quote/models, menuModel + PostCard wiring,
  and the six test files above. Untracked owner drops untouched.

## Next

- Owner: visual confirm on desktop web; push `main`.
