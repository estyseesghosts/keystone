# 2026-10-16 Parity plan implementation + appearance fixes

Goal: implement `docs/frontend-parity-plan.md` §§0–14 to completion against
Pinetree (owner tests Pinetree + Sharkey), then fix notification/composer
appearance per owner screenshots. No push yet — owner reviews first.

## Parity slices (all in `frontend/src`, `tsc` + build green)

- §0 groundwork: new `api/mutes.ts` (relation/block/mute/renote-mute +
  lists), `api/followRequests.ts` (list/accept/reject), `components/
  UserActions.tsx` (relation-driven toggles, 404-hidden), `/follow-requests`
  route + nav entry, `/settings/mutes` page.
- §1 full profile edit: `ProfileEditor.tsx` grown in place — full `i/update`
  set (followedMessage/lang/fields[16]/avatarDecorations[16]/flags/timed
  gates/mutedWords/hardMutedWords/mutedInstances/notificationRecieveConfig/
  email types/alsoKnownAs/rejectQuotes) + avatar/banner via DriveBrowser
  select mode. Lengths only client-side; server errors verbatim.
- §2 private lists: `ffVisibility` on `UserDetailed`; `FollowList` gate copy
  (owner-only / followers-only + follow prompt); `Profile` count masking.
- §3 reactions: composer `reactionAcceptance` (sent on create), badge in
  `NoteCard`, `components/UserReactions.tsx` dialog (`users/reactions` with
  REACTIONS_NOT_PUBLIC / remote / blocked states) on profiles.
- §4 quote-disable: per-note `noQuote` + `rejectQuotes` account switch in
  `/settings/account` (404-hidden); QUOTE_DISABLED_FOR_USER keeps text, drops
  `renoteId`, shows server reason.
- §5 polls un-gated: `IS_MISSKEY_FAMILY` hide removed; rejects surface
  verbatim.
- §§6–7 scheduling + drafts: `notes/schedule/*` controls (future-validated,
  backend errors verbatim, 404 → disabled with reason); draft payload covers
  full composer state; inline `Drafts (n)` + All/Scheduled filter; explicit
  server copy (`notes/drafts/*`, 404 → local-only); FloatingComposer lists
  server drafts alongside local.
- §8 like emoji: `api/likeEmoji.ts` best-effort `i/update {defaultReaction}`
  from picker + settings; localStorage stays the fallback.
- §9 pins/featured: `api/featured.ts` (`i/pin|unpin`, `notes/featured`,
  `users/featured-notes`); pin/unpin on note detail (own notes,
  PIN_LIMIT_EXCEEDED/ALREADY_PINNED verbatim); Featured profile tab
  (packed pins → per-user ranking → global ranking filtered; absent, never
  faked, when none serve).
- §10 edit + redraft: edit form on the composer surface (`notes/edit`,
  404 → redraft hint); delete-and-redraft with `REDRAFT_WARNING`
  (copy posts, then original deletes).
- §12 notifications: filter bar (`includeTypes/excludeTypes` presets),
  `i/notifications-grouped` toggle (404 → flat + honest note), per-type
  `notificationRecieveConfig` editor + `/settings/mutes` management.
- §13 timelines: `api/softMute.ts` verdicts; `TimelineFeed` drops
  blocked/muted/renote-muted/hard/instance rows (best-effort sets) and badges
  soft matches; `ProfileEditor` owns the word/instance lists.
- §14 import/export: `/settings/import` (following/blocking/mute/notes,
  size-guarded) + `/settings/export` (8 kinds, download-or-job); 404-gated
  per kind.
- Suite: `scripts/smoke_parity.py` (static 18/18 green here; live probes
  404-tolerant, SKIP without backends — owner runs vs Pinetree + Sharkey).

## Appearance fixes (owner screenshots, this session)

- Notifications (`docs/notifications.png`): rows were two-column with
  uppercase kind badges; filter bar wrapped into a wall. New
  `components/NotificationRow.tsx` — rows mirror note rows (avatar +
  name/handle/relative-time head, sentence-case description, preview,
  Open-note link); filters are one scrolling chip row
  (`.notif-filters`/`.nf-chip`); short labels (Mentions/Reposts).
  Follow-requests, mutes, and user-reaction rows use the same shape.
- Composer (`docs/composertop.png`, `composerfloat.png`,
  `docs/composer2.png`): new controls rendered as giant full-width blocks
  (base button/select styles). Moved into a toolbar ⋯ popup in vispick
  style (`MoreIcon`, radio/check rows, schedule datetime + drafts inside);
  Local-only moved in too (toolbar switch deleted with its CSS); sheet spans
  the toolbar so it never clips on mobile; dotted trigger when options
  active. Tunnel note: composer2's unstyled look suggests the owner rig may
  have served stale CSS (new JSX + old CSS) — rebuild ships new hashes
  (CSS 38.52 kB).
- Emoji right-click (`EmojiPicker.tsx`): event/state/positioning all verify;
  one real hole closed — modified clicks (Ctrl/Cmd-click = right-click on
  macOS) fired `pick` instead of the cell menu. Cells now ignore modified
  clicks; genuine right-click path unchanged. Static check added to the
  parity suite.

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green (JS 317.70 kB).
- `scripts/smoke_parity.py`: 18 passed, 0 failed, 3 skipped (no backends
  on this machine — `:3000/:3101/:3102` all unreachable).
- 21/21 pure-helper checks (softMute/schedule/drafts via esbuild + node).
- CSS braces balanced; dead `.localswitch` removed.

## Not yet verified (owner)

- Browser visuals for all of the above (no browser here).
- Live probes vs Pinetree + Sharkey (`scripts/smoke_parity.py`).
- Emoji right-click on the owner rig (works by analysis + guard; confirm).
- Existing suites (`flows`/`writes`/`features`/`streaming`) not re-run here.

Next: owner browser + live-API pass; push on approval.
- 2026-10-16 (composer3, done): kill composer textarea outline
  (`outline/box-shadow: none` incl. `:focus-visible`, scoped to
  `.composer-body > textarea`) + `resize: none` with JS auto-grow
  (`fitArea`: content height, 40vh cap, field scrolls past it; wired to
  input/mount/restore/reset). `docs/seethru.png` arrived + assessed
  (opaque-correct in current code; likely stale sheet — owner to
  hard-refresh). Verified: `tsc` clean, `npm run build` green.
- 2026-10-16 (dn + reactions, done): `hasRealDisplayName`/`headNameOf`
  (types.ts) — empty/username-echo/handle-echo names collapse to one full
  handle head, handle span hidden; rolled out to NoteCard (head, reply
  context, repost banner), QuoteHead, NotificationRow (+grouped),
  FollowRequests, FollowList, Profile h2, hovercard, mention chips,
  unfurl cards, search, settings account, account card. Reaction writes
  pin the confirmed end state in `api/myReactions.ts` (session, per
  backend): readers via `effectiveMyReaction` (chips mine-flags, like
  button + logged-out heart), writers confirm on success / clear on
  failure; optimistic counts derive from the confirmed state so
  button+chips agree with no snap-back and no remount flicker. Verified:
  `tsc` clean, build green, 15/15 helper checks, parity static 18/18.
  Browser + live-API confirmation owner-side (no browser/backends here).
- 2026-10-16 (remote-emoji, done): `:name@host:` rendered literally
  because (a) mfm-js never emits remote codes as `emojiCode` (verified:
  every host form parses as `text`), (b) Pinetree packs `emojis` /
  `reactionEmojis` as `{}` (verified in `pinetree/.../packers.rs`), and
  (c) the global `emojis` listing is local-only. Fix: `parseEmojiCode` /
  `isLocalEmojiHost` / `splitRemoteEmojiCodes` (emoji.ts);
  per-host public-listing cache (`ensureHostEmojis` /
  `remoteEmojiUrl`, 10s timeout, 50-host cap, misses remembered);
  `customEmojiUrl` returns null for remote codes (a remote code must
  never render a local lookalike); `EmojiGlyph` resolves packed →
  host cache → local list (reactive swap-in); MFM `text` nodes split
  remote codes; `splitNameEmojis` covers remote in names/CWs/bios/polls.
  Proven live: `POST misskey.io/api/emojis` → 200, 13,970 items, and
  `ACAO: *` on misskey.io + dvd.chat, so the browser leg works;
  CORS-closed hosts degrade to literals (status quo). Verified: `tsc`
  clean, build green, 12/12 helper checks, parity static 20/20. Visual
  confirmation owner-side.
- 2026-10-16 (emoji-ctx, real bug): right-click cell menu was invisible —
  `.emojictx-menu {position: fixed}` tied in specificity with the later
  `.vispick-menu {position: absolute}`, so the later rule won and
  viewport-based cursor coordinates applied relative to the emoji panel:
  flung off-screen and clipped by the panel scrollbox. Fixed by doubling
  the selector (`.vispick-menu.emojictx-menu`); widened the horizontal
  clamp (248 → 316) to the real card width. Earlier modified-click guard
  kept (Ctrl/Cmd-click must not pick). Verified: `tsc` clean, build green
  (CSS 38.68 kB), parity static 18/18.
- 2026-10-16 (seethru, no code change): account menu transparency is not
  reproducible from current code — `.accountmenu` carries opaque
  `background: var(--bg)` since its introduction (`f32a446`), vars are
  solid, no override/opacity/filter path exists. Consistent with the
  composer2 new-JSX/old-CSS mismatch: likely a stale stylesheet on the
  test rig. Owner to hard-refresh and re-check; if it persists, capture
  is needed (computed `background-color` of `.accountmenu`).
