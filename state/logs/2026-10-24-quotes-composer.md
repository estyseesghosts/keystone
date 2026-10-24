# 2026-10-24 — X-style replies + quotes (docs/quotes) — agent

Branch: `main` (direct; owner doc-driven, no plan slice).
Goal: composers show the real referenced post / quoted card (not
one-line captions); timeline quote cards gain avatars, timestamps, one
flat nested level, compact video rows, and edge-to-edge quoted media.

## Did

- `PostQuote.tsx`:
  - Avatar (24px + fallback) + relative timestamp in the header.
  - One flat nested level for quotes-of-quotes (rule + 20px avatar +
    name/time + text + one thumbnail, never card-in-card; anything
    deeper stays unrendered; missing inner target gets an honest line).
  - Quoted video/gifv renders as a compact thumb-plus-text row (still
    preview, no autoplay); quoted photos go full-bleed below the text.
  - `bleed` quoted media: no inner border, card `overflow: hidden`
    clips the corners.
- `PostMediaGrid.tsx`: `bleed` prop (edge-to-edge wrap cancelling the
  card padding, borderless frames).
- `ComposerSections.tsx`: `ReplyPreviewSection` (full OP: avatar,
  name, time, text, nested quote card; thread rail; Replying-to row)
  and `QuotePreviewSection` (the real quoted card, non-interactive).
- Both composers: captions replaced with the previews; quote
  placeholder is now "Add a comment" (reply keeps "Write your reply").
- Left out per plan: Collapse button, Drafts button, reply-policy row
  (no backend), composer media previews, nested video autoplay.

## Decided

- No ADR. Photo-vs-video read of the screenshots stands unless the
  owner corrects it.
- Fixed along the way: quote-refusal + draft-restore tests now use
  full `makePost` fixtures (skeletal posts crash the preview render);
  Composer harness renders inside `I18nProvider` (PostQuote needs it).

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **197 suites / 2507 tests green** (+8: header
  avatar, flat nesting + missing-inner, compact video vs full photo,
  composer reply/quote/reply-to-quote previews + placeholders).
- Web visual: `not verified` (no desktop browser attached).

## Deviations

- Touched `PostQuote`, `PostMediaGrid` (+bleed), `ComposerSections`
  (+2 sections), both composers (preview wiring + placeholder), and
  the three test files above. Untracked owner drops untouched.

## Next

- Owner: visual confirm on desktop web (reply + quote composers,
  nested quotes, card media bleed, compact video rows); push `main`.
