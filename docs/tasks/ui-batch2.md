# UI batch 2 — names, auto-translate, popup size, scroll layout, profile overlay, prefetch

Status: done
Branch: `main` (owner direction: main only)

## Goal

Nine fixes: themed display names, name==handle collapse, auto-translated
posts with source header, popup free-space sizing, composer scrolls with
feed, sticky profile tabs, drop recent reactions, edit-profile overlay,
earlier infinite-scroll fetch.

## Read first

- `state/STATE.md`, `docs/tasks/ui-fixes-popups-tabs-accounts.md`
- `src/components/DisplayName.tsx`, `src/components/Post/PostCard.tsx`
- `src/components/Popup.tsx`, `src/screens/HomeFeed.tsx`, `src/screens/User.tsx`

## Workstreams (disjoint file scopes — do not touch outside your list)

### A. Post content: names + auto-translate

OWNS: `src/components/DisplayName.tsx`, `src/components/Post/PostCard.tsx`,
`src/components/Post/PostQuote.tsx`, `src/components/Profile/ProfileHeader.tsx`
(name/handle lines ONLY), `src/components/Notification/NotificationRow.tsx`
(name color ONLY), + their tests. May READ `packages/fedi` helpers
(`displayNameOf`, `handleOf`) read-only.

1. `DisplayName` uses raw RN `Text` with no color (defaults black — the
   black-on-dark bug). Default to `theme.palette.text`; explicit style wins.
2. Name==handle collapse (v1): when the display name equals the handle,
   render the handle AS the display name (single line, no second smaller
   handle line). Applies to PostCard header, PostQuote, ProfileHeader,
   NotificationRow.
3. Auto-translate: `backend.translate` exists; viewer lang in post handlers.
   On mount, when `caps.translation` is supported and the post has text,
   auto-fetch the translation and render it INSTEAD of the body with a
   `Translated from XX · Show original?` header ABOVE the body; tapping
   shows the original (toggle back). Unsupported/failure/empty = original
   body, no header, silent. Gate the request sanely (skip when the post
   language already matches the viewer language if known). Never invent
   wire calls.

### B. Popup free-space sizing

OWNS: `src/components/Popup.tsx`, `src/components/__tests__/popup.test.tsx`.
`Menu.tsx` needs no changes (verify). No other files.

Popups no longer hang off-screen but render squished — smaller than the
space available. Diagnose `computePopupLayout`: the card should use the
free space on the chosen side (generous maxH, width up to CARD_MAX or the
content's needs) instead of collapsing. Keep the never-off-screen
guarantee (clamp + flip + resize re-measure). Prove with tests (measured
card uses available space; small content stays small; no overflow).

### C. Scroll layout: composer, sticky profile tabs, reactions out, prefetch

OWNS: `src/screens/HomeFeed.tsx` (FeedView + screens), `src/components/PostFeed/PostFeed.tsx`,
`src/components/Composer/CompactComposer.tsx`, `src/screens/User.tsx`,
`src/components/Profile/AccountReactions.tsx` (DELETE + remove usage),
`src/screens/Notifications.tsx` (prefetch threshold line ONLY), + their tests.
Does NOT touch `src/screens/ProfileEditor.tsx`, `src/Navigation.tsx`.

1. Composer scrolls away with the feed (today it's stuck at top): mount it
   as feed header content, not fixed chrome.
2. Profile: bio scrolls away, tab bar sticks to top while scrolling
   (implement inside FeedView — e.g. optional `scrollHeader` + sticky-tabs
   support — and wire it in `User.tsx`). Tabs stay visible; bio goes.
3. Delete the recent-reactions block from profiles (remove
   `AccountReactionsBlock` usage; delete the now-dead file if nothing else
   imports it).
4. Seamless infinite scroll: fetch the next page BEFORE the bottom
   (raise `onEndReachedThreshold` and/or add scroll-proximity prefetch in
   FeedView/PostFeed; same one-line threshold bump in Notifications list).
   No duplicate fetches (guard `isFetchingNextPage`/`hasNextPage` as today).

### D. Edit profile as overlay

OWNS: `src/screens/ProfileEditor.tsx`, `src/screens/ProfileEditor.test.tsx`,
`src/Navigation.tsx` (ProfileEdit entry ONLY), + nothing else. Does NOT
touch `src/screens/User.tsx` (the `navigate('ProfileEdit')` call keeps
working — the route itself becomes the overlay).

Convert Edit profile from a full page to a v1-style overlay: present
`ProfileEdit` as a transparent modal (like the Compose overlay), dismiss
on backdrop/close, no layout chrome changes. Keep all fields, gating, and
testIDs; update tests for overlay presentation.

## Acceptance

- [ ] No black-on-dark names in either theme; name==handle shows one line
- [ ] Foreign-language posts auto-translate with source header + Show original
- [ ] Popups use available space, never off-screen
- [ ] Composer scrolls with feed; profile tabs stick while bio scrolls away
- [ ] No recent reactions on profiles; edit profile is an overlay
- [ ] Next page loads before hitting bottom, no dup fetches, no spinners stalls
- [ ] Tests green for touched suites; tsc + lint clean on touched files

## Log

- `state/logs/2026-10-21-ui-batch2.md` (coordinator writes at end)
