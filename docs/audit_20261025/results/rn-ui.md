# RN UI audit (src/components, src/screens, src/alf, Navigation/routes)

Date: 2026-10-25. Read-only audit; no source modified. Only code-verified
items are listed. Behaviours that depend on device runtime are labelled
"needs device check".

## Summary

The UI layer is generally disciplined: capability gating is real (ActionBar,
Notifications settings, Channels/Conversations/ChatRooms all fail closed with
a reason), session scoping is present in list keys and in the Home composer
(`key={session.id}`), stale-response guards exist in User/Explore/Autocomplete,
and routing derives from one table. The material gaps are structural:
no error boundary anywhere, no `react-hooks` lint plugin (so hook-dependency
bugs are unguarded), a Lightbox that never scrolls to the tapped index, and
a few async screens without cancellation (Channels).

Counts: 1 high, 5 medium, 6 low.

## Findings

### H1 (High) Lightbox opens on the wrong frame; pager never follows `index`
- File: `src/components/Lightbox.tsx:116-150`
- The horizontal `ScrollView` has no ref, no `contentOffset`, no
  `scrollTo`. `index` only picks which frame is `active` (plays video) and
  the "n / N" counter.
- Scenario: a post with 4 images; user taps the 3rd tile
  (`PostCard.tsx:1034` sets `index: 2`). The viewer shows frame 1 while the
  counter reads "3 / 4" and the alt caption is image 3's. For a video in
  slot 3 the off-screen frame plays audio while the visible one is paused.
  On window resize/rotation `width` changes but the scroll offset stays,
  so the pager lands between frames. On desktop web there are no prev/next
  controls or key handlers, so with a mouse the user cannot page at all.
- Fix: keep a ref and `scrollTo({x: safe * width, animated: false})` in a
  layout effect keyed on `[safe, width]` (or `contentOffset={{x: safe*width,y:0}}`
  for the initial mount); add prev/next buttons and Left/Right/Escape keys
  on web.

### M1 (Medium) No error boundary anywhere
- Files: `src/Root.tsx`, `src/App.tsx`, `src/Navigation.tsx` (grep for
  `ErrorBoundary|componentDidCatch|getDerivedStateFromError` over `src/`
  returns nothing).
- Scenario: any render-time throw (malformed server payload in
  `PostCard`, a bad `RichText` node, a Lingui miss) unmounts the whole
  tree: white screen on web, crash/red screen in release native. Feed
  rows are the most exposed since server data is untrusted.
- Fix: a root boundary with reload/sign-out affordance, plus a per-screen
  boundary in the Stack and a per-row boundary in feed `renderItem`
  (collapse to "Couldn't show this post").

### M2 (Medium) `react-hooks` ESLint rules are not enabled
- File: `eslint.config.mjs` (only the local `keystone` plugin; no
  `eslint-plugin-react-hooks` in `package.json`).
- Scenario: stale closures and missing deps are unlinted in a 265-file UI
  with many hand-rolled `useEffect`/`useCallback` chains (e.g. the
  deliberate ref-mirroring in `Note.tsx:1150-1170`, `Menu.tsx:55-63`).
  AGENTS.md says conventions should be lint-enforced.
- Fix: add `react-hooks/rules-of-hooks` (error) and `exhaustive-deps`
  (warn, then error); expect a cleanup pass.

### M3 (Medium) Channels: un-cancelled loads let a stale response overwrite state
- File: `src/screens/Channels.tsx:93-151`
- `load`/`loadMore` have no generation guard or abort. The effect at 137
  re-runs `load` whenever `tab`, `channelsApi` (session switch) changes.
- Scenario: open "My channels" on a slow server, tap "Server channels";
  the earlier "mine" response lands last and `setChannels(page.items)`
  puts followed channels (and its cursor) under the "Server" tab; further
  paging then continues the wrong cursor with the wrong `fetchPage`. Same
  with an account switch (list from account A shown for B). `loadMore`
  also appends into whatever list is current.
- Also: a `loadMore` failure does `setError(err)` (line 131), which
  swaps the whole already-loaded list for the full-screen "Could not load
  channels" state, discarding the loaded pages.
- Fix: mirror `User.tsx`'s `generationRef` pattern (or move to a
  react-query infinite query keyed by `[sessionId, tab]` like
  Conversations/ChatRooms); keep a separate footer error for `loadMore`.

### M4 (Medium) Toast ignores safe area and the mobile tab bar
- File: `src/components/ToastHost.tsx:9-11, 16-28`
- `bottom: 24` fixed; `Root.tsx` comment claims every shell layer (incl.
  Toast) reads insets, but ToastHost does not use `useOptionalSafeAreaInsets`.
  `ToastHost` is mounted outside `Navigation`, so it also sits behind/over
  the 'mobile' `ShellTabBar`.
- Scenario: on an iPhone with the home indicator, toast (e.g. action error
  via `toastError`) overlaps the tab bar/home indicator; errors from
  tab-bar-adjacent actions are partially hidden. Toast also has no
  `accessibilityLiveRegion`/`role="alert"` (`Toast.tsx` has no a11y props),
  so screen-reader users never hear action errors, and `pointerEvents="none"`
  means it cannot be dismissed early.
- Fix: bottom = insets.bottom + tab bar height (expose from shell layout);
  add `accessibilityLiveRegion="polite"` / `role="alert"`.

### M5 (Medium) Deep links to tab-only routes silently fall to Home when signed out
- Files: `src/Navigation.tsx:132-151`, `src/routes.ts` (`linkingScreens`
  puts `Notifications` and `User` under `Main`)
- The tab navigator registers `Notifications`/`User` only when a session
  exists, but linking config always lists them. A signed-out cold open of
  `/notifications` or `/users/abc` produces state with an unregistered
  route; React Navigation discards it and shows the first tab (Home) with
  no sign-in prompt and no URL/route correction. (`/users/:id/followers`
  etc. are stack screens and do show an honest signed-out view.)
- Fix: always register the screens and let them render their existing
  signed-out state (all screens already have one), or redirect to Login
  with a `next` param.

### M6 (Medium, partly needs device check) App boot blocks on un-timed network, blank until done
- File: `src/Root.tsx:51-79, 123`
- `ready ? <Navigation/> : null` renders nothing (no splash/loader) until
  `resolveAppHosting` (web: `loadRuntimeConfig` fetch, no timeout in
  `packages/fedi/src/core/config.ts:153-189`) and then
  `store.verifyActive()` (network) both settle. Neither is wrapped in a UI-level
  timeout. A stalled request leaves a permanently blank app. Store-level
  timeout on `verifyActive` was not verified.
- Fix: `Promise.race` with a ~5-8s timeout per leg (fail open to
  defaults / "network" verify result), and render a Loader while not ready.

### L1 (Low) `onEndReached` retry loop risk after a failed next page
- Files: `src/screens/HomeFeed.tsx:416-419`, `src/screens/Notifications.tsx:435-438`,
  `src/components/Recommendations/RecommendationsFeed.tsx:71-74`
- Guards check `hasNextPage && !isFetchingNextPage` only. After a failed
  fetch (`isFetchNextPageError`), `hasNextPage` stays true and
  `isFetchingNextPage` is false; the footer swap to the retry button
  changes content length, and with threshold 2.5 the list is still "near
  end", so `onEndReached` can re-fire and hammer the failing endpoint.
  The explicit retry button suggests this was meant to be manual.
  (Runtime re-fire is inferred from RN VirtualizedList behaviour;
  guard omission is verified.)
- Fix: add `&& !feed.isFetchNextPageError` to the guard.

### L2 (Low) Composer draft autosave drops last <400 ms of edits on unmount
- File: `src/components/Composer/Composer.tsx:337-347`
- Debounce effect cleanup is only `clearTimeout`; no flush on unmount.
  Close-guard Save/Discard paths are explicit, but any other unmount
  (sidebar navigation, account switch, route replace) loses the final
  keystrokes despite the "refresh must persist" program goal.
- Fix: flush `saveDraft` in the cleanup when `!postedRef.current`.

### L3 (Low) Note screen `goBack()` after delete is unguarded
- File: `src/screens/Note.tsx:1114-1118`
- `nav.goBack()` on a deep-linked Note (first route, e.g. `/notes/123`
  cold open) has no history; React Navigation logs an unhandled action
  and the user is left on a blanked card. `goBackOrFeed` already exists
  in `components/shell/shellNav`.
- Fix: use `goBackOrFeed`/`nav.canGoBack()` fallback to Home.

### L4 (Low) `PostFeed` double-triggers load-more
- File: `src/components/PostFeed/PostFeed.tsx:68-137`
- `handleScroll` (every 32 ms while within 1200 px of end) and
  `onEndReached` both call `onLoadMore`; the only dedupe is the
  `isFetchingMore` prop, which flips a render after the first call, so
  several calls can fire in the window. Also no error guard (see L1).
  `<PostFeed>` has no non-test usage in `src` (grep), so impact is
  currently latent; the production feed (`HomeFeed`) uses its own guard.
- Fix: latch with a ref until `isFetchingMore` goes true->false.

### L5 (Low, needs device check) Android keyboard compensation applied twice
- Files: `src/screens/Compose.tsx:66-131`, `src/components/Composer/Composer.tsx:84-100`
- On Android the sheet uses `KeyboardAvoidingView behavior="height"`
  AND `paddingBottom = keyboard height` AND `maxHeight = window - keyboard`.
  `app.config.js` sets no `softwareKeyboardLayoutMode`; with Expo 57
  edge-to-edge the window may not resize, in which case the three
  mechanisms overlap and the input can sit too high or be clipped. iOS
  has the `maxHeight` cap plus KAV padding with `keyboardDidShow` (post-animation) timing.
- Fix: pick one mechanism per platform; verify on device.

### L6 (Low) Visible stub copy shipped in the desktop shell
- File: `src/Navigation.tsx:98-105`
- `RightNav` renders "Widgets land in Phase 5." on web at wide viewports
  (>= sidebar + 600 + 332). That is dev-status text shown to users in a
  reserved 332 px column; `screens/Placeholder.tsx` ("Not built yet") is
  the same class but is not imported by any screen (verified by grep).
- Fix: do not mount `RightNav` until widgets exist (let the feed use
  `mainColMaxWide`), or render nothing inside it.

## Looked solid

- Capability gating: `ActionBar` (renote/quote/reaction gates with reasons),
  `Notifications` settings button (disabled + `disabledReason`),
  `AccountMenu` current-account row (disabled + reason), Channels /
  Conversations / ChatRooms / Announcements fail closed on `unknown`.
  The two `onPress={() => {}}` hits are both `disabled` with reasons.
- No fake/sample data found; signed-out states say so explicitly.
- Query keys / list keys include `sessionId` (`PostFeed`, `RecommendationsFeed`);
  `CompactComposer` is remounted per session.
- Async race handling in `User.tsx` (generationRef), `Explore.tsx`
  suggestions (`suggestGen`), `Autocomplete.tsx` (cancelled flag + timer
  cleanup), `Note.tsx` InClipsRow (cancelled flag).
- Listener cleanup: Popup/Menu/Dialog/HoverPreview/Compose keyboard
  listeners, `beforeRemove` guard, interval/timers all return cleanups.
- `Note.tsx` focus-refetch uses a ref + empty-deps `useFocusEffect` with
  documented rationale (avoids a polling loop) and a `seenFocus` skip.
- Routing: single `paths` table feeds linking; base-path stripping,
  callback-path exemption, legacy URL rewrite, dev-only `SysDebug`
  removed from prod linking; Compose modal guards dirty exit through
  `beforeRemove` with a re-entrancy flag.
- Safe areas: provider at root; chrome (tab bar, strip, FAB, Lightbox,
  Compose sheet) uses a provider-optional inset hook.
- Lists: stable keys with session prefix, `memo` rows, scroll
  prefetch plus 2.5-screen threshold, refresh controls themed, empty /
  error / loading branches present on every list screen reviewed.
- Platform splits are minimal (`App.web`, `polyfills.web`, `tokens.web`)
  with matching exports; web-only code is guarded by `Platform.OS`/
  `typeof document`.

## Not covered

Not exhaustively reviewed: `Settings/*`, `ProfileEditor`, `Login*`,
`Drive/*`, `EmojiPicker`, `richtext/*`, `alf` token files, and
`Note.tsx`/`PostCard.tsx` beyond the sections cited.
