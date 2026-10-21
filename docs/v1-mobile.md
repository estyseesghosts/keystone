# v1 reference carry: mobile.md
> Source: /Users/terezi/Local Documents/Keystone/docs/mobile.md
> Carried: 2026-10-21 — verbatim copy (this header added).
> Reference only — v2 requirements live in docs/parity-gaps.md.

---

# Keystone: Mobile UI Implementation Plan

## Objective

Create a deliberate, touch-friendly mobile interface for Keystone while preserving the existing desktop layout.

Keep the existing SolidJS SPA, route components, backend integrations, theme system, and authentication flows. Add a mobile-specific presentation rather than rebuilding the application.

## 1. Non-negotiable constraints

- Do not change the desktop layout, sidebar geometry, timeline width, desktop composer presentation, or desktop window decorations.
- Scope mobile-specific changes to the existing mobile breakpoint: `max-width: 720px`, unless testing demonstrates a specific reason to adjust it.
- Do not change the appearance of widths above 720px as part of this task. The existing 721–1000px icon rail must continue working.
- Keep SolidJS and `@solidjs/router`. Do not introduce React, React Native, another navigation framework, or a second implementation of the screens.
- Preserve all existing functions, including account switching, accessibility settings, reply threads, MFM, media, polls, content warnings, drafts, and notifications.
- Respect the existing theme contracts. Use CSS variables and existing scoped theme styles; do not introduce a new default accent palette.

## 2. Mobile navigation

### Primary navigation

Create a dedicated mobile navigation component instead of simply converting the complete desktop sidebar into a horizontally scrollable bottom bar.

Use five primary destinations (owner direction — Profile joined the original four):

1. **Home** — retain the existing Home experience.
2. **My Network** — a unified feed screen with Local, Social, and Federated tabs.
3. **Search** — retain existing search functionality.
4. **Notifications** — retain the existing notification screen.
5. **Profile** — the signed-in account's own profile (`/users/:id`); signed-in only, like Notifications.

The composer should be a separate floating action, not another primary tab. The account menu should remain available from the mobile header.

Reuse the existing routes wherever possible. Implement My Network's feed selection using supported backend capabilities; define precisely what Social means for each server family rather than silently aliasing it to Home.

### Account access

Reuse `AccountCard` and its existing account menu. It already provides profile navigation, settings, and account switching.

Do not add a second account drawer with duplicated functionality. Ensure that settings, mutes, blocks, and other secondary functions remain reachable.

### Navigation behavior

- Preserve normal URL navigation, browser back/forward, direct links, and deep-linkable note/profile pages.
- Maintain independent scroll positions and cached content when switching feeds.
- Remember the selected My Network tab when opening a post and returning.
- Keep navigation available on all relevant routes, including settings and profile pages.
- Provide clear current-tab indicators and accessible names for icon-only controls.

Use Bluesky as a reference for interaction behavior, not as a requirement to duplicate its React Navigation stack architecture.

## 3. Mobile shell and safe areas

Make changes within mobile-specific CSS rules and, where necessary, add a separate `MobileNav` component to `Layout.tsx`.

The mobile shell should contain:

- A compact app header with the existing account control.
- A single-column content region.
- A fixed bottom navigation bar.
- A floating compose action that does not obscure content or controls.

Keep the existing desktop `.sitenav` presentation unchanged. Avoid sharing mobile-only positioning or sizing rules with the desktop navigation.

### Safe areas

Update `frontend/index.html` to use:

`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`

Apply safe-area insets to the header, bottom navigation, floating action, and full-screen overlays. Preserve ordinary horizontal page margins in addition to safe-area padding.

Use dynamic viewport sizing where appropriate, and test behavior when the mobile keyboard opens. Do not assume that fixed `100vh` sizing behaves correctly on every mobile browser.

## 4. Timeline and content layout

The existing timeline is already largely flat, with posts separated by borders. Preserve that visual language.

On mobile:

- Use the available viewport width without horizontal scrolling.
- Adjust horizontal padding only where necessary for readability.
- Keep avatars, author identity, timestamps, reply context, repost indicators, and quote-posts legible.
- Avoid nested decorative cards and excessive spacing.
- Preserve thread connectors and nested replies.
- Give interactive controls approximately 48px square hit areas where practical, without making action rows excessively wide.
- Preserve media's intrinsic aspect ratio. Constrain very tall content only when needed, without cropping away meaningful content.
- Keep content warnings, MFM formatting, polls, reactions, and link previews functional.

Do not reduce font sizes globally to compensate for poor layout. The default body size is already approximately 15px, and Keystone supports user-controlled text scaling.

## 5. Header and sticky content

Coordinate the mobile app header, page headings, and any sticky profile tabs.

Do not let multiple elements independently stick to `top: 0` and overlap.

For profiles, allow the banner and bio to scroll away while keeping Posts, Replies, and Media navigation reachable. Position the sticky tabs below the persistent app header, or use a route-specific header that replaces it.

Apply these changes only to the mobile layout; retain the existing desktop profile layout.

## 6. Composer

Reuse the existing `FloatingComposer`, `Composer`, and postbox state.

### Presentation

On mobile, present the composer as a full-viewport editor rather than a centered, rounded modal card. Give it a clear close action, a prominent Post action, and an editor area that resizes correctly when the keyboard opens.

Keep the existing composer functionality, including supported attachment workflows, content warnings, polls, visibility controls, scheduling, replies, quotes, and drafts. Do not remove capabilities to simplify the UI.

### Draft safety

Preserve the existing local and server-side draft flows. Closing the editor must never silently discard user-entered content.

A swipe-to-dismiss gesture is optional and should not be implemented at the expense of browser back behavior, keyboard interactions, or accessibility. An explicit close button with reliable draft preservation is mandatory.

Do not display both a full inline composer and a competing floating composer on mobile. Prefer a compact write affordance that opens the existing full editor.

## 7. Interaction and accessibility

- Use large touch targets with adequate separation.
- Provide visible focus styles and accessible labels.
- Maintain logical keyboard and screen-reader navigation.
- Prevent the bottom bar, FAB, and modal actions from covering each other.
- Preserve loading, empty, error, logged-out, and unsupported-feature states.
- Keep a non-gesture way to perform every important action.
- Ensure long text, large user-selected fonts, landscape mode, and narrow devices do not hide the primary navigation.

## 8. Implementation sequence

### Slice A — Baseline and audit

Inspect `Layout.tsx`, `global.css`, `index.html`, `AccountCard.tsx`, `FloatingComposer.tsx`, and the route components.

Capture representative desktop and mobile screenshots before changing the code. Identify any controls visible in screenshots that are native window chrome rather than SPA elements.

Deliverable: a short audit of the existing mobile behavior and a baseline screenshot set.

### Slice B — Navigation

Implement the dedicated mobile bottom navigation and My Network screen. Reuse existing routes and backend adapters wherever possible.

Deliverable: stable four-destination mobile navigation, working My Network feed tabs, preserved account access, and no regression to the desktop sidebar.

### Slice C — Responsive shell

Complete safe-area handling, header positioning, content spacing, and navigation/action-bar overlap prevention.

Deliverable: a single-column mobile shell that works in portrait and landscape.

### Slice D — Timeline and profiles

Refine mobile post spacing, action targets, media sizing, profile tabs, thread navigation, and scroll restoration.

Deliverable: readable, touch-friendly feeds and profile pages without changes to desktop styling.

### Slice E — Composer

Add mobile-only full-screen styling to the existing modal, preserve all supported composer features, and test keyboard resizing and draft restoration.

Deliverable: a full-screen writing experience with no data loss and no desktop composer changes.

### Slice F — Verification

Run the existing build, type checks, tests, and relevant backend smoke tests.

Compare before-and-after desktop screenshots at identical viewport sizes. Any unintentional desktop difference is a regression.

## 9. Acceptance criteria

- Desktop layout and styling remain unchanged above 720px.
- Mobile navigation has no horizontal scrolling and remains reachable on every relevant route.
- Home, My Network, Search, and Notifications work; My Network's three feed tabs use the correct backend semantics.
- Feed state and scroll position survive navigation where expected.
- Profiles, replies, media, and nested threads remain usable on small screens.
- The composer opens full-screen on mobile and safely preserves drafts.
- Safe areas and the on-screen keyboard do not obscure controls.
- Controls meet touch-target and accessibility requirements.
- Both Keystone themes retain their intended visual identities.
- `npm run build`, `npm run typecheck`, and `npm test` pass.
- Desktop screenshot comparisons show no unintended layout changes.

## Relevant source files

- `frontend/src/components/Layout.tsx`
- `frontend/src/components/AccountCard.tsx`
- `frontend/src/components/TimelineFeed.tsx`
- `frontend/src/components/FloatingComposer.tsx`
- `frontend/src/components/Composer.tsx`
- `frontend/src/styles/global.css`
- `frontend/src/styles/keystone-terminal.css`
- `frontend/index.html`

Keep each slice small and independently verifiable. Do not combine the navigation rewrite, composer redesign, and timeline redesign into one large patch.
