# Handoff: tag-block bubbles + inline chips + timeline fold + infinite scroll + CW-translation probe

**Audience:** the next Keystone implementer agent. Execute workstreams A–D
in order, then E time-boxed. Verify, log, and commit per `AGENTS.md` §4.

**Before starting:** read `AGENTS.md`, `state/STATE.md`, the latest
`state/logs/` entry, `docs/quote-polish-translate-handoff.md` (how the
last handoff was structured — this one follows the same shape),
`frontend/src/components/MfmRenderer.tsx` (mention/hashtag/link rendering
you will restyle), `frontend/src/api/translate.ts` (the token-scope policy
and unit-check precedent), and `solidjs.md` §10 checklist before returning
Solid code.

**References (in `docs/`):** `beeline_1.jpg`, `beeline_2.jpg`. These are
**functionality references only — do NOT copy Beeline visually.** No
purple, no dark-theme-isms: everything below renders in the Keystone
black/white/grey palette, reusing the existing chip language
(`.rxn`/`.chip` in `global.css`: rounded-full, grey surfaces, hairline
borders). The owner's browser-extension links in screenshots are not UI.

**No new endpoints.** Tag search rides the existing `/search?tag=` route
(`notes/search-by-tag`, verified working — see `Search.tsx:20-37,65-70`).
All work is client-side plus the existing API surface.

---

## Workstream A — tag-block prune + bubble + popup (do first)

**Rule:** two or more consecutive hashtags constitute a **tag block**. A
block is pruned out of the displayed post text, and a bubble takes its
place in the note header.

- **Detection is AST-based, with mfm as the source of truth.** Scan the
  parsed top-level node list for runs of `hashtag` nodes. Nodes that may
  sit *between* tags without breaking the run: whitespace-only `text`
  nodes (including newlines) and emoji (`unicodeEmoji`, `emojiCode`).
  This is the Beeline lesson, stated explicitly: `#a 😂 #b :custom: #c`
  is ONE block of three, because users separate tags with emojis. Any
  other node type (mention, url, link, prose `text`, code, quote, …)
  ends the run. A lone hashtag is NOT a block — it stays inline and
  becomes a chip in workstream B.
- **Prune every block, anywhere in the post** (not just trailing). Map
  each block back to raw-text ranges by sequential `indexOf` from the
  previous match end (tags are short; deterministic enough) expanded over
  the inter-tag spacers, and remove those ranges for display. Persisted
  text is never mutated — view transformation only, same rule as the
  `RE:`-suffix suppression in `NoteBody`.
- **New pure module** `frontend/src/api/tags.ts`: `parseTagBlocks(text)`
  → `{ prunedText, blocks: string[][], allTags: string[] }`. `allTags`
  is every hashtag in post order, **deduped preserving first-seen order**
  (decided here so the implementer doesn't re-decide it). Unit-check it
  the house way: `esbuild --bundle` + `node` over the TS source (see
  `/tmp/opencode/translate-check.mjs` for the exact recipe, including the
  `import.meta.env` define and why plain `node --strip-types` fails).
- **Bubble placement (functionality, not visuals):** header row, right
  side, opposite the author name — as in `beeline_1.jpg`. Wire it in
  `NoteCard`'s `.note-head` (flex row + spacer). Label format is
  `(#tag +N)`: first tag overall, `N` = total tags − 1. Truncate a long
  first tag with CSS ellipsis (`max-width` + `text-overflow`), as Beeline
  does — never wrap the header.
- **Popup:** clicking the bubble opens a floating panel listing the FULL
  tag list (`allTags`, **including tags that never grouped** — owner
  requirement). Each row links to `/search?tag=<tag>` via `<A>` (internal
  routing, same as today's hashtag links). Close on outside click and
  Escape — copy the renote-menu effect in `NoteCard.tsx`, don't invent a
  second dismiss pattern. One popup open at a time per card; stable row
  identity is irrelevant (static list, `<For>` is fine).
- **Tags for the bubble/popup always come from the ORIGINAL note text** —
  never from a server translation (the translator mangles tags; verified
  live `#毎日音楽` → `#DailyMusic`, see
  `state/logs/2026-10-16-translate-scope.md`).
- Quoted embeds go through the same `NoteBody` text path, so pruning
  falls out naturally there; put the bubble in the quote head too via the
  same component. If header crowding forces a different spot, note it in
  the log — don't silently drop the bubble.

## Workstream B — inline chips for mentions, lone hashtags, links

Beeline (`beeline_2.jpg`) renders these as inline pills; copy the
**functionality** in Keystone monochrome inside `MfmRenderer.renderNode`:

- `@mention` → chip linking to the resolved profile (keep the existing
  `MentionLink` resolution verbatim: no link to dead profiles, no refetch
  of misses). Chip text stays the verbatim `@acct` (no extra fetch for
  display names).
- Lone (never-pruned, never-blocked) `#hashtag` → chip linking to
  `/search?tag=` (existing route).
- Bare URLs and `[label](url)` links → chip (truncated display text or
  domain — implementer's call, note it) linking out with the existing
  `ExternalLink` safety (`target="_blank"`, `rel="noopener noreferrer"`,
  `http(s)`-only, unsafe URLs degrade to text as today).
- Keep every existing guarantee: no `innerHTML`, unknown nodes degrade to
  safe text, custom `:emoji:` codes still render literally, the
  `mentionCache` dedupe pattern stays. This also changes notification
  inline text (`Notifications.tsx` uses `MfmRenderer` directly) — that
  consistency is intended, note it in the log.
- Pruned-block ranges from workstream A never reach the renderer (prune
  first, then render), so a chip and a bubble can never double-cover one
  tag. Assert this in the unit checks (a blocked tag appears in `allTags`
  and NOT in the rendered prose).

## Workstream C — fold posts over 750 chars on timelines

Never show more than ~750 chars of full post text in a feed; the reader
opens the note for the rest.

- **Budget (owner rule):** links and mentions do NOT count toward the
  limit; hashtags DO count. Implementation: walk the mfm nodes of the
  (already pruned) text; `mention`/`url`/`link` nodes contribute 0,
  everything else contributes its serialized length (`toString(node)`).
  Emoji count (visible characters). JS `.length` semantics; note it, don't
  gold-plate code-point counting.
- **Cut rules:** keep nodes in order until the budget is spent. Only
  `text`/`plain` nodes may be sliced, at the last whitespace before the
  budget (word boundary). Never slice a hashtag/emoji/code node (a cut
  `#ta` would link wrong) — end before it instead. A zero-count node
  after the cut is dropped; one before it is kept. Append `…` plus an
  explicit link to `/notes/:id` ("Open post" or equivalent — the whole
  point is the reader opens the post, so there is NO inline expand).
- **Scope:** thread a `foldText` prop (default true) through
  `NoteCard → NoteBody → TranslatableText`; `Note.tsx` detail passes
  `false` (full text there). Depth > 0 (quoted embeds) forces no fold —
  the 4-line clamp already governs quotes. Order of operations per note:
  full text → prune blocks (A) → fold displayed text (C). The tag bubble
  always derives from the FULL text, even when the tags folded away.
- **Translation interplay:** fold the *displayed* text (original or
  translation) by recounting with the same rules when it arrives; tag
  extraction still uses the original. A fold-point shift on translation
  arrival is accepted (note it, don't fight it).

## Workstream D — infinite scroll everywhere, no "Load older"

Kill every paging button; the Drive file list is the house pattern
(`DriveBrowser.tsx:434-453`: `IntersectionObserver` sentinel,
`rootMargin` preload, `onCleanup` disconnect, guards mirroring `load`).

- **Sites (all four):** `TimelineFeed` (covers home/local/global/antennas
  — one change), `Profile` follow lists + profile notes (two sentinels),
  `Notifications`, `Note` replies. `Search` is single-shot (no paging) —
  leave it alone.
- **Seamlessness (owner requirement):** use a generous `rootMargin`
  (`800px`) so the next page is already loading before the user reaches
  the bottom — the scroll should never visibly stall. Keep the existing
  guards (busy/loading/exhausted/error/empty), the loading-more skeletons,
  the "Try again" error path with its remembered cursor, and the
  "You're caught up" end state. Delete the `.pager` buttons and their
  "Load older"/"Load older replies" strings entirely — no dead UI, no
  feature-flagged fallback.
- Suggested (not mandated): extract the ~15-line observer setup into one
  shared helper since it lands in four places; the Drive copy stays as-is
  unless the helper is a clean drop-in. Note the choice in the log.

## Workstream E — content-warning translation (probe, time-boxed, deferrable)

The owner explicitly allows leaving this: *"if we cant do this serverside
its okay, leave for now."* Do this workstream LAST, capped at one probe
round:

1. Probe `notes/translate` on a real CW note from dvd.chat (grab one off
   the local timeline). Upstream Misskey sends `cw + "\n-----\n" + text`
   in a single call — check whether the dvd.chat fork's result contains
   the translated CW plus that separator.
2. Implement ONLY if the shape splits cleanly: show the translated CW in
   the `.cwbox` in place of the original whenever the translated body
   shows (same toggle restores both — one toggle, two strings, no second
   control). The CW gate stays: nothing translates or displays until the
   viewer reveals.
3. Otherwise (no CW in the result, no clean separator, any ambiguity):
   do NOT ship string surgery — record the probe output in the log and
   defer. A second API call is impossible (the endpoint takes `noteId`,
   not text), so there is no client-side fallback worth building.

## Verification (all workstreams)

- `npx tsc --noEmit` clean; `npm run build` green.
- Unit checks run by execution (esbuild-bundle + node precedent):
  block detection (emoji/newline spacers, lone-tag non-block,
  multi-block, no-double-cover), fold budgets (mention/link exclusion,
  hashtag inclusion, word-boundary cut, never-sliced tags), and the
  empty/error states.
- Exercise in a real browser against dvd.chat: multi-tag post with emoji
  spacers (pruned + bubble + popup + per-tag search), lone-tag chip,
  mention/link chips, >750-char post folded in feed and full on detail,
  seamless scroll on all four sites (no stall, no duplicate pages, error
  retry intact), CW behavior unchanged. No browser here means screenshots
  or it didn't happen — paste real output in the log.
- Update `state/STATE.md`, append one dated
  `state/logs/YYYY-MM-DD-<topic>.md` log, commit. Never rewrite past
  logs. Keep `docs/frontend-plan.md` accurate (new scope section).

## Non-goals

Beeline's visual design (colors, purple pills, dark-theme styling, icon
set), inline expansion of folded posts, folding inside quoted embeds,
unpruning controls, search-result pagination, new endpoints, Pinetree
server work, animation on bubbles/popups.
