# 2026-10-16 — tag bubbles + chips + fold + infinite scroll (CW probe deferred)

Goal: implement `docs/tag-bubbles-fold-scroll-handoff.md` workstreams A–D,
probe E time-boxed. Owner live-tests on dvd.chat; browser behavior below is
**not yet verified** here (no browser in this environment).

Owner adjustments applied mid-stream (both override the handoff text):

- Popup/bubble cover pruned block tags ONLY (`blockedTags`); lone inline
  hashtags never enter the bubble.
- Lone hashtags get NO chip or any treatment — byte-identical rendering to
  before. Chips apply to @mentions and links only.
- `docs/spacing.png`: the URL pill inflated its line box (taller line amid
  normal ones). Fixed with `line-height: 1.25` on `.mchip` so border + text
  fit inside one line box.

## What changed (all `frontend/src/`)

- NEW `api/tags.ts` — `parseTagBlocks(text)` → `{ prunedText, blocks,
  blockedTags, allTags }`. Top-level AST runs; whitespace-only text +
  unicode/custom emoji are spacers; lone tags never block. Raw ranges via
  sequential `indexOf` (round-trip-verified against mfm-js 0.27.0);
  unlocatable blocks are skipped, unparseable text returns untouched.
  `allTags` walks nested nodes too (document order); both lists dedupe
  exact-string, first-seen order. `prunedText` trims edges only when a
  range was actually removed, else identity.
- NEW `api/fold.ts` — `foldMfm(text, budget = 750)`. Top-level walk;
  mention/url/link cost 0; everything else costs `toString(node).length`
  (nested content counts at its top-level owner; JS `.length`, no
  code-point counting). Only text/plain slice, at last whitespace ≤ budget;
  tags/emoji/code end the text before them; zero-count nodes kept before
  the cut, dropped after. Unparseable text falls back to a raw
  word-boundary slice.
- `components/MfmRenderer.tsx` — mention and url/link nodes render inside
  `.mchip` pills (MentionLink resolution verbatim; bare URLs show
  protocol-stripped ≤42-char display, full URL target; labeled links keep
  the whole label, CSS ellipsis caps at 280px). Hashtag case untouched.
  `ExternalLink` safety unchanged.
- NEW `components/TagBubble.tsx` — `(#first +N)` button (blocked set:
  first blocked tag, N = count − 1; single-tag fallback `(#tag)`) + popup
  of `/search?tag=` rows. Dismiss (outside click + Escape) copies the
  renote-menu effect. CSS ellipsis, never wraps. One popup per instance;
  outer-head and quote-head bubbles are independent (both briefly open is
  accepted).
- `components/NoteCard.tsx` — `foldText?` prop (default true); header gets
  spacer + bubble from the FULL original text when blocks exist.
- `components/NoteBody.tsx` — `foldText?` prop; RE-suffix → prune → fold
  ordering; pruned text to `TranslatableText`; `folds()` false at depth >
  0. NEW `QuoteHead` (avatar/name/handle·time + spacer + quote bubble from
  the quoted note's full text) so the embed parses once.
- `components/TranslatableText.tsx` — folds the DISPLAYED text (original
  or translation, recounted on arrival) + `…` + `Open post` link
  (`/notes/:id`, `.foldmore`); no inline expand. Tag extraction stays on
  the original.
- `routes/Note.tsx` — main + "Replied to" cards `foldText={false}`; replies
  keep the default fold (their Open-post links point at themselves).
- Notifications inline text (`MfmRenderer` direct) intentionally unfolded
  (fold scope is timelines); search results fold by default.
- NEW `components/InfiniteSentinel.tsx` — shared 800px-rootMargin observer
  (`canLoad`/`onLoad`, `onCleanup` disconnect, no error guard per the Drive
  precedent: failures keep Try-again with remembered cursor, observer only
  refires on intersection changes). Drive keeps its own 400px copy.
- Infinite scroll on all four sites; every `Load older` button + string
  deleted (grep confirms only comments mention it now):
  `TimelineFeed`, `Notifications`, `Note` replies (gained a loading-more
  skeleton + You're-caught-up end state it lacked), `Profile` notes +
  `FollowList` (gained remembered-cursor retry — was reset-to-initial —
  plus loading-more skeleton + end state).

## Workstream E probe (one round, via public dvd.chat endpoints)

- `notes/local-timeline` (no auth): 100 notes, 13 with CW.
- `notes/translate` `{noteId: asdoqc7muf, targetLang: en}` (Chinese CW
  note) → `{"sourceLang":"Chinese","text":"It's not just in the moe
  community; … Thumbs up! 👍"}` — body translation ONLY, no CW, no
  `----` separator. Upstream's `cw + "\n-----\n" + text` shape does NOT
  hold on this fork.
- Second note (English-labeled, booru-tag body) → English body text, again
  no CW field.
- DEFERRED per the handoff's own rule: no string surgery, no code change.
  A second API call is impossible (endpoint takes `noteId`, not text).

## Evidence

- `./node_modules/.bin/tsc --noEmit` → exit 0.
- `npm run build` → green (`dist/assets/index-DlZyU2he.js`, 213.39 kB).
- Unit checks (esbuild-bundle + node, house recipe):
  `./node_modules/.bin/esbuild /tmp/opencode/tags-fold-check.mjs
  --bundle --format=esm --platform=node
  --outfile=/tmp/opencode/tags-fold-check.bundle.mjs && node
  /tmp/opencode/tags-fold-check.bundle.mjs` → **41 passed, 0 failed**
  (emoji/newline spacers, lone-tag non-block, multi-block, blocked-vs-all
  sets, no-double-cover, dedupe order, null/empty/tagless, fold budgets,
  mention/link exclusion, hashtag inclusion, word-boundary cut,
  never-sliced tags, post-cut zero-count drop).
- Live probe outputs above are real `curl` responses from dvd.chat.
- Browser QA (bubble/popup, chips, fold vs detail, seamless scroll on all
  four sites, CW unchanged): **not yet verified** — owner live-testing.

## Open questions / next step

- Owner browser pass on dvd.chat; watch the chipped-line rhythm fix
  (`spacing.png`) and quote-head crowding on narrow widths (bubble may
  wrap under the 4-line clamp — noted, not silently dropped).
- `docs/frontend-plan.md` scope section added; `state/STATE.md` pointer
  updated. Commit follows.
