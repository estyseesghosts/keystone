# UI fixes — popups on-screen, plain tabs, easy account switching, contrast safety

Status: done
Branch: `main` (owner direction: main only)

## Goal

Fix four UI complaints in one session: off-screen popup bubbles, chip/bubble
tab styling (v1 uses plain underline tabs), hard account switching, and
text/background contrast bugs (black-on-dark / white-on-white).

## Read first

- `state/STATE.md`
- `src/components/Popup.tsx`, `src/components/Menu.tsx`
- `src/components/Profile/ProfileTabs.tsx` (reference: already plain underline tabs)
- `src/components/Explore/ExploreTabBar.tsx`, `src/screens/Notifications.tsx`
- `src/Navigation.tsx` (AccountMenu/AccountButton), `src/components/AccountSwitcher.tsx`
- `src/alf/themes.ts`, `src/components/Button.tsx`

## Workstreams (disjoint file scopes — no overlap)

### A. Popup viewport safety — owns ONLY these files

- `src/components/Popup.tsx`, `src/components/Menu.tsx` (+ co-located tests)

Guarantee `AnchoredPopup` can never render off-screen on either axis:
clamp left/right, flip above/below, cap height with scroll, handle
resize/orientation + web scroll, clamp caret. All popups route through
`AnchoredPopup`, so the infra fix covers every call site.
MUST NOT touch `src/Navigation.tsx`, tab files, account files, or theme files.

### B. Plain boring tabs — owns ONLY these files

- NEW `src/components/Tabs.tsx` (shared underline tablist, v1 style)
- `src/components/Explore/ExploreTabBar.tsx`
- `src/screens/Notifications.tsx` (filter + grouping rows only)
- `src/screens/Explore.tsx` (tab/filter rows only — NOT the suggest popup)
- `src/components/Profile/ProfileTabs.tsx` (migrate to shared, visuals unchanged)
- (+ their co-located tests)

Replace pill/`Button`-variant tab rows with the plain underline tablist
(active = 2px underline + strong text, inactive = muted text, no pills).
MUST NOT touch popup, Navigation, account, or theme files.
`ReactionChips` (content, not navigation) and composer option chips stay.

### C. Easy account switching + contrast — owns ONLY these files

- `src/Navigation.tsx` (AccountMenu/AccountButton only)
- `src/components/AccountSwitcher.tsx`, `src/screens/Login.tsx` (account section only)
- `src/screens/Settings.tsx` (account section only, if touched)
- Contrast: `src/components/Lightbox.tsx`, `src/components/Dialog.tsx`,
  `src/components/icons.tsx`, `src/components/Button.tsx`,
  `src/components/Post/ActionBar.tsx` (color props only, NOT popup anchoring),
  `src/alf/typography.tsx` (only if a bug is found there)
- (+ co-located tests)

Account menu gets the full account list (avatar + name + origin),
one-tap switch, active label, Add account, Settings shortcut — in both
sidebar and mobile strip. Fix every hardcoded black/white fg/bg pair to
use `theme.palette` so text always contrasts its background in both themes.
MUST NOT touch `src/components/Popup.tsx`, `src/components/Menu.tsx`,
or any tab files from stream B.

## Acceptance

- [ ] No popup can render off-screen (both axes, both themes, phone + rail widths)
- [ ] Explore / Notifications / Profile tabs are plain underline tabs, no pills
- [ ] Account switch is one tap from sidebar AND mobile strip
- [ ] No hardcoded black-text-on-dark or white-text-on-light pairs remain in owned files
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green (coordinator runs)
- [ ] Coordinator commits once on `main`

## Log

- `state/logs/2026-10-21-ui-fixes.md` (coordinator writes at end)
