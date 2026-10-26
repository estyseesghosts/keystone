# RN UI audit — Keystone v2 (2026-10-26)

Date: 2026-10-26. Read-only audit; no source modified. Only code-verified
items are listed. Scope: `src/Navigation.tsx`, `src/screens/HomeFeed.tsx`,
`Channels.tsx`, `Conversations.tsx`, `ChatThread.tsx`, `src/components/Post/*`,
`src/components/Composer/*`, `Compose.tsx`, `CompactComposer.tsx`, `ToastHost`,
deep-link routing to /notifications /users/:id, error boundaries, eslint
react-hooks plugin presence, `Channels` cancellation on tab/account switch,
edit-composer attachment handling + autosave collision, account default
visibility, `ToastHost` safe-area, nested KeyboardAvoidingViews. Method:
static code reading (no device run). Prior report
`docs/audit_20261025/results/rn-ui.md` used as the baseline; regressions
re-checked, fixes confirmed below.

## Summary

Most of the 2026-10-25 findings have landed since: the react-hooks plugin is
now enforced (`error`/`error`), `Channels` has a generation guard + abort +
footer retry, `ToastHost` reads insets + tab-bar clearance with a live region,
deep links to Notifications/User always register with honest signed-out
states, the compose sheet owns exactly one platform-split keyboard mechanism
(with a test pinning a single KAV), paging loops are gated by `usePagedLoad`
everywhere, autosave flushes on unmount, and root + per-row error boundaries
exist. The remaining gaps: the chat send box has no keyboard avoidance at all
(input hidden behind the keyboard on native), the edit-mode close guard does
not see seeded alt-text-only edits (caption work silently discarded), the
`screen` ErrorBoundary variant is still unmounted anywhere, and two narrow
autosave-collision paths remain between the Home inline composer and the
compose sheet (shared per-session pointer / shared draft id).

Counts: 0 high, 2 medium, 5 low.

## Findings

### M1 (Medium) Chat send box has no keyboard avoidance — input hides behind the keyboard on native
- Files: `src/screens/ChatThread.tsx:292-309`, `src/screens/ChatRoom.tsx:12-13,124-140`, `src/screens/ChatUser.tsx:15,147-149`
- The send row is a plain bottom-anchored `View` (`atoms.row`, `TextInput` +
  `Button`). Neither `ChatThread` nor its two wrappers imports or mounts a
  `KeyboardAvoidingView` (grep over `src/screens` finds KAV only in
  `Compose.tsx` / `CompactComposer.tsx`). On iOS nothing pans or pads the
  thread, so with the keyboard open the multiline input and Send button sit
  underneath it. Android gets no `adjustResize` help either (the manifest
  opts into `pan` mode globally for the compose sheet's benefit —
  `app.config.js:56`).
- Fix: wrap the thread in a KAV (`padding` on iOS, like the compose sheet) or
  anchor the send row above the keyboard; verify on device per X12.1.

### M2 (Medium) Edit-mode close guard misses seeded alt-text-only edits — caption work is silently discarded
- Files: `src/components/Composer/Composer.tsx:972-993`, `src/components/Composer/ComposerSections.tsx:395-443`
- `isCloseDirty` in edit mode diffs text, CW + toggle, media **ids** (length +
  order), uploads presence, poll, visibility, localOnly, and visibleUserIds —
  but never seeded `alt` text. `SeededMediaSection` edits alt freely in edit
  mode (locked only while `busy`, line 417-418), and the submit path honours
  those edits via `applyMediaEdits`/`pendingMediaUpdates`. So: open an edit,
  change only a photo's description, tap backdrop / back / Cancel — the guard
  reports clean and the edits vanish. They were also never autosaved (edit
  mode skips autosave by design, `Composer.tsx:479`), so nothing survives.
- Fix: include seeded alt (and any staged-upload alt) in the edit-mode dirty
  diff, e.g. compare `state.media` alt against `originalAlt`.

### L1 (Low) Per-screen ErrorBoundary still unmounted — residual of prior M1
- Files: `src/Navigation.tsx:236-284` (no `ErrorBoundary` import), `src/components/ErrorBoundary.tsx:7-9`
- Root (`Root.tsx:108`) and per-row (`HomeFeed.tsx:278`,
  `PostFeed/PostFeed.tsx:138`) boundaries landed, so a render throw no longer
  whitescreens. But the `screen` variant exists only as code: no
  `Stack.Screen` is wrapped, and the module comment defers it ("apply at the
  `Stack.Screen` `component` sites when that file is next touched"). A throw
  in a non-feed screen (Channels, Compose sheet, Settings, chat) still drops
  to the full-app root crash UI instead of a per-screen fallback with retry.
- Fix: wrap stack screen components in `variant="screen"` boundaries as the
  comment describes.

### L2 (Low) Targeted sheet composer hijacks the session draft pointer; discard orphans the inline draft's resume
- Files: `src/components/Composer/Composer.tsx:486-521,1084-1101`, `src/screens/Home.tsx:78-90`
- The Home inline composer (`key={session.id}`, always mounted while signed
  in) and the compose sheet (`Compose.tsx:240`, mounted over it) are two live
  controllers sharing one per-session open-draft pointer. Any non-direct,
  non-edit autosave calls `setOpenDraftId(store, session.id, id)` with its
  own id — so a reply/quote sheet (fresh id by design, `Composer.tsx:339-340`)
  steals the pointer from the inline draft. `discardAndClose` then deletes the
  sheet row **and** clears the pointer: the inline draft row survives in the
  drafts list but "continue where you left off" after refresh/crash is gone.
- Fix: scope the pointer to the inline composer (or don't set/clear it from
  targeted sheets).

### L3 (Low) Plain sheet adopts the inline draft id — post-then-navigate resurrects posted text as a ghost draft
- Files: `src/components/Composer/Composer.tsx:338-353,523-545,806-813`
- A target-less sheet open (FAB) follows the open-draft pointer and adopts the
  inline composer's row id, so two controllers share one row with divergent
  state. Posting from the sheet deletes the row and clears the pointer — but
  the still-mounted inline controller holds the pre-sheet text with
  `postedRef === false`, and the unmount flush (`useEffect(() => () =>
  flushAutosaveRef.current(), [])`) re-saves that stale state and re-sets the
  pointer on next navigation. Net: already-posted text returns as an
  "in-progress" draft.
- Fix: same as L2 (a sheet that adopted the pointer id should mark its row
  consumed), or remount the inline composer after a sheet post.

### L4 (Low) Account default visibility races the `me` query — first paint (and a fast post) uses the family default
- Files: `src/components/Composer/Composer.tsx:385-397,547-582`,
  `packages/fedi/src/api/composer.ts:285-301`
- Initial state seeds `defaultVisibilityFor(family, replyTo,
  prefs.visibilityRaw ?? undefined)` while `prefs` is still null (the `me`
  query usually resolves after mount); the prefs effect patches the composer
  only if still pristine. A viewer whose account default is followers-only
  briefly sees Public, and a post sent before `me` resolves goes out at the
  family default instead of the account default. (Reply narrowing itself is
  correct — replies inherit the parent and ignore the pref.)
- Fix: seed from the cached `me` query synchronously where available, or hold
  the audience control in a loading state until prefs resolve on a fresh
  composer.

### L5 (Low) Chat input has no accessible label
- File: `src/screens/ChatThread.tsx:293-301`
- The send `TextInput` exposes only `placeholder={sendLabel}` — no
  `accessibilityLabel`, unlike the composer inputs (`Composer.tsx:1284`,
  `CompactComposer.tsx:233`). Placeholder is not a reliable label for assistive
  tech.
- Fix: add `accessibilityLabel={sendLabel}`.

## Looked solid

- Prior M2 fixed: `eslint-plugin-react-hooks` is wired with both rules at
  `error` (`eslint.config.mjs:4,44,56-57`). Only three `exhaustive-deps`
  disables remain, each with a justification comment (`User.tsx:82`,
  `HoverPreview.tsx:386`, `AccountLists.tsx:68`). No hook-dependency bugs
  found in the scoped files: quote-resolution effects use ref-mirrored
  resolvers with cancellation (`useQuoteTarget.ts:95-117,123-130`),
  auto-translation has full deps + cancel (`useAutoTranslation.ts:67-136`),
  `LinkCard` auto-fetch is single-flight with a mounted guard
  (`LinkCard.tsx:165-202`), `PostPoll` resync is signature-guarded
  (`PostPoll.tsx:187-194`), and `useSuggestions` debounces with cleanup
  (`Autocomplete.tsx:40-66`).
- Prior M3 fixed: `Channels` bumps a generation + aborts the previous request
  on every `load`, ignores stale resolutions, and parks next-page failures in
  a footer retry (`Channels.tsx:107-198,296-308`). Tab/account switches reset
  to a skeleton, so the bare `item.id` keyExtractor never shows alien rows
  (rows are stateless).
- Prior M4 fixed: `ToastHost` offsets by `insets.bottom + tab-bar height + gap`
  on mobile (`ToastHost.tsx:52-53`), the toast box is a live region
  (assertive + alert role for errors, `Toast.tsx:30-34`), native announces via
  `announceForAccessibility`, and the toast is tap-to-dismiss with
  hover/focus pause. Mounted inside `SessionProvider` under the single
  `SafeAreaProvider` (`Root.tsx:99-113,169`).
- Prior M5 fixed: Notifications/User tabs always register
  (`Navigation.tsx:118-140`) with honest signed-out states (`User.tsx:137-141`,
  `Notifications.tsx:728`); linking table still single-sourced from `paths`
  (`routes.ts:299-350`).
- Prior L5 fixed: exactly one keyboard mechanism per platform — iOS-only KAV
  in the sheet (`Compose.tsx:170-184`), Android `maxHeight` cap +
  `softwareKeyboardLayoutMode: 'pan'` (`app.config.js:56`,
  `Composer.tsx:109-119`), inner KAV skipped via `disableKeyboardAvoidance`
  (`CompactComposer.tsx:535-550`); a test pins a single KAV
  (`Compose.test.tsx:205-230`). Boot shows `BootSplash`, not blank
  (`Root.tsx:130-147,167`); the widgets stub column is gone
  (`Navigation.tsx:167-169`).
- Prior L1/L4 fixed: every infinite list pages through the shared
  `usePagedLoad` gate — error guard, burst latch, 429 cooldown
  (`usePagedLoad.ts:81-150`), wired in `HomeFeed.tsx:218,448`,
  `Conversations.tsx:126`, `ChatThread.tsx:197-200`, `PostFeed.tsx:101-107`.
- Prior L2 fixed: autosave flushes on unmount except after post/save/discard,
  in edit mode, and for direct drafts (`Composer.tsx:523-545`).
- Composer submit paths verified: alt text rides `uploadOne` at upload time
  or `pendingMediaUpdates`/`updateMedia` on submit
  (`composer.ts:687-700`, `packages/fedi/src/api/composer.ts:708-724`), so the
  `alt: ''` in `allMedia` (`Composer.tsx:816-819`) is harmless — wire drafts
  carry ids only (`buildPostDraft`, `packages/fedi/src/api/composer.ts:526`).
  Edit mode always sends an explicit attachment set (X5.4) with seeded alt
  preserved (`Composer.tsx:750-757`); single-flight guards on submit and
  save-and-close are present and reset in `finally`.
- Capability gating holds in scope: `ActionBar` disables reply/boost/like/
  quote with reasons (`ActionBar.tsx:185-196,204-253`), chat/conversation/
  channel screens fail closed on `unknown`, and the signed-out states never
  show sample data. Session scoping holds: feed keys, `FeedView` remount keys
  (`Home.tsx:155`), and `CompactComposer` remount keys (`Home.tsx:84`,
  `Compose.tsx:246`) all include the session id.

## Not covered

Per scope: RichText parser internals, Settings/ProfileEditor/Login/Drive/
EmojiPicker, alf tokens (beyond the files cited), and device-runtime checks
(keyboard geometry, toast overlap, Live/WS behaviour remain `not verified` on
hardware).
