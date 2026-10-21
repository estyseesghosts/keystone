# Contrast sweep — no black-on-dark / white-on-light anywhere

Status: done
Branch: `main` (owner direction: main only)

## Goal

Eliminate EVERY hardcoded/unthemed foreground color in the app so black
text on dark backgrounds (and white on light) is impossible in either
theme. Prior fixes (DisplayName, icons) were piecemeal; this is the
exhaustive pass.

## Method (all streams)

1. Grep for: `#[0-9a-fA-F]{3,8}`, `black`, `white`, `rgb(`, `rgba(`,
   raw `<Text` without a theme color, `placeholderTextColor`,
   `selectionColor`, `tintColor`, `fill=`/`stroke=` in SVG/icons,
   `color=` props with literals, `StyleSheet` color literals, web-only
   `style={{color:` literals.
2. Every foreground color must resolve to `theme.palette` (text/muted/
   faint on bg/bgSoft/raise as appropriate) in BOTH themes. Backgrounds
   behind text must be explicit and paired (no transparent text over
   unknown surfaces).
3. Raw RN `Text` with no color defaults to black — forbidden. Route
   through `#/alf/typography` or apply `theme.palette.text`.
4. Fix + add/extend a regression test proving the themed color in both
   themes (light + dark render, assert color prop or computed style).
5. Run touched suites + `tsc` + `oxlint`/`eslint` on touched files.

## Workstreams (disjoint — do not touch outside your list)

### A. Feed content rendering

OWNS: `src/components/Post/**`, `src/components/Composer/**`,
`src/components/Explore/**`, `src/components/Media*`,
`src/components/Emoji*`, `src/components/Loader.tsx`,
`src/components/RichText*` (if exists), `src/components/Content*` (if
exists), `src/components/PendingEmoji.tsx`, + their tests.

Content bodies (MFM/plain text, CW, polls, quotes, link previews),
composer chrome, explore rows. Watch: content AST renderers, link colors,
poll bars, placeholder text, emoji fallbacks.

### B. Chrome + settings + lint rule

OWNS: `src/components/*.tsx` top-level (Button, Menu, Popup, Dialog,
DisplayName, icons, Pressable, Pagehead, AccountSwitcher, SignInButton,
Lightbox, Tabs, ComposeFab, NotificationRow wrappers), `src/components/Profile/**`,
`src/components/ProfileActions/**`, `src/components/Settings/**`,
`src/components/Notification/**`, `src/alf/**` (read themes/tokens/
typography; fix only if the bug is there), `lint-rules/` + eslint config
(small additive `no-hardcoded-color` rule with one test per existing
lint-rule pattern), + their tests.

Also: add the lint rule so this never recurs (follow the existing
custom-rule pattern in `lint-rules/`; wire into eslint config; prove it
fails on a planted literal and passes after removal).

### C. Screens + shell + misc

OWNS: `src/screens/**`, `src/Navigation.tsx`, `src/routes.ts`,
`src/App.tsx`, `src/Root.tsx`, `src/platform/**`, `src/state/**` (UI
parts only — read-only elsewhere), `src/lib/**`, `src/storage/**`,
+ their tests. Plus a read-only grep over `packages/fedi/src` for
color literals (report only — data layer must stay UI-free; do NOT edit
packages).

Shell chrome, pageheads, lists, settings screens, login, errors,
empty states, toasts, refresh controls, activity indicators, status bar
/ system UI colors.

## Acceptance

- [ ] Zero color literals (`#`, black/white/rgb) in `src/` outside
  `src/alf/themes.ts` and the lint-rule fixture
- [ ] Zero raw colorless `<Text>` in `src/`
- [ ] New lint rule green on clean tree, red on planted literal
- [ ] Touched suites green; `tsc` + lint clean on touched files

## Log

- `state/logs/2026-10-21-contrast-sweep.md` (coordinator writes at end)
