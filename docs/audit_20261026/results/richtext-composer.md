# Richtext & composer audit — Keystone v2 (2026-10-26)

Scope: `packages/fedi/src/core/content/*` (`ast.ts`, `fromHtml.ts`, `fromMfm.ts`,
`fields.ts`, `fromTranslated.ts`), `src/components/RichText.tsx`,
`src/components/richtext/*` (`mentionRouting.ts`, `fnStyle.ts`, `MatrixHover.tsx`),
`src/components/Post/LinkCard.tsx` (`firstBareUrl`, `UnfurledLinkCard`),
`src/components/EmojiImage.tsx` (`CustomEmojiGlyph`), `src/components/Composer/*`
(`Composer.tsx` attachments edit/remove during submit, alt editing, poll durations,
char limits, sensitivity/language draft fields, idempotency/attempt keys,
double-submit guard; `ComposerSections.tsx`; `CompactComposer.tsx`; `pickMedia.ts`),
`packages/fedi/src/api/composer.ts`, `src/state/queries/composer.ts`
(`uploadAll`, `useUploads`), `packages/fedi/src/mastodon/{backend,compose,endpoints}.ts`,
`packages/fedi/src/misskey/noteBody.ts`. Read-only audit; no source modified.
Nesting-depth/throw claims for `contentFromHtml`/`contentFromMfm` were measured with a
throwaway jest test (`packages/fedi/test/__audit-tmp.test.ts`, deleted afterwards).

Prior report: `docs/audit_20261025/results/richtext-composer.md` (F1–F13).

## Summary

13 of the 13 prior findings are fixed or substantially fixed: F1 (edit attachments),
F2 (edit drafts), F4 (`$[x4]` compounding — parse-time flatten past size-depth 2 plus a
4x-base render clamp), F5 (HTML depth throw — depth cap 32, 200 KB input cap, full
try/catch; re-measured 2026-10-26: `<b>`x5000, `<ul><li>`x3000, `<blockquote>`x3000,
`<h1>`x500, 100k spans all return without throwing in 287 ms total), F6 (link
mismatch disclosure + confirm), F8 (`numberOfLines` vs blocks), F9/F10/F11/F12/F13.
F3 (edit/remove during submit) and F7 (emoji-img arbitrary URL) are fixed on the main
paths with residuals on side paths.

7 new findings, all verified by code reading against `file:line`: N1 (MEDIUM, poll +
reaction controls live in edit mode but never reach the server), N2 (MEDIUM,
idempotency helpers still have no production caller — timeout-then-retry double-posts),
N3 (LOW/MEDIUM, create-mode submit has no attachment busy gate — mid-submit picks are
silently cleared, redraft seeded-removes still attach), N4–N7 (LOW: packed-less emoji
surfaces, profile-shape mention disguise, heading-nesting growth, compact close dialog).

## Findings

### N1 - MEDIUM - Poll and reaction controls are usable in edit mode but never reach the server

`src/components/Composer/Composer.tsx:1410-1427` (poll chip has no `editing` gate, only
`editBusy`), `src/components/Composer/ComposerSections.tsx:170-245` (`PollSection`
renders whenever `state.poll != null`), `Composer.tsx:1467-1484` (reactions row has no
`editing` gate). The `editing` prop doc (`Composer.tsx:135-140`) claims
"Reply/quote/schedule/poll controls are hidden" — reply/quote/schedule are, poll is not.

- Mastodon: the edit submit builds the same draft shape as create
  (`Composer.tsx:727-757`), and `editStatus` sends the full `StatusBody` verbatim
  (`packages/fedi/src/mastodon/endpoints.ts:902-912`), including `poll`
  (`packages/fedi/src/mastodon/compose.ts:156-176`). `PUT /api/v1/statuses/:id`
  accepts no poll param, so the poll is stripped server-side while the UI reports
  "Saved". A user who adds a poll to an edit gets success + no poll.
- Misskey: `createEditNoteBody` (`packages/fedi/src/misskey/noteBody.ts:93-112`)
  forwards `poll` (honest 4xx on rejection) but has no `reactionAcceptance` line, so
  the reactions row shown in edit mode is a no-op there.
- Secondary: `buildPostDraft` only emits `noQuote: true`
  (`packages/fedi/src/api/composer.ts:654-658`), never `false`, so unchecking "No
  quotes" in an edit omits the field and a prior refusal silently stays (the Misskey
  edit body supports explicit `false` to lift it — `noteBody.ts:104-107` — but the
  composer never sends it). Edit-mode `isCloseDirty` (`Composer.tsx:972-993`) does not
  compare `reactionAcceptance`/`noQuote` either, so those toggles don't even mark dirty.
- `isCloseDirty` treats any `state.poll != null` as dirty, so a poll added to an edit
  (which can never save, per above) still triggers the discard guard.

Fix: hide/disable the poll toggle and reactions row in edit mode like schedule
(already `!editing`-gated at `Composer.tsx:1441`), or wire them through where the
server supports it; emit `noQuote: false` on edit when the toggle is off.

### N2 - MEDIUM - Timeout-then-manual-retry still double-posts: stable attempt keys have no production caller

`packages/fedi/src/mastodon/backend.ts:609-615` (`createPost` mints
`newIdempotencyKey()` per call) and `:1656-1663` (`scheduled.create`, same).
`attemptKeyFor` / `stableIdempotencyKey` / `attemptKeyForBody`
(`packages/fedi/src/mastodon/compose.ts:200-242`, TTL 5 min) have no production caller
— grep finds only tests (`packages/fedi/test/crypto-random.test.ts`) and docs. The
comment at `compose.ts:210-214` says "the composer-side caller (X6.2) resolves the key
through here", but the composer path (`useCreatePost` → `submitPost` →
`backend.createPost`, `src/state/queries/composer.ts:186-215`) threads no key, and the
2026-10-25 repair log (`state/logs/2026-10-25-repair25-x2.1.md:37`) left the backend
threading as a follow-up for the backend owner. Scenario: Post tap → request times out
after the server stored the status → error shown → user taps Post again → fresh key →
server creates a duplicate. (Misskey `notes/create` has no idempotency mechanism at all
— server limitation, noted for completeness.) The quote-refusal retry posts a changed
body, so a fresh key there is correct per the fingerprint rules.

Fix: thread `attemptKeyForBody` (session-prefixed fingerprint) into `createPost` +
`scheduled.create` per the repair-log handoff.

### N3 - LOW/MEDIUM - Create-mode submit has no attachment busy gate (edit mode was fixed, create/redraft was not)

The F3 repair gated Remove/alt/poll/CW on `locked = editing != null && busy`
(`ComposerSections.tsx:247-252`, `:401`, `:51`, `:175`). In create mode everything
stays live during submit (`Composer.tsx:816-819`, `:868-930`):

- `addMedia` has no busy gate (full `Composer.tsx:1428-1440`, compact
  `CompactComposer.tsx:303-312`). Files picked mid-submit land in `uploads` after
  `uploadAll` snapshotted its `live` list (`src/state/queries/composer.ts:671`), so the
  post goes out without them — and `resetAfterPost` then calls `uploads.clear()`
  (`Composer.tsx:669-688`), silently discarding files the user just picked.
- Seeded-remove in redraft (create mode with seeded media, `locked` false): the
  post-submit `allMedia()` closure reads press-time `state`
  (`Composer.tsx:816-819`), so a seeded attachment removed mid-submit is still sent.
- Visibility/text/CW/poll edits mid-submit are likewise silently excluded from the
  in-flight post (press-time state is rebuilt into `built`), with no indication the
  post went out without them.

`uploadAll` itself is safe (removed keys are skipped, `:678-682`), so the failure mode
is silent exclusion/loss, never a crash or a wrong attachment. Fix: extend the busy
gate to create mode (disable add/remove/alt/poll/visibility while `busy`), or snapshot
and honour the user's final intent.

### N4 - LOW - Packed-less `RichText` surfaces still load any https emoji-img URL (F7 residual)

The AST half now forces https-or-text (`fromHtml.ts:396-420`) and the UI half only
loads a node `src` when it matches the packed map — but only when a packed map is
provided (`src/components/EmojiImage.tsx:143-156`: `packedUrls === null` →
`trustedSrc = safeSrc`, i.e. any https URL loads). These callers pass no `emojis`:

- `src/screens/Announcements.tsx:111` (Mastodon-family announcement HTML is
  admin-authored on the user's own server — low exposure),
- `src/screens/NoteHistory.tsx:69` (revision bodies — federated content, the highest
  exposure of the four),
- `src/screens/AdminInsight.tsx:323` (own-server description),
- `src/screens/Drive/rows.tsx:379` (own posts).

Scenario: `<img class="emoji" alt=":a:" src="https://tracker.example/p.gif">` in a
federated edit-history revision fires a third-party fetch (IP leak / tracking pixel)
on render. Post bodies, bios, fields, quotes, and notification excerpts all pass
packed maps and are unaffected. Fix: pass the packed map (or `emojis={{}}` to force
literal-`:code:` rendering) at the four call sites.

### N5 - LOW - `<a class="mention">` with a profile-shaped href and arbitrary label still renders a profile chip (F6 residual)

`isMentionChip` (`packages/fedi/src/core/content/ast.ts:481-490`) grants chip status
for any profile-URL-shaped href regardless of label; `convertAnchor`
(`fromHtml.ts:339-346`) and the renderer (`RichText.tsx:541-546`) follow the same rule.
Scenario: `<a class="mention" href="https://evil.example/@victim">Click to verify</a>`
renders as an avatar profile chip with attacker-chosen text. Containment holds: the tap
resolves in-app (`defaultMentionPress`, `mentionRouting.ts:118-143` — profile URL →
`openMentionProfile`, never the browser), so this borrows profile-chip trust for
display/redirect-to-account, but cannot exfiltrate to an external URL. Fix: require a
handle-shaped label for the chip (as the plain-link path already does), demoting
display-text labels to links.

### N6 - LOW - Nested headings compound font size without a clamp (F4 residual)

`RichText.tsx:630-637`: each `heading` level adds `headingDelta` (up to +6) with no
accumulated-size clamp (unlike the `fn` path, `:189`). HTML heading nesting is capped
only by `MAX_DEPTH = 32` (`fromHtml.ts:67`), so 32 nested `<h1>` render the innermost
run at ~207 px and blow out the row. All inline parse trees are depth-capped so this is
bounded (not a crash), and collapsed surfaces fall back to the plain-text projection
(`RichText.tsx:793-806`), but an uncollapsed hostile post still makes a giant feed row.
Fix: clamp heading size like `fn` (`Math.min(size, baseSize * 4)` or flatten nested
headings at parse time).

### N7 - LOW - CompactComposer shows Save/Discard/Keep in edit mode; full Composer does not

`src/components/Composer/CompactComposer.tsx:530-532` always renders
`CloseConfirmDialog` (with "Save draft"), while the full `Composer` switches to
`EditCloseDialog` in edit mode (`Composer.tsx:1314-1320`, the F2 repair). In edit mode
`saveAndClose` is a plain close with no draft writes (`Composer.tsx:1015-1019`), so on
the compact chrome "Save draft" mislabels a discard-guard close. Same `testID`s, so
existing close-guard tests pass either way. Fix: branch on `c.editing` in
`CompactComposer` like the full composer.

## Looked solid

- Throw contract: `contentFromHtml` (`fromHtml.ts:579-602`) — 200 KB input cap, depth
  cap 32 with plain-text degradation, outer try/catch plus non-throwing `fallbackNodes`;
  `innerText` iterative; `coalesceText`/`mergeMatrixMentions` recurse only over
  depth-capped trees. Measured 2026-10-26: no throws, 287 ms total for all adversarial
  inputs (throwaway test, since deleted). MFM nesting likewise fine (mfm-js bounds it;
  `MAX_FN_DEPTH = 8`, `MAX_SIZE_DEPTH = 2` in `fromMfm.ts:91-95`).
- URL policy (`ast.ts` `safeUrl`/`safeHttpUrl`): http/https/mailto-only, control-char,
  credential, length, and relative-URL rejection intact; `mailto:` never a bare chip or
  image source.
- Link disclosure: `mismatchForLink` + `MismatchLink` (disclose `-> host` + confirm)
  wired on all three parsers including profile fields (`fields.ts:130-133`); mismatch
  links are exempt from the lone-link chip-hiding rule (`RichText.tsx:479-484`) and can
  never source an unfurl card (`firstBareUrl` only takes bare links,
  `LinkCard.tsx:111-140`, quote-covered URIs skipped).
- Mention routing: handle/matrix/hashtag label rules drop or reroute redirect hrefs
  before any browser open; `vettedExternalUrl` re-vets at open time
  (`mentionRouting.ts:22-27`).
- Unfurl predicates: `isPublicHttpsUrl` gates page, image, and icon fetches
  (`LinkCard.tsx:168-171, 227-234`; `packages/fedi/src/api/linkpreview.ts:409-411`);
  non-public URLs keep the honest basic card with no trigger; auto-unfurl only for
  public posts under the opt-in pref.
- Scanner regexes (`FIELD_TOKEN_PATTERN`, `TRANSLATED_TOKEN_PATTERN`,
  `REMOTE_CODE_PATTERN`, matrix patterns): no nested-quantifier ambiguity; 100k-span
  input converts in 116 ms (measured); markdown/tag/matrix precedence (matrix-first) is
  uniform across HTML/MFM/field/translated paths with the post-scan merge.
- MFM `fn` args allow-listed (`safeHexColor`, `safeFontFamily`, `clampNum` in
  `richtext/fnStyle.ts`); unknown fns degrade to children at parse; `fg` present
  (`fromMfm.ts:66`); `ol` numbering, table cell spacing, non-emoji `alt` fallback, and
  linear `coalesceText` all in place.
- Double-submit guard: synchronous `submitRef` single-flight plus `busy`-disabled
  submit button on both chromes (`Composer.tsx:690-694, 1231`;
  `CompactComposer.tsx:381`); save-and-close has its own ref (`:1028`); quote-refusal
  retries exactly once without the quote.
- Char limits: fallback limits warn instead of blocking (`limitsUnverified`,
  `Composer.tsx:294-296, 1231`); limits fetch retries with backoff
  (`api/composer.ts:161-178`); Mastodon URL trailing-punctuation counting fixed
  (`:85-112`); CW caps enforced per family (`:571-580`); poll option length/dup/duration
  bounds enforced when reported (`:534-556`); schedule 5-minute floor enforced in UI
  and domain (`Composer.tsx:710-717`, `api/composer.ts:606-610`).
- Sensitivity/language: Mastodon-only wire fields, draft snapshot/restore round-trips
  them (`Composer.tsx:176-177, 186-207`), picker hidden when unreported; per-kind
  server byte caps with the heap bound as fallback (`api/composer.ts:758-828`,
  `pickMedia.ts:178-194`); whole-file reads avoided on native.
- Composer edit core (F1/F2/F3-edit): explicit `keepMediaIds`
  (`Composer.tsx:750-753`), no autosave/pointer/draft writes in edit mode
  (`:478-479, 759-764, 1015-1019, 1084-1092`), seeded alt/remove frozen while saving
  (`ComposerSections.tsx:247-252, 395-444`).
- Autocomplete trigger is unicode-aware with a shared replace range
  (`api/composer.ts:736-746`); `insertCreatedPost` excludes DMs/followers-only/replies
  from shared timelines (`src/state/queries/composer.ts:132-171`).
