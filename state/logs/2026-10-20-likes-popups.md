# 2026-10-20 — Sharkey likes + popup fixes — agent

Branch: `p3.1-signin-functional` (committed as 4d1ba0f before this work)
Goal: owner-ordered — (1) screen-aware popups, (2) emoji reaction popup
on posts, commit, (3) Sharkey `notes/like` with vanilla fallback.

## Did

- Committed butterfly work as `4d1ba0f` (61 files; `.serena/` +
  `docs/K1vK2/` deliberately untracked).
- Popup placement hardened (`src/components/Popup.tsx`): viewport-first
  sizing (card never exceeds window minus margins), side picked by
  available room (preferred side wins when it fits ≥120px, else more
  room wins), left-edge shift for right-edge triggers, maxH from the
  winning side. Fixes half-offscreen cards.
- Reaction picker moved off the global dialog onto the action bar's
  anchored emoji popup (`ActionBar` owns anchor + `EmojiPicker`;
  `sessionId` threaded from `PostCard`). `PostHandlersProvider` shed the
  global picker dialog + `onPickReaction` provision. Smile + custom-like
  paths share the popup.
- All motion instant (stack `animation: 'none'`, compose transparentModal
  none, Popup/Dialog/Lightbox `animationType="none"`).
- Likes per kissme spec: `packages/fedi/src/misskey/like.ts`
  (`likeViaNotesLike`, `LikeUnsupportedError`, per-origin cache),
  `Backend.like?`, misskey member, origin threaded through
  `backendForSession`/`activeBackend`, queue branch in
  `setReaction` (heart-only incl. custom→heart w/ pre-clear; 404/code
  → vanilla ❤; re-read + server-truth sync; failed re-read keeps
  optimistic). UI untouched (heart button already routes there).
- Tests: `packages/fedi/test/misskey-like.test.ts` (8),
  `post-shadow.test.tsx` like block (7). Trio: typecheck ×3, lint,
  **64 suites / 860 tests green**.
- Failures fixed: RN `Pressable` takes no ref (RNPressable anchors);
  Modal-subtree effects pre-assertion (synchronous fallback position);
  `m-dialog`/item assertions; ICU narrow-hour variance; effect-gate
  too narrow for custom→heart.

## Decided (-> DECISIONS + task p4.7)

- Owner product decision: vanilla fallback = plain ❤ reaction (kissme
  dialogs; we don't). Recorded.
- No per-note noQuote / isFavorited / global throttle / custom like
  pref — all logged as out of scope with reasons.

## Tests / verification

- Unit: 15 new tests green (see above).
- Live Sharkey tap ATTEMPTED but stood down: owner session went active
  mid-attempt (emoji picker open, feed moving) — DOM clicks into a live
  session risk interference. One press registered nothing ("Like, 0
  reactions" before and after; no toast; no stray like left behind —
  verified). Owner 5-second check pending: tap any heart, watch it
  fill; tap again, watch it clear.
- Vanilla fallback unprovable live (Misskey :3101 down).

## Deviations / follow-ups

- Helium main profile died mid-session (GPU errors in its log); user
  relaunched with debug flags on request. Isolated 9223 profile kept
  throughout; user session never disturbed (no account/credential
  touched; localStorage shared-origin writes avoided).
- v1 :5199 instance killed (redundant; live :5173 is the reference).

## Next

- Owner: 5-second Sharkey like tap; merge review of the branch.
- Feed chrome, notifications, explore, settings pages (butterfly task).
