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
- [ ] Misskey structured renote path stays; wire `resolveQuoteUri` fallback: `PostCard.tsx` warm (`:495-500` exists) → on success render `PostQuote`, on failure render inline `RE:`-stripped body + "unavailable" label. Add resolving indicator.
- [ ] Mastodon: keep `adapt` quote display; add `resolveTextualQuote` fallback for `RE: <url>` / bare quote URLs (`mastodon/endpoints.ts:561-589`, `backend.ts:1229-1278` + TTL cache already exist — wire them, don't rebuild).
- [ ] `body.ts:22-48` strip logic: strip the marker only when its card renders or resolves; otherwise leave text visible (v1 parity). Cover MFM + HTML paths.
- [ ] Settings toggle + gating in `PostCard`/`PostQuote`. Tests: structured, URI-fallback success/fail, Mastodon unauthorized shown-by-default + hidden-when-opt-in, marker strip/keep matrix.

Acceptance: Misskey renote, Mastodon quote, and bare `RE:` URL all yield cards by default; opt-in hides unauthorized with reveal.

## WS-B — Content rendering: MFM, `span.mchip`, sanitizer, TagBubble (PARALLEL-SAFE vs A/C, conflicts on `RichText.tsx` — serialize edits inside this WS)

- [ ] **MFM decorations (F14).** v1 `MfmRenderer.tsx:242-330` → v2 `core/content/fromMfm.ts:40-63` parses, `RichText.tsx:177-179` degrades to children. Implement `$[x2/x3/x4/size/scale/color/bg/blur/rotate/font/small/center]` + spin in `RichText`. Keep allow-listed, no WebView. Tests per fn.
- [ ] **`span.mchip` (was lumped in MD4).** v1 `sanitize.ts` class allow-list keeps `span.invisible` with class (CSS hides URL-shortening spans); v2 `core/content/fromHtml.ts:302-311` drops the subtree. Decide per node: `invisible` → zero-width/hidden span (never visible text); `mchip`/hashtag chips → chip inline. Pin with regression tests proving invisible text never renders visibly.
- [ ] **MD4 sanitizer remainder.** `li` → real bullets (not `"• "` text prefix), headings → styled heading (not bold body) per v1 `HtmlBody.tsx:105-133`. Keep blocks→`br` pairs (intentional).
- [ ] **TagBubble (F10).** v1 `TagBubble.tsx` + `NoteCard.tsx:146-160` + `api/tags.ts`. Mount bubble in card headers + quote heads; prune tag blocks from body (`parseTagBlocks`/`pruneTagBlocks` in `body.ts`). No-op where no tags.
- [ ] Confirm `auto` = full MFM always; `plain` = projection (`RichText.tsx:278-287`). Fix schema bug above.

Acceptance: MFM showcase post renders decorations; invisible spans hidden; tag posts show bubbles with pruned bodies; `auto` never shows raw MFM source.

## WS-C — Emoji: remote + custom + picker store (MK8) (PARALLEL-SAFE)

- [ ] **Remote emoji fallback.** `fromMfm.ts:164-188` emits `customEmoji(name,host,null)`; `EmojiImage.tsx:89` resolves packed-map only. Wire `createCustomEmojiStore.ensureHostEmojis/remoteUrlFor` (`misskey/customEmoji.ts:226-245`, states `unavailable` vs `error` at `:200-210`) into the render path session-scoped. Unknown codes still render literally, never blank.
- [ ] **Display-name emoji.** Extend the `DisplayName` path (cards done) to `ProfileHeader` + notification rows if regressed; verify live on Akkoma.
- [ ] **MK8 picker.** `EmojiPicker.tsx:39` reads only `backend.customEmojis()`. Subscribe to the same store (remote-host results included), keep per-session recents (cap 24). `unavailable` vs `error` + retry states from the store.

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

- [ ] **MD1 grouped-actor fidelity.** `mastodon/adapt.ts:570-596` reads only legacy `notifications`+`accounts` envelope; real `notification_groups` envelopes fall back to flat v1. Implement `adaptV2Notification` with the grouped fixtures (`fixtures/mastodon/notification-grouped-v2.json`), preserve actor list/count/reactions, keep 404/405-only fallback. 20 existing tests must stay green.
- [ ] **Filters UI (MD3 data done, no caller).** Build Settings → Filters CRUD on `Backend.filters` (v2 group shape + v1 fallback `backend.ts:903-1012`, live-verified on Akkoma). Wire to `filterModerated` so Mastodon-family word/server mutes actually filter. Misskey-family keeps honest no-endpoint placeholder.
- [ ] Sanitizer share: consume WS-B output; no separate fix here.

Acceptance: grouped notifications show "N others" from real envelopes; filters CRUD round-trips; Mastodon mutes filter feeds.

## WS-G — Scroll memory + S4 streaming UI (do last, touches `FeedView`/`Navigation`)

- [ ] **Scroll memory (N14).** v2 `feedMemory.ts:1-53` persists offsets + last tab only. Add feed-entry cache (notes/cursor/exhausted per session+descriptor) or document why react-query cache suffices — downgrade N14 to `partial` until then. Wire save/restore in shared `FeedView`; keep `goBackOrFeed` (`Navigation.tsx:153-160`).
- [ ] **S4 streaming UI (unwired P0).** `src/state/streaming.ts` (`createFeedLive`, per-post `subscribePost`, per-session registry) + `mastodon/stream.ts` pooled transport (origin-honored) exist test-only. Mount: live feed insert, `N new` pill fed live (replaces local-diff), delete/update capture in feeds, notification channel, stream status/reconnect badge (the second badge — unread badge stays W4's). Misskey broadcast covers watched ids; Mastodon feed deletes ride the adapter seam (`streaming.ts:78-82`) — wire `onDelete` through or record the seam.
- [ ] `span.mchip`/badge overlap: none — keep badges (`badges.ts`) as-is.

Acceptance: back restores position + entries; live post inserts a pill-fed row; delete/update reflect without reload; stream badge shows connected/reconnecting; no double unread counters.

---

## Commit checklist (every WS)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, pasted in log
- [ ] `state/logs/YYYY-MM-DD-<ws>.md` written (goal/did/decided/tests/next)
- [ ] `state/STATE.md` + this file checkboxes updated
- [ ] Branch `p<ws>-<topic>` pushed; commit message `WS-<X>: <what> (tests <n>, <rig/device or not verified>)`
