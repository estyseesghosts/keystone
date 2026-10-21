# 2026-10-21 — WS-B content rendering — subagent

Branch: `pB-content` (base `main@eb37e02`)
Goal: WS-B — MFM decorations, `span.mchip`/invisible spans, MD4 sanitizer
remainder, TagBubble, `auto`/`plain` confirmation + storage schema fix.

## Did

- **MFM decorations (F14).** `fromMfm.ts` already parses every required fn
  (`KNOWN_FN` covers x2/x3/x4/size/scale/color/bg/blur/rotate/font/small/
  center + spin) with `name + args + children`, so no parser change.
  Implemented rendering in `RichText.tsx` (`Fn`): x2/x3/x4, size/scale
  (clamped 0.5–4, real mfm-js 0.27 arg shapes incl. `$[size.2 …]` flag
  keys), small (0.85x), color/bg (`#rgb`/`#rrggbb` allow-list only),
  rotate (clamped ±360), font (monospace/serif mapping only), center
  (top-level hoists to a block `View` so alignment applies; nested stays
  best-effort inline). `blur`, motion (`spin`, `tada`, …) and unknown fns
  degrade to children — content never dropped, effects never faked.
  Size threads through `Ctx` so nested decorations compose
  multiplicatively (caught by test: `$[x2 $[small …]]` = 15·2·0.85).
- **`span.mchip` / invisible.** `fromHtml.ts`: `span.invisible` now emits an
  `invisible(text)` AST node (new kind) instead of dropping — zero-width
  (`\u200B`) at render, excluded from `textOf`/`plainTextOf`/fold budget/
  blank checks; `span.mchip` degrades transparently (chip inline via its
  anchor child), explicitly coded + tested. New AST kinds `bullet`,
  `heading(level)`, `invisible` with constructors + reader cases
  (`textOf`: bullet → `• `, invisible → nothing).
- **MD4 remainder.** `li` → `bullet()` marker nodes (renderer owns the
  glyph; empty items skipped — old code rendered a stray `• `), headings
  → `heading(level, children)` (styled by level: h1 +6 … h6 −1, bold;
  blank headings skipped). Blocks→`br` pairs untouched.
- **TagBubble (F10).** New `src/components/Post/TagBubble.tsx`
  (`(#first +N)` toggle → `AnchoredPopup` with one row per tag, tag-route
  navigation default, `null` with no tags). `body.ts` appended
  `postTagBubble` (MFM: blockedTags / HTML: allTags incl. lone tags when a
  block was pruned — v1 `NoteCard.tagView` parity), `pruneMfmTagBlocks`,
  `pruneHtmlTagBlocks`; `postBodyNodes` prunes (MFM: strip→prune→parse;
  HTML: parse→prune→marker-strip — v1 pipeline order). Mounted in
  `PostCard` header end + `PostQuote` head end (HTML quotes follow the
  card rule; v1 had no HTML-quote bubble). No-op without blocks.
- **`auto`/`plain` + schema.** Confirmed: `auto` renders the full tree
  (never raw MFM source), `plain` renders `plainTextOf` (decorations
  projected, invisible dropped, bullets/headings kept). No v1
  `html|mfm` force-modes anywhere (`grep contentMode src` = device
  `auto|plain` only). Fixed `src/storage/schema.ts:109`:
  `defaultAccountState.prefs` was `{contentMode:'mfm'}` (invalid against
  the empty-object `accountPrefsSchema`); now `{}`. Checked every
  reader/migration/test touching account prefs: `readAccountState` /
  `writeAccountState` (`storage/index.ts`), `schema.test.ts`,
  `index.test.ts` — no other consumers; zod strips unknown keys so old
  `{contentMode:…}` payloads read as the new default.
- Catalogs: `lingui extract --clean --locale en` + `compile` for the two
  new TagBubble strings (`Show tags`, `Tags`); other locales fall back to
  source (W7 English-only precedent).

## Decided (proposals for `docs/DECISIONS.md` — coordinator owns the file)

- Motion MFM fns render statically (renderer is motion-free; reduced
  motion is the safe default; per-node loops would cost every list).
- `blur` degrades to children (no honest RN text-blur primitive).
- `invisible` is an AST node, not a drop (structure survives; renderer
  guarantees zero-width, readers guarantee exclusion).
- HTML quote heads follow the card bubble rule (v1 had MFM-only quote
  bubbles; bodies prune on both paths so the tags must surface).
- Empty `<li>` renders nothing (old code left a stray `• `).

## Tests / verification (exact commands + results)

- `./node_modules/.bin/tsc -p tsconfig.check.ios.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.android.json` → exit 0
- `./node_modules/.bin/tsc -p tsconfig.check.web.json` → exit 0
- `eslint` on all 19 touched/new files → clean (4 scoped
  `no-hardcoded-color` disables in `richtext-wsb.test.tsx`: the hexes are
  server-provided MFM args under test, not UI chrome)
- `oxlint --quiet src` → clean
- `NODE_ENV=test ./node_modules/.bin/jest --forceExit --testTimeout=20000`
  → **131 suites / 1567 tests pass** (baseline 127/1521 → +4 suites,
  +46 tests: content-wsb 8, richtext-wsb 15, body-tags 13, tagbubble 5,
  schema +2, MD4 block +3 net)
- The only console noise is the pre-existing `setContentMode`-outside-act
  pattern shared with `richtext.test.tsx` (store emit in `finally`).
- Web-visual (Helium CDP :9222, expo web :8092 serving THIS tree,
  Akkoma :4000 authed akk1): posted 3 showcase statuses via API, signed
  in through the app Login UI, screenshotted, then deleted all three
  (writes cleaned):
  - `state/logs/assets-wsB/04-feed-rail.png` — MFM decorations render
    (`big` large, `tiny` small, mono `code`, rotated `tilt`, static
    `static`, centered `centered`), tag post shows `(#wsbtagone +2)`
    with pruned body, long-URL post renders.
  - `state/logs/assets-wsB/05-feed-phone.png` — phone layout, bubble +
    pruned body visible.
  - `state/logs/assets-wsB/06-bubble-open.png` — bubble popup lists
    `#wsbtagone/#wsbtagtwo/#wsbtagthree`.
- NOT visually verified (jest-verified instead): invisible-span rendering
  (this Akkoma emits full URLs, no shortening spans — Mastodon-shaped
  fixtures pin the contract), quote-head bubble (no quote fixtures on
  the rig), headings/bullets (unproducible via plain-text API posts),
  Oppo/iOS/TalkBack (still blocked, per STATE).

## Deviations (outside the ownership list — all additive, compile-forced)

- `packages/fedi/src/core/content/ast.ts` — new node kinds (required:
  `fromHtml` cannot emit bullets/headings/invisible otherwise).
- `packages/fedi/src/mastodon/presentation.ts` — `atomCost`/`isAtomic`
  arms for the new kinds (TS exhaustiveness forced it).
- `packages/fedi/src/mastodon/quoteMarker.ts` — `flatten` arms
  (bullet/invisible → `other`; same force).
- `src/locale/*` — mechanical `lingui extract+compile` (2 new keys +
  line-ref churn, W8 precedent).
- `scripts/fedi-wsb-showcase.ts` — created for the visual, then DELETED
  (outside ownership; method: registerApp+passwordGrant akk1, createPost
  ×3 with the texts in this log's verification section, delete after).
- v1 reference consulted read-only (`~/Local Documents/Keystone/
  frontend/src`): `components/MfmRenderer.tsx:242-330` (fn shapes),
  `components/HtmlBody.tsx:105-133` (real h1–h6/li), `components/
  TagBubble.tsx` (bubble+popup), `components/NoteCard.tsx:146-160,277-278`
  (tagView + head mount), `components/NoteBody.tsx` (QuoteHead, pipeline
  order), `api/tags.ts` (parseTagBlocks), `state/contentMode.tsx` +
  `components/ContentBody.tsx` (v1 force-modes, not reintroduced),
  `mastodon/sanitize.ts` (class allow-list). Nothing copied.

## Next

- Coordinator: tick all five WS-B boxes in `docs/V2_GAPS.md`; record the
  five proposed DECISIONS lines; merge `pB-content`.
- Expo :8092 (this tree, with changes) left RUNNING for owner review.
- WS-A/WS-F/WS-C owners: `RichText.tsx` gained `bullet`/`heading`/
  `invisible`/`fn` rendering + `Ctx.align`; `body.ts` hunks are the
  import-alias lines, the two `postBodyNodes` return wraps (marked
  `WS-B (F10)`), and the appended section — quote-strip function itself
  is byte-identical.

STATUS: complete.
