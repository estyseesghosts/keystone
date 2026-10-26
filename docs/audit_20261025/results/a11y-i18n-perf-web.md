# Audit: a11y / i18n / perf / web / error hygiene

Scope: /Users/terezi/keystone2 `src/` (static read; nothing run). No `src/features` exists, so there is no deck/columns/widgets code to audit. Only issues confirmed in code are listed.

## Summary

- i18n is the biggest gap. Lingui is wired (8 locales, `i18n.ts`), but only 48 of the non-test `.tsx` files use it. Almost every file in `src/screens/` outside Home, Note, User, Notifications, Explore, Login and Network has zero `msg`/`Trans`. No `plural()` is used anywhere.
- The Lightbox opens at the wrong image for any index above 0, and is the one clear functional bug found.
- A11y basics are decent (Button roles and labels, 44dp targets, reduced motion for dialogs). Gaps: toasts are not announced, dialogs have no modal semantics, headings have no role, some chips are unlabeled, `faint` text fails contrast, and there is no error boundary.
- Timer and listener cleanup was mostly clean.

## Findings

### 1. [High] Lightbox ignores its initial `index`
`src/components/Lightbox.tsx:114-150` (opened from `src/components/Post/PostCard.tsx:1039,1047`)
- The pager `ScrollView` has no `contentOffset` and no `scrollTo`. `safe` is derived from the `index` prop. Only `onMomentumScrollEnd` reports changes back.
- Scenario: a post has 4 images and the user taps image 3. The counter reads "3 / 4", the caption and alt text are for image 3, and only frame 3 is `active` (so a video there plays), but the viewport shows image 1. Alt text and the visible image disagree.
- On web, wheel and keyboard scrolling may not fire `onMomentumScrollEnd` either. There are no arrow-key handlers.
- Fix: pass `contentOffset={{x: safe*width, y: 0}}` and scroll on `width` or `index` change. Add ArrowLeft/ArrowRight on web.

### 2. [High] Most screens are untranslated
Zero `msg`/`Trans` in these files, among others:
- `AdminInsight.tsx`, `AdminReportsList.tsx`, `AdminReportDetail.tsx`
- `Announcements.tsx`, `Antenna.tsx`, `Antennas.tsx`, `Channel.tsx`, `Channels.tsx`
- `ChatRoom.tsx`, `ChatRooms.tsx`, `ChatThread.tsx`, `ChatUser.tsx`
- `Clip.tsx`, `Clips.tsx`, `Compose.tsx`
- `Conversation.tsx`, `Conversations.tsx`
- `Drive.tsx` and `Drive/*`
- `Followers.tsx`, `Following.tsx`, `FollowRequests.tsx`, `Home.tsx`
- `List.tsx`, `Lists.tsx`, `Favorites.tsx`

Examples:
- `Clips.tsx:50-206`: labels "New clip", "Cancel", "Rename", "Keep", "Delete".
- `Compose.tsx:128`: `accessibilityLabel="Close composer"`.
- `Following.tsx:190`: `Pagehead title="Following"`.
- `Drive/detail.tsx:164-184`, `AccountReactions.tsx:78,87`
- `Note.tsx:197,693,1175,1198,1291`: "Open profile of …", "Post details", "Retry".
- `PostFeed.tsx:107,141-144`: "Show N new posts", "Couldn't load this feed", "Retry".
- `RecommendationReasonDialog.tsx:36+`
- `RecommendationsSettingsOverlay.tsx:~404-440`: "Interested in", "Not interested in", "Saving…".
- Scenario: a Japanese user sees English everywhere except the translated shells. Screen-reader labels are also English.
- Fix: add an ESLint rule (as AGENTS.md §5 suggests) against bare JSX text and string `label`/`title`/`placeholder`/`accessibilityLabel` props. Then sweep.

### 3. [Medium] No plural handling; hand-rolled English plurals
- No `plural(` or `<Plural` in `src/`.
- `AdminReportsList.tsx:107` builds `post${n===1?'':'s'}`.
- `PostFeed.tsx:107` builds "Show N new posts". Hindi, Japanese and others need real plural rules.
- Fix: use Lingui `plural`.

### 4. [Medium] Time strings are untranslated and ignore the app locale
- `src/components/Post/time.ts:15` returns a literal `'now'`.
- `time.ts` takes `locale` as an optional argument, and `NoteHistory.tsx:55-56` and `Announcements.tsx:118` omit it. They use the device locale, not the app locale chosen in `i18n.ts`. NoteHistory also has hardcoded "Original ·" and "Edited ·".
- `PostPoll.tsx:36-42` returns "closing soon", "in under a minute", "in 5m" and "on <date>" as English literals with `toLocaleDateString()` and no locale.
- `Announcements.tsx:126` ("Until …"), `ComposerSections.tsx:548` and `CompactComposer.tsx:450` call `toLocaleDateString()`/`toLocaleString()` with no locale.
- File sizes are formatted with `.toFixed` plus English units in `AdminInsight.tsx:88`, `Drive/rows.tsx:36` and `PostMediaGrid.tsx:97-98`. There is a locale-aware `Intl.NumberFormat` helper in `i18n.ts:163-174`, but these do not use it.
- Fix: route all of these through one locale-aware formatter bound to the app locale.

### 5. [Medium] Timestamps never refresh
`PostCard.tsx:901` computes `formatRelativeTime` at render time and nothing ticks. "now" or "5m" stays stale until something else re-renders the row. This is minor on active feeds but wrong on an idle tab.
- Fix: add a shared minute ticker via `useSyncExternalStore`.

### 6. [Medium] Toasts are not announced to assistive tech
`src/components/ToastHost.tsx:25` uses `pointerEvents="none"`. `Toast.tsx` has no `accessibilityRole="alert"`, `accessibilityLiveRegion`, `aria-live` or `AccessibilityInfo.announceForAccessibility`. A repo-wide grep finds none of them.
- Scenario: a screen-reader user posts or hits an error and hears nothing.
- The fixed 4s timeout has no pause on hover or focus (WCAG 2.2.1).
- Fix: add live region semantics, and pause the timer on hover or focus.

### 7. [Medium] Dialogs and menus lack modal semantics
- `Dialog.tsx:63-76`: the sheet `Animated.View` has only `accessibilityLabel`. There is no `role="dialog"`, `aria-modal` or `accessibilityViewIsModal` (grep: none in `src/`).
  - On iOS, VoiceOver can reach the content behind it.
  - Focus is never moved into the dialog, and there is no focus return on close.
- Escape handling is document-level in `Dialog.tsx`, `Popup.tsx` and `Menu.tsx` (`Dialog.tsx:34-40`, `Popup.tsx:196-202`, `Menu.tsx:80-105`).
  - `e.stopPropagation()` on a document listener does not stop sibling document listeners.
  - A Menu opened inside a Dialog, or a stacked popup, would close both on one Escape.
  - Fix: use a single keyboard-layer stack.
- The Dialog close "✕" is a text glyph inside a `Heading`. It is labeled, so this is OK, but see 8.

### 8. [Medium] Unlabeled and unsemantic controls
- `RecommendationsSettingsOverlay.tsx:408-446`: the topic chips (`{t} ✕`, `+ {t}`) are Pressables with no `accessibilityRole`. A screen reader announces "t ✕" or "plus t", and cannot tell add from remove.
- `Tabs.tsx:50`: tab Pressables have a role and selected state but no label (text child only; acceptable). `MobileStrip.tsx:51` is OK for the same reason.
- `Heading` (`alf/typography.tsx:44`) never sets `accessibilityRole="header"`. Screen-reader heading navigation does not work. `Pagehead` titles and Dialog titles are affected.
- `RecommendationReasonDialog.tsx:44-45`: formatting is mangled (two JSX statements on one line). This is cosmetic but suggests it was never reviewed.

### 9. [Medium] Contrast on `faint` text
`src/alf/themes.ts`:
- Light `faint` #999999 on #ffffff is about 2.8:1, which fails AA 4.5:1.
- Dark `faint` #7a7a7a on #111111 is about 4.4:1, a marginal fail.
- `color="faint"` is used in about 252 places. Muted on `raise` backgrounds is near the limit.
- Disabled Buttons use `opacity: 0.5` over their text.
- Fix: darken light faint to about #767676, lighten dark faint to about #8a8a8a, and keep `faint` for non-essential text only.

### 10. [Medium] No error boundary or crash reporting
Grep for `ErrorBoundary`, `componentDidCatch`, `ErrorUtils` and `unhandledrejection` returns nothing in `src/`.
- Any render throw (for example a malformed post from a server) white-screens the whole app on native and web.
- Fix: add a root boundary with a recover or reload UI, plus a per-row boundary in the feed lists.

### 11. [Low] Focus ring removed on the composer
`Composer.tsx:198-199` and `CompactComposer.tsx:548-549` set `outlineWidth: 0`. This is intentional for chrome-free prose, but keyboard users get no focus indicator. The caret is the only cue.
- No custom `:focus-visible` styling exists elsewhere on web either (grep for `outline`, `focusable`, `tabIndex`). The shared Pressable shows only an opacity change on press, with no focus or hover state. Keyboard focus on Buttons relies on the browser default ring.

### 12. [Low] Hover cards are mouse-only
`Profile/HoverPreview.tsx` and `richtext/MatrixHover.tsx` use `onMouseEnter`/`onMouseLeave` only. Keyboard focus never opens the card. The link itself is still navigable, so this is only a loss of preview. Also, `HoverPreview.tsx:338-354` restarts its `setInterval` whenever the `onDismiss` identity changes, so it depends on the caller memoising it. It does clean up.

### 13. [Low] Lightbox chrome and media
- `Lightbox.tsx:164` has a hardcoded "Close" label.
- The "N / M" counter is not a live region, so swipes are not announced.
- `PostMediaGrid.tsx:97-98` shows English size units.

### 14. [Low] Logging hygiene
- Only 2 `console.*` calls in non-test code: `Conversation.tsx:104` (warn) and `PostPoll.tsx:134` (error).
- No central logger. Failures such as autocomplete `catch {}` in `Explore.tsx` and `Autocomplete.tsx` swallow errors silently (deliberate, documented).
- A failed poll vote logs to console only; confirm the UI also tells the user.

### 15. [Low] RTL
No `I18nManager`/`isRTL`/`writingDirection` handling. The locales shipped (en, fr, de, zh, ja, hi, yue) are all LTR, so this is only a future risk. There are many `left:`/`right:`/`marginLeft` uses (about 49 matches, for example `Toast`, `Lightbox` insets).

## Looked solid

- **Timer and listener cleanup:** `Autocomplete.tsx`, `Composer.tsx` (draft autosave), `ToastHost`, `Explore.tsx` (suggest debounce, generation counter), `recommendationDwell.ts` (interval cleared, with a flush on unmount), `Popup`/`Dialog`/`Menu` keydown handlers, `HoverPreview` and `MatrixHover` timers (all three cleared in an unmount effect).
- **`HoverPreview` DOM layer:** created in an effect and removed on cleanup. Window listeners are guarded by `typeof window`, `typeof document` and `Platform.OS` checks, so there are no SSR-unsafe module-level globals. `index.web.ts` and `App.web.tsx` are trivial.
- **`motion.ts`:** reduced-motion store, subscribed via `useSyncExternalStore`, used by `Dialog`, `Popup` and `Lightbox`. There are few animations overall.
- **`Button`:** role, label, disabled state, `disabledReason` in the label, a 44dp minimum height (36 for compact), and a base `Pressable` with `hitSlop` 8.
- **Lists:** FlatList windowing is configured (`windowSize` 7, `initialNumToRender` 6, `keyExtractor` namespaced by `sessionId`), with a deliberate comment about avoiding `getItemLayout`.
- **Theme:** hardcoded colors are lint-banned (`no-hardcoded-color`), with a single overlay-chrome constant. Dark mode and text scale are in the theme provider.
- **Images:** the avatars/media sampled carry alt text. Lightbox frames use `mediaAlt`.
- **Locale store:** validated parse with an `'en'` fallback. `Intl.NumberFormat` helper in `i18n.ts`.
- **Feed addressing / session keys:** `sessionId` is in the keyExtractor.

## Not applicable

No deck, columns or widgets code exists (`src/features` is absent), so nothing was audited there.
