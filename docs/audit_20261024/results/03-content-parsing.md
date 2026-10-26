# Content Parsing Audit (MFM/HTML/AST/RichText)

Scope: `packages/fedi/src/core/content/{ast,fromMfm,fromHtml,fields}.ts`,
`packages/fedi/src/core/{models,quoteUri,graph}.ts`,
`src/components/RichText.tsx`, `src/components/Post/{body,badges,time,translationPolicy,translationBreaker,TagBubble.*}`,
`packages/fedi/test/content-*.test.ts`, `packages/fedi/test/tags-fold.test.ts`.
All files read fully. Greps run for `innerHTML` / `dangerouslySetInnerHTML` / `WebView` / `any`
(no hits except comments asserting absence — see §5).

## File sizes

| File | LOC (`wc -l`) | >650? |
|---|---|---|
| `src/components/RichText.tsx` | **1062** | ✅ yes |
| `packages/fedi/src/core/models.ts` | **983** | ✅ yes |
| `packages/fedi/src/core/content/ast.ts` | **825** | ✅ yes |
| `packages/fedi/test/content-ast.test.ts` | 654 | ✅ yes (test) |
| `packages/fedi/src/core/content/fromHtml.ts` | 468 | no |
| `packages/fedi/test/content-html.test.ts` | 474 | no |
| `packages/fedi/test/content-mfm.test.ts` | 299 | no |
| `packages/fedi/src/core/content/fromMfm.ts` | 218 | no |
| `packages/fedi/src/core/content/fields.ts` | 182 | no |
| `packages/fedi/test/tags-fold.test.ts` | 130 | no |
| `src/components/Post/body.ts` | 127 | no |
| `packages/fedi/test/content-wsb.test.ts` | 124 | no |
| `src/components/Post/translationPolicy.ts` | 120 | no |
| `packages/fedi/src/core/graph.ts` | 123 | no |
| `src/components/Post/TagBubble.tsx` | 89 | no |
| `src/components/Post/translationBreaker.ts` | 83 | no |
| `packages/fedi/test/content-akkoma-mfm.test.ts` | 59 | no |
| `packages/fedi/src/core/quoteUri.ts` | 51 | no |
| `src/components/Post/badges.ts` | 49 | no |
| `src/components/Post/time.ts` | 34 | no |

The three >650 LOC production files (`RichText.tsx`, `models.ts`, `ast.ts`) are each
analyzed under Condensed responsibility below. The 654-line `content-ast.test.ts` is
fine as a test file (good coverage density, one describe-block per helper).

## Long-parameter functions

Verdict: **no true long-parameter-list violations.** The parsers are disciplined —
almost everything takes 1–2 params. Nearest approaches:

- 3-param constructors in `ast.ts`: `customEmoji(name, host, src)` (`ast.ts:98`),
  `hashtag(tag, href, children)` (`ast.ts:84`), `fnNode(name, args, children)`
  (`ast.ts:139`), `matrix(userId, children)` (`ast.ts:92`). All fine; positional
  construction is consistent and call sites are readable.
- `shortenBareUrl(href, max = 32)` (`ast.ts:340`) — 2 params, fine.
- `RichTextProps`: **13 fields** (`RichText.tsx:54-87`) threaded into a 15-field
  `Ctx` (`RichText.tsx:89-115`). This is props-object sprawl, not a parameter-list
  smell per se, but the `Ctx` threading means every new rendering concern
  (linkTitles, hideLoneLinkChipFor, session seam…) widens two types and one
  `useMemo` dep list (`RichText.tsx:1010-1030`). Watch it; the next 2–3 display
  concerns should go through a narrower context or a separate component.
- `TRANSLATED_TOKEN_PATTERN` / `FIELD_TOKEN_PATTERN` scanners simulate flag sprawl
  differently: alternation-group dispatch (`match[1]`…`match[4]`) is positional
  flag logic that must be kept in sync across two near-identical regexes (see
  Quality issues). No signature change recommended; dedupe recommended.

## Condensed responsibility

### 1. `src/components/RichText.tsx` (1062 LOC) — parsing + rendering + linking + translation-adjacent. YES, condensed.
One file owns: URL→acct routing (`acctFromProfileUrl` :162, `acctFromBskyAppUrl`
:186, `defaultMentionPress` :218 — the Bridgy unwrap chain), MFM `fn` styling
policy (`fnArg` :268, `safeHexColor` :291, `safeFontFamily` :299, `Fn` :332),
mention-chip resolution UI (`StaticMentionChip` :398, `ResolvingMentionChip` :435,
`MentionChip` :468), the entire Matrix hover subsystem (`MatrixHovercard` :500,
`MatrixHover` :561, `MatrixChip` :690, `matrixViewportSize` :547), inline layout
(`Inline` :728, ~190 lines, 17 node kinds), block layout (`Flow` :934), the
`plain` content-mode branch (:1031), and font-scale theming (:1006). It does not
literally parse MFM/HTML (that stays in fedi — good), but it re-implements
label→route decisions (`labelOf` :254 duplicates reader logic) and duplicates the
bare-link title-capping rule (`bareLinkLabel` caps at 48 in `ast.ts:363`,
`RichText.tsx:770` re-caps titles at 48 — two caps, one file apart conceptually).
Split candidate (no action now): extract Matrix hover + mention-tap routing into
`sibling modules; keep `RichText.tsx` to `Inline`/`Flow`/props.

### 2. `packages/fedi/src/core/content/ast.ts` (825 LOC) — types + parsing + serialization + policy. YES, condensed but deliberately.
One file owns: node types + 15 constructors (:20-145), four readers (`textOf`,
`plainTextOf`, `isBlankContent`, `hasTranslatableNodes` :152-282), URL policy
(`hasUnsafeUrlChars`, `safeUrl`, `safeHttpUrl` :294-334), bare-link chip labels
(:340-365), the **translated-text scanner** (`TRANSLATED_TOKEN_PATTERN` :392,
`contentFromTranslatedText` :463 — a ~95-line mini-parser), mention/hashtag
routing (`mentionAccountIdOf`, `hashtagTagOf`, `hashtagLabelOf`,
`mentionLabelOf` :601-671), the **Matrix subsystem** (`parseMatrixUserId`,
`matrixLabelOf`, `splitMatrixMatch`, `matrixMergeLocal`, `mergeMatrixMentions`
:680-786), and the remote-emoji splitter (:801-824). The file header documents
none of this layering; the section comments do, adequately. The translated-text
scanner is the item that least belongs here (it is a third parser alongside
`fromMfm`/`fromHtml`/`fields`, hidden inside the "types" module). Split
candidate: move `contentFromTranslatedText` + `TRANSLATED_TOKEN_PATTERN` +
`translatedHashtagOf` + `validTranslatedHandle` + `stripTokenPunctuation` into
`core/content/fromTranslated.ts`. Low risk, pure functions, tests import from one
new path.

### 3. `packages/fedi/src/core/models.ts` (983 LOC) — whole-domain model file. YES, condensed (pre-existing, out of practical scope).
Content-relevant surface is only `Content` + `plainFromMfm`/`mfmContent`/`htmlContent`
(:38-94); the rest (visibility, accounts, media, polls, reactions, posts,
notifications, pagination, `parseAcct`, Bridgy helpers :869-959) is unrelated to
this audit. No content-parsing defect found here. Note: `plainFromMfm` (:48-82) is
a **second, regex-based MFM projection** independent of `contentFromMfm` — the
two can disagree (see Suspected bugs B4). Do not split this file in a content
slice; flag for a models-slotting pass.

### 4. In-scope but correctly scoped (no action)
- `fromMfm.ts` (218), `fromHtml.ts` (468), `fields.ts` (182): one parser each,
  clean. `quoteUri.ts` (51) and `graph.ts` (123) are only tangentially in scope
  (quote-marker URL cleaning; social-graph gates) — no content-parsing role, no
  defects relevant here.
- `body.ts` (127): AST selection + quote-strip/tag-prune ordering. Ordering
  (MFM: strip→prune→fold; HTML: parse→prune→marker-strip→fold) is documented and
  matches v1. `translationPolicy.ts` (120) duplicates `decideTranslation` et al.
  from `misskey/translate.ts` with a viewer-primary parameter — intentional
  app/fedi split, but the two copies must be kept in sync by hand (see Quality).
- `translationBreaker.ts` (83), `badges.ts` (49), `time.ts` (34),
  `TagBubble.tsx` (89): single-purpose, fine.

## Suspected bugs (file:line)

### B1. `firstBareUrl` misses Mastodon server-shortened bare links — unfurl trigger gap
`src/components/Post/LinkCard.tsx:106-138`. Bare-ness requires
`children.length === 1 && children[0].text === node.href` (:116-119). A Mastodon
server-shortened link parses to `[text(visible), invisible(hidden)]` children
(pinned at `content-html.test.ts:284-298`), so it is **not** bare by this
definition and `UnfurledLinkCard` never triggers for it — while `RichText`
*does* chip it via `bareLinkLabel` (`ast.ts:351-365`, which handles the
text+invisible shape). Two bare-link detectors, different coverage: the exact
posts that most need a preview trigger (long URLs the server shortened) are the
ones that never get one. `collectBareLinkHrefs` (`ast.ts:577`) already uses the
correct predicate. Fix: define bare-ness once (reuse `bareLinkLabel(node) !==
null`) in `firstBareUrl`. Severity: medium. Tests: none cover `firstBareUrl`
against shortened-link input.

### B2. Translated-text and field scanners shred dotted (bridged) handles
`packages/fedi/src/core/content/ast.ts:393` (`TRANSLATED_TOKEN_PATTERN` mention
alternative `@([\w-]+(?:@[\w.-]+)?)`) and identically
`packages/fedi/src/core/content/fields.ts:34` (`FIELD_TOKEN_PATTERN`). The
username class `[\w-]+` stops at dots, so `@foxtails.me@bsky.brid.gy` in
translated text or a field value scans as mention `@foxtails` + literal
`.me@bsky.brid.gy` — even though `validTranslatedHandle` (`ast.ts:446`) and
`parseAcct` (`models.ts:851`) both *accept* dotted usernames. The 2026-10-24
Bridgy fix repaired the tap-time path (`acctFromBridgeUrl`) but this scan-time
path still truncates bridged actors at the first dot. Severity: low-medium
(translated bodies + profile fields only; main MFM/HTML paths are unaffected —
mfm-js and the anchor parser keep full labels). Fix: widen the username class to
`[\w-]+(?:\.[\w-]+)*` in both patterns (mirroring `parseAcct`), keep the
`@host` tail. Add tests with a dotted handle in both scanners.

### B3. `hashtagTagOf` rejects non-ASCII `data-tag` — Akkoma unicode tags fall through
`packages/fedi/src/core/content/ast.ts:619-633`. The `data-tag` fast path
requires `/^[\w-]{1,64}$/` (ASCII word chars), so a unicode Akkoma `data-tag`
(e.g. `presentaçao`) skips to the `class+href-tail` path. That path *does*
decode percent-encoding and accept `/^[^\s/#?]{1,128}$/`, so the tag usually
still resolves — but with the server's href instead of the authoritative
`data-tag`, and it returns null entirely when the anchor lacks the `hashtag`
class. Severity: low. Fix: widen the `data-tag` class to `/^[^\s/#?]{1,64}$/`
(consistent with the tail validator on :632).

### B4. `plainFromMfm` (regex chain) can disagree with `contentFromMfm` (real parser)
`packages/fedi/src/core/models.ts:48-82`. Mentions strip with
`/(^|\s)@([\w-]+(?:@[\w.-]+)?)/g` (:65) — same dotted-username gap as B2
(`@alice.bsky.social@bsky.brid.gy` → `alice` + `.bsky.social@…` residue), and
hashtag stripping `/#([\w-]+)/g` (:67) is ASCII-only while the real parser's
`hashtagLabelOf` accepts unicode. This function feeds `Content.plain`
(search/fold/length decisions), so disagreement surfaces as wrong fold points or
search text, not render corruption. Severity: low. Fix: widen both classes;
add a differential test (`plainFromMfm(x)` vs `textOf(contentFromMfm(x))` on a
bridged-handle + unicode-tag corpus).

### B5. Matrix merge is top-level-sibling-only — split pairs across inline boundaries don't rejoin (by design; record the limit)
`packages/fedi/src/core/content/ast.ts:759-786`. `mergeMatrixMentions` merges a
mention node + *immediately following* `text` sibling, recursing only into
`MATRIX_MERGE_CONTAINERS` (bold/italic/strike/fn/quote/heading). A shredded pair
separated by a `br`, a code node, or a container boundary (e.g. mention at the
end of `<b>`, `:server` outside it) never merges and renders as a hallucinated
mention chip + dangling text — the exact symptom the 2026-10-24 fix eliminated
for the observed shapes. No live shape is known to do this (Mastodon emits the
pair adjacently; verified in `content-html.test.ts:439-453`), so this is a
documented limit, not a live bug. Do not "fix" speculatively; if a split-across-
boundary shape is ever recorded, extend `MATRIX_MERGE_CONTAINERS`/sibling logic
then.

### Verified sound (recent-log claims checked)
- **Matrix-shredded fixes** (`state/logs/2026-10-24-triple-fix.md` §3,
  `2026-10-24-matrix-chips.md`): sound. Gate (`parseMatrixUserId`, DNS-dot +
  optional port, case-verbatim) + scanner-first ordering + post-parse
  `mergeMatrixMentions` on **all four** paths (MFM `fromMfm.ts:188`, HTML
  `fromHtml.ts:467`, fields `fields.ts:181`, translated `ast.ts:497-509`) +
  hosted-label see-through (`matrixMergeLocal`, `ast.ts:726-733`) + timestamp /
  prose guards (`@3:30`, `@user: hello` pinned in `content-mfm.test.ts:266-274`,
  `content-ast.test.ts:360-368`). Colon-rejection in `mentionLabelOf`
  (`ast.ts:667`) closes the webfinger hole. The `MATRIX_SUFFIX_PATTERN`
  (`ast.ts:735`) is intentionally loose — the gate decides — and
  `stripTokenPunctuation`-before-gate with rest re-emit (`ast.ts:772-777`)
  correctly preserves trailing `.`/`)`.
- **`[@h@host](url)` chips**: sound on all three paths (MFM `fromMfm.ts:144-145`
  keeps href for remote resolution; HTML `fromHtml.ts:320-324`;
  fields `fields.ts:121-127`). Label-first tap routing preserved; richer labels
  stay links. Pinned by tests on each path.
- **Translation-skip logic**: sound with one documented wart. `hasTranslatableNodes`
  (`ast.ts:263`) vs `hasTranslatableText` (`misskey/translate.ts:309`) — the
  delta (MFM counts code/math/search as prose; AST excludes code) is *documented*
  at `ast.ts:259-262` and harmless (identical-output rule suppresses the extra
  MFM requests). Tag/link/mention/emoji/matrix/invisible-only short-circuits are
  pinned (`content-ast.test.ts:440-474`).
- **Bridgy truncation** (`triple-fix.md` §2): sound at tap time
  (`acctFromBridgeUrl` raw+decoded unwrap, `/@` + `/users/` shapes, DIDs→null,
  bridge-no-handle→static-text, never-browser). Remaining gap is only the
  scan-time B2 above.
- **XSS / innerHTML / WebView**: **none**. Greps hit only comments asserting
  absence. Active defenses verified: `DROP_SUBTREE_TAGS` (33 tags incl.
  svg/math/form/media, `fromHtml.ts:62-93`), `safeUrl` (absolute http/https/mailto
  only, credential + control-char + length guards, `ast.ts:308-322`), `safeHttpUrl`
  for loads, emoji-gated `img` (`fromHtml.ts:120-123` + `src` through
  `safeHttpUrl`), event/target/style attributes never read (`attrsOf` allow-list
  by consumption), `safeHexColor`/`safeFontFamily` for `fn` styles, hashtag-redirect
  href destruction (both parsers), unknown-tag degrade-to-children. Ported XSS
  suite green (`content-html.test.ts:156-216`).
- **HTML entity handling**: decode-once by htmlparser2; `innerText`
  (`fromHtml.ts:137`) concatenates decoded text with no second decode pass —
  no double-decode (`&amp;#39;`) path exists. Pinned (`content-html.test.ts:56-61`).
- **Hashtag folding**: hashtags count toward the fold budget, mentions/links don't
  (`tags-fold.test.ts:102-129`); matrix nodes fold-atomic (wsb tests). Pinned.
- **`window` in `matrixViewportSize`** (`RichText.tsx:547-555`): guarded by
  `typeof window === 'undefined'` + type-narrowing; native/test-safe. Not a bug.
- **Avatar/emoji `Image source` URLs** (`RichText.tsx:420`, `LinkCard.tsx:74`):
  server-provided URLs reach `<Image>` unvetted at the call site, but emoji `src`
  is `safeHttpUrl`-gated at parse and RN `Image` cannot execute script schemes —
  worst case is a failed load (`onError` handled). Note, not a bug.

## Quality issues

1. **Duplicated rejoin/scanner logic across three mini-parsers.** `contentFromTranslatedText`
   (`ast.ts:463-557`) and `scanFieldSegment`/`expandFieldText` (`fields.ts:58-142`)
   implement the same lead→token→punct-strip→classify→trail loop with
   near-identical regexes (`TRANSLATED_TOKEN_PATTERN` vs `FIELD_TOKEN_PATTERN` —
   same matrix alternative, same mention shape, translated adds the markdown-
   hashtag alternative). Matrix-first ordering, `splitMatrixMatch`, and
   `stripTokenPunctuation` are triplicated call-sites. Any scanner fix (e.g. B2)
   must land in two places today. Recommend one shared `scanInlineTokens(seg,
   {markdownHashtags: boolean})` helper; both callers keep their emitters.
2. **Duplicated translation-decision logic.** `decideTranslation` /
   `normalizeForCompare` / `hasForeignScript` / `distanceRatio` /
   `editDistanceCapped` / `SUBSTANTIAL_RATIO` exist in **both**
   `packages/fedi/src/misskey/translate.ts:316-395` and
   `src/components/Post/translationPolicy.ts:9-120` with slightly different
   signatures (`result: TranslateResult` vs inline `{sourceLang, text}`; note the
   fedi copy also has a length-gap short-circuit at :352-353 the app copy lacks —
   benign but proof of drift). One should re-export/wrap the other.
3. **Regex complexity concentration.** Four security-adjacent patterns with no
   unit tests on the patterns themselves (only through behavior tests):
   `TRANSLATED_TOKEN_PATTERN` (`ast.ts:392-393`, 4-group alternation),
   `FIELD_TOKEN_PATTERN` (`fields.ts:33-34`), `REMOTE_CODE_PATTERN`
   (`ast.ts:801`), `MATRIX_USERID_PATTERN` (built via string concat,
   `ast.ts:680-682` — readable, good). The global-flag `lastIndex` reset
   discipline (`ast.ts:479`, `fields.ts:59,108`, `ast.ts:808`) is correct but
   relies on every loop remembering it; a shared scanner (issue 1) would centralize
   this. No catastrophic-backtracking shapes spotted (bounded `{1,128}`/`{1,64}`
   classes, no nested quantifiers over overlapping classes).
4. **Allow-list completeness (all deliberately conservative; listed for review, not as bugs).**
   `KNOWN_FN` (`fromMfm.ts:45-68`) degrades unknown `fn` to children — new Misskey
   decorations silently lose styling (correct per policy). `EMOJI_IMG_CLASSES`
   (`fromHtml.ts:114`) misses future emoji markers (image drops; shortcode lost —
   consider emitting the `alt` text as fallback instead of dropping). `DROP_SUBTREE_TAGS`
   omits `picture`/`figure`/`figcaption` (harmless: transparent wrappers degrade to
   children, no subtree drop — correct). `SAFE_PROTOCOLS` excludes `matrix:`/`nostr:`
   links (degrade to text — correct conservatism; revisit only with a tap handler).
5. **Performance: no O(n²).** `mergeMatrixMentions`, `splitRemoteCodes`,
   `expandFieldNodes`, `originalTagsOf`, `collectBareLinkHrefs` are each O(n·depth);
   `convertFlow` calls `isBlankContent` once per block on that block's own subtree
   (amortized O(n)); `editDistanceCapped` is capped DP with early row exit. Feed
   risk is linear React reconciliation in `Inline` (one `Fragment`/`Text` per node,
   `RichText.tsx:728-923`) — fine at post scale.
6. **Test gaps (ordered by value).**
   a. `firstBareUrl` vs server-shortened (text+invisible) links — B1 has zero coverage.
   b. Dotted/bridged handles through translated + field scanners — B2 has zero coverage
      (main-path bridged tests exist: `content-html.test.ts:455-473`).
   c. Non-ASCII `data-tag` (`hashtagTagOf`) — no test.
   d. `plainFromMfm` differential vs `textOf(contentFromMfm(·))` — no test; B4 would
      have been caught.
   e. Emoji edge: `splitRemoteEmojiCodes` on adjacent codes + codes inside link labels
      (opaque? labels re-scan? — `splitRemoteCodes` in `fromMfm.ts:198` recurses into
      *all* children-bearing nodes incl. link labels; harmless but unpinned).
   f. `bareLinkLabel` 48-char server-label cap vs `RichText` title cap — caps tested
      separately, never together.
   g. `quoteUri.ts`/`graph.ts` have their own suites; nothing content-specific missing.

## Top 5 fix priorities

1. **Unify bare-link detection; fix the unfurl gap (B1).** Make `firstBareUrl`
   (`LinkCard.tsx:106`) reuse `bareLinkLabel(node) !== null` instead of its
   stricter inline predicate, so Mastodon server-shortened links get the
   tap-to-unfurl trigger. Add `LinkCard` tests with text+invisible children.
   Medium value, small blast radius.
2. **Widen scanner username classes to dotted handles (B2 + B4).**
   `TRANSLATED_TOKEN_PATTERN` + `FIELD_TOKEN_PATTERN` username class →
   `[\w-]+(?:\.[\w-]+)*`, and the same two spots in `plainFromMfm`
   (`models.ts:65,67`). Add dotted-handle cases to `content-ast`, field, and
   plain-projection tests. Closes the last known Bridgy shredding path.
3. **Extract the shared inline-token scanner (Quality 1).** One helper serving
   `contentFromTranslatedText` and `fields.ts`, owning the matrix-first order,
   `lastIndex` discipline, and lead/token/trail splitting. Prevents the next B2-
   class two-place bug. Mechanical; behavior pinned by existing tests.
4. **Dedupe translation-decision logic (Quality 2).** Single-source
   `decideTranslation` family (fedi owns, app re-exports or vice versa); reconcile
   the length-gap short-circuit difference deliberately. Prevents silent policy drift
   between auto-translate gating and display gating.
5. **Extract `fromTranslated.ts` from `ast.ts` (Responsibility 2).** Move the
   translated-text scanner + its helpers out of the types module; `ast.ts` drops
   from 825 toward ~600 LOC and the "three parsers + one" structure becomes
   visible. Optional, cosmetic, zero behavior change — do last, or fold into (3).
