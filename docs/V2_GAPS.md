# V2_GAPS — next implementer handoff

Status: open · Created 2026-10-21 · Source: post-W8 audit (6 parallel subagents, source-verified against `~/Local Documents/Keystone/frontend/src`).

This is the build list. `docs/parity-gaps.md` is history; this file is what you execute. One workstream per branch, land green before starting the next except where marked `PARALLEL-SAFE`.

## Ground rules (non-optional)

1. **Use subagents.** Spawn one `general` subagent per workstream below (`WS-A`…`WS-G`). Do independent workstreams in parallel. Each subagent gets its row IDs + file paths only — no shared files except `RichText.tsx`, `PostCard.tsx`, `Navigation.tsx`, `routes.ts` (coordinate those, do not double-edit).
2. **Verify like W1–W8:** `pnpm typecheck && pnpm lint && pnpm test` green, pasted in the session log. UI rows need Helium or device evidence or write `not verified`. Data rows need rig evidence (`:4000` Akkoma live; `:3101`/`:3102` down = `not verified`, never faked).
3. **Commit when done.** Each finished workstream: update `state/STATE.md`, append `state/logs/YYYY-MM-DD-<ws>.md`, check boxes here, then commit on its branch (`p<v>.<n>-<topic>`). Do not batch unrelated WS in one commit.
4. Keep `packages/fedi` pure TS (no react/native, no wire types in `src/`). Every new action stays behind a `Capabilities` flag. Record deliberate non-fixes in `docs/DECISIONS.md` before coding.
5. `auto|plain` is the final content-mode semantics (owner-confirmed): **`auto` always renders MFM.** `plain` renders the plain-text projection. Do not reintroduce v1 `html|mfm` force-modes. Fix `storage/schema.ts:109` (`defaultAccountState.prefs` carries invalid `contentMode:'mfm'`) as part of WS-B.

---

## WS-A — Quotes, full-mile (SPECIAL CASE, do first or in parallel, owns `PostQuote`/`body.ts`)

v1: `NoteBody.tsx:262-399,411-424,497-536`, `misskey/quote.ts`, `mastodon/quoteMarker.ts`. v2 today: structured renote renders, `resolveQuoteUri` (`misskey/quote.ts:320`) has no `src/` caller, `PostQuote.tsx:74-102` is authorized-only shaped.

Policy (owner directive): **show all quotes by default.** Mastodon "authorized quotes" is a filter, not the data model. Add Settings → Display (or Feeds) toggle `Only show authorized quotes` (default OFF, persisted per device). When ON, hide unauthorized quote cards behind a tap-to-reveal row; when OFF (default), render everything below.

Build:
- [x] Misskey structured renote path stays; `resolveQuoteUri` fallback WIRED 2026-10-21 (WS-A): warm → success renders `PostQuote`, failure renders inline `RE:`-stripped body + "unavailable" label, resolving indicator included. No fedi changes (impls + TTL caches already existed).
- [x] Mastodon: `adapt` display kept; `resolveTextualQuote` fallback WIRED 2026-10-21 (WS-A) via the backend method (TTL cache reused, not rebuilt). Proven live on Akkoma (`RE: <url>` → resolving → resolved card, marker stripped).
- [x] `body.ts` strip logic DONE 2026-10-21 (WS-A): `postBodyNodes(post, {coveredQuoteUris?})` — marker stripped only when its card renders/resolves, else visible. MFM + HTML covered. (Note for WS-B merge: route tag-block coverage through `postBodyNodes`, not around it.)
- [x] Settings toggle + gating DONE 2026-10-21 (WS-A): Display-section `QuotePolicyRow`, device-local `onlyAuthorizedQuotes` (default OFF); ON hides unauthorized cards behind tap-to-reveal. Tests: structured, URI-fallback success/fail, shown-by-default + hidden-when-opt-in, strip/keep matrix (17 + 5 new). `not verified`: Misskey-family card, live unauthorized-conceal (no rig fixture; unit-proven).

Acceptance: Misskey renote, Mastodon quote, and bare `RE:` URL all yield cards by default; opt-in hides unauthorized with reveal.

## WS-B — Content rendering: MFM, `span.mchip`, sanitizer, TagBubble (PARALLEL-SAFE vs A/C, conflicts on `RichText.tsx` — serialize edits inside this WS)

- [x] **MFM decorations (F14).** DONE 2026-10-21 (WS-B): `$[x2/x3/x4/size/scale/small/color/bg(hex-only)/rotate/font(mono+serif)/center]` + spin in `RichText`; blur/motion/unknown → children (motion-free renderer; per-node loops cost lists). Allow-listed, no WebView. Tests per fn. Proven live on Akkoma (showcase post, screenshots).
- [x] **`span.mchip`.** DONE 2026-10-21 (WS-B): `invisible` is an AST node (`invisible(text)`), not a drop — structure survives, renderer zero-width, readers exclude; `mchip`/hashtag chips → chip inline. Regression tests prove invisible text never renders visibly (jest; live Akkoma emits full URLs, no shortening spans — `not verified` live).
- [x] **MD4 sanitizer remainder.** DONE 2026-10-21 (WS-B): `li` → real `bullet()` nodes (empty `<li>` renders nothing, was stray `• `), headings → `heading(level)` styled headings. Blocks→`br` pairs kept.
- [x] **TagBubble (F10).** DONE 2026-10-21 (WS-B): new `TagBubble.tsx` (`(#first +N)` + popup tag rows), mounted in card headers + quote heads; `postTagBubble`/`pruneMfmTagBlocks`/`pruneHtmlTagBlocks` in `body.ts` (prune order: MFM quote-strip→tag-prune, HTML tag-prune→marker-strip). No-op without blocks. Proven live on Akkoma.
- [x] `auto` = full MFM always; `plain` = projection — CONFIRMED 2026-10-21 (WS-B). Schema bug FIXED: `defaultAccountState.prefs` `{contentMode:'mfm'}` → `{}` (+2 tests). Merge note: coordinator removed a duplicate `quoteStatus` in `PostCard.tsx` (WS-A's `quoteTarget`-keyed version kept; WS-B's recompute dropped) and re-ran `lingui extract+compile` (adds `Show tags`).

Acceptance: MFM showcase post renders decorations; invisible spans hidden; tag posts show bubbles with pruned bodies; `auto` never shows raw MFM source.

## WS-C — Emoji: remote + custom + picker store (MK8) (PARALLEL-SAFE)

- [x] **Remote emoji fallback.** DONE 2026-10-21 (WS-C): `remoteEmojis()` (+ reference-stable cache) on the fedi store; `src/state/customEmojiStores.ts` per-session registry (`customEmojiStoreFor`, rebuilt on origin/token/family drift) + `useCustomEmojiSelect` live selectors; `EmojiImage` chain packed → remote-host → author-host → session listing → literal (never blank). Live probe 8/8 on Akkoma (remote listing `misskey.io`, 14,019 entries; images 200; writes cleaned). Web-visual `not verified` (Helium CDP closed).
- [x] **Display-name emoji.** DONE 2026-10-21 (WS-C): `DisplayName`/`ProfileHeader`/`NotificationRow` accept optional `sessionId` (explicit → active session → packed-only); remote display-name/bio verified regressed, now fixed + tested.
- [x] **MK8 picker.** DONE 2026-10-21 (WS-C): picker store-backed (local + remote-host tables), react-query kept for Mastodon-family, per-session recents cap 24, Remote search section (query-only, cap 60); `unavailable` omits Custom, `error` + Retry re-arm both sources.

Acceptance: `:name@host:` post + remote display-name render images; picker shows remote-host emoji; retry works on error.

## WS-D — Post menu C16 + mute/block/report + translations (PARALLEL-SAFE vs A/B)

v1 `NoteMenu.tsx:421-668`. v2 `menuModel.ts:59-227`, `PostHandlers.tsx:49-65`.

- [x] Wire with honest gating — DONE 2026-10-21 (WS-D): report live via `UserActionHandlers.onReport` (hidden own-post, disabled-with-reason signed-out/unconnected, comment-required confirm otherwise + toast); boost flips re-read `relationships` into cache; clip add-to-clip flow kept (Misskey-family; mastodon honest row); antenna/memo/DM/notify/RSS/search-notes/refresh-remote stay disabled with reasons. No `PostCard.tsx` edit. Live caveat: mute/block/report writes + translate-success unproven on Akkoma (single-user rig, reports non-retractable); translate refusal + menu shots proven live via Helium.
- [x] **Mute boosts** — DONE 2026-10-21 (WS-D): two-way already W4; this WS fixes stale `Not wired yet` copy → `This server has no repost-mute list.`
- [x] **Translations (MK3 consumer).** VERIFIED + extended 2026-10-21 (WS-D): gated menu row + `PostCard` translate kept, per-post retry/error added, still gated on `translatorAvailable`; live Akkoma refusal (`Translation is not enabled`) proven end-to-end via toast.

Acceptance: menu rows never inert; mute/block/report round-trip or honest reason; translate works or is gated with reason.

## WS-E — Misskey correctness: drafts, like key, pinetree polls, reactionActions, menu copy (PARALLEL-SAFE, fedi-only + one `src/` touch)

- [x] **Misskey drafts dupe (MK6/Q6).** DELETED 2026-10-21 (WS-E): `packages/fedi/src/misskey/drafts.ts` removed (zero `src/` importers ever; dead `carryLegacyDrafts` gone with it). Authority stays `src/storage/drafts.ts`. Register MK6 ticked.
- [x] **MK13 like capability key.** DONE fedi-side 2026-10-21 (WS-E): `"like"` in `FEATURE_KEYS` + flavor facts; `misskey/backend.ts` seeds the per-origin cache from the table, `like.ts` short-circuits known-absent — stock Misskey never fires `notes/like`; `gates.ts` untouched (`postActions.ts` already gates on `isSupported()`). Unit-proof + `not verified` (vanilla rig down).
- [x] **MK14 Pinetree polls.** PROBED 2026-10-21 (WS-E), no fact change: live Pinetree `:3000` unauth `notes/create` 401s before poll validation for all poll shapes (auth gate precedes validation), so `polls_multi:"unsupported"` stands = v1 parity (offer, server rejects). DECISIONS line recorded.
- [x] **MK16 reactionActions.** DELETED 2026-10-21 (WS-E): `reactionActions.ts` + `myReactions.ts` (sole importer was the deleted module) + suite removed; no producer ever set the provider.
- [x] **MK17 menu copy.** VERIFIED 2026-10-21 (WS-E), no diff: row already does `cachedRemotePostUrl(uri) ?? uri` (`menuModel.ts:170`) + `PostCard.tsx:499` warms the cache; tests pass.

Acceptance: no dead/dupe modules; like never pre-fails where unsupported; poll gate matches a recorded probe; copy-link resolves remotely.

## WS-F — Mastodon correctness: grouped actors + sanitizer share + filters UI (depends on WS-B for sanitizer — run after or coordinate)

- [x] **MD1 grouped-actor fidelity.** DONE 2026-10-21 (WS-F): `adaptV2Group` + `statuses` map + `ext.groupedCount` ("N others" floored by packed actors), 20 existing adapter tests green; grouped-live `not verified` (no v2 server on rig).
- [x] **Filters UI (MD3 data done, no caller).** DONE 2026-10-21 (WS-F): Settings → Filters CRUD + `filterModerated` wiring so Mastodon-family word/server mutes filter feeds; Akkoma round-trip green (13-row probe, rig cleaned). Web-Akkoma create fails honestly (no `POST /api/v2/filters`, CORS-less 404 page — boundary stays per W8/MD12, not overridden); Misskey-family keeps honest placeholder.
- [x] Sanitizer share: consumed WS-B, no gap found, no rework (WS-F).

Acceptance: grouped notifications show "N others" from real envelopes; filters CRUD round-trips; Mastodon mutes filter feeds.

## WS-G — Scroll memory + S4 streaming UI (do last, touches `FeedView`/`Navigation`)

- [x] **Scroll memory (N14).** DONE 2026-10-21 (WS-G): offsets + last tab stay in `feedMemory.ts` (deliberately no duplicate entry cache — persisted react-query cache, 24h MMKV, session+descriptor keys, already serves entries); restore-or-top + unmount save wired in shared `FeedView`; `goBackOrFeed` kept; `Navigation.tsx` untouched. Back restores position + entries (integration-tested). N14 stays done (see register note).
- [x] **S4 streaming UI (unwired P0).** DONE 2026-10-21 (WS-G): `useFeedLive` mount (live insert, `N new` pill fed live with local-diff fallback, delete/update cache reconcile), `useLiveNotifications` channel (prepends into `all` only; filtered views invalidate), new `StreamBadge` (connection state, no numbers — no double unread counters); gated on streaming-supported + non-null handle + non-disabled channel, else paging-only. Mastodon seam recorded not rewired (`subscribePost` proven NOT a no-op — shared user stream, id-filtered; feed-level deletes unsubscribed by interface design; stale MD10 comment corrected). Akkoma live arrival + delete green, writes cleaned. `stream.update` gap is server behavior (no self-fav broadcast), client routing transport-proven.
- [x] `span.mchip`/badge overlap: none — `badges.ts` untouched (WS-G).

Acceptance: back restores position + entries; live post inserts a pill-fed row; delete/update reflect without reload; stream badge shows connected/reconnecting; no double unread counters.

---

## Commit checklist (every WS)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, pasted in log
- [ ] `state/logs/YYYY-MM-DD-<ws>.md` written (goal/did/decided/tests/next)
- [ ] `state/STATE.md` + this file checkboxes updated
- [ ] Branch `p<ws>-<topic>` pushed; commit message `WS-<X>: <what> (tests <n>, <rig/device or not verified>)`
