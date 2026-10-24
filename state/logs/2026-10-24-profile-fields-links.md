# 2026-10-24 — Profile fields: live links, mentions, translation hashtags — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner follow-up — profile "additional fields" should render
clickable links (markdown + bare), handle mentions as in-app chips,
`[@handle@host](url)` normalized like the Pixelfed hashtag problem,
and translated `[#tag](instance-URL)` fixed to plain tag text.

## Did (all `packages/fedi`, pure, plus one call-site swap)

- `core/content/ast.ts`:
  - New `mentionLabelOf` (mirror of `hashtagLabelOf`): a link whose
    entire label is one `@user[@host]` handle returns the canonical
    handle. Validation reuses `validTranslatedHandle` (now exported,
    with `stripTokenPunctuation`, for the fields module).
  - Translated text: new `TRANSLATED_TOKEN_PATTERN` leading
    alternative matches markdown hashtag links whole; new
    `translatedHashtagOf` reads markdown labels, `/tags/` +
    `/hashtag/` tails (decoded), and `?q=` / `?tag=` params. Both
    collapse to plain `#tag` text — translated tags were already
    policy-non-routable; this stops the author's instance hashtag URL
    from coming back as a chip after translation. Normal URLs still
    linkify.
- New `core/content/fields.ts` (`contentFromFieldValue`, exported
  from the barrel): parses HTML first (both families' anchors keep
  working), then expands eligible text runs — markdown links, bare
  http(s) URLs, bare `@handle` mentions — never inside link /
  mention / hashtag / code (labels already decided there). Newlines
  stay literal text (E4 rendering unchanged). No import cycle
  (fields → fromHtml + ast, one direction).
- `core/content/fromHtml.ts` (`convertAnchor`) and `fromMfm.ts`
  (`link` case): lone-handle labels become `mention` chips with the
  href kept (bare `@user` still needs the profile URL for remote
  resolution). Taps resolve the label first, so a mismatched URL can
  never hijack the chip into a browser — strictly better than the
  old always-external link.
- `src/components/Profile/ProfileHeader.tsx`: field values parse via
  `contentFromFieldValue` instead of `contentFromHtml`. Bio untouched.
- Tests: `mentionLabelOf` / `translatedHashtagOf` units,
  translated-text hashtag collapse, `contentFromFieldValue` (markdown,
  mention + href, bare tokens, hashtag strip, HTML passthrough,
  email untouched, empty/newline edges), MFM + HTML
  mention-labelled-link cases, and five new field-rendering tests
  (markdown link, bare-URL chip, bare mention chip, handle-markdown
  → chip with no link chip, hashtag-markdown → plain text).

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2582 tests green** (was 199/2557).
- Device/web visual + live-server fields/translation: `not verified`.

## Next

- Owner visual check against real profiles; push `main`.
