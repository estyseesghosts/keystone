# Keystone UI Polish + Widgets — Agent Implementation Plan

**Status:** Ready to implement  
**Target:** Keystone v2 (Expo + React Native + React Native Web)  
**Priority:** P1 for thread ordering, responsive layout, and widget rail; P2 for interaction polish  
**Scope:** Focused UI changes; preserve Keystone's existing visual identity and working behavior.

## Objective

Polish the desktop shell, fix the visible reply-chain ordering problem, and introduce a configurable widgets rail whose widget definitions, instances, and renderer are reusable by a future TweetDeck/Misskey Deck-style interface.

The widget system must **not be implemented as a collection of components owned by the right rail**. The right rail is one layout host for widgets, not the widget system itself.

## Required repository workflow

Before editing, follow `AGENTS.md`'s mandatory read order: read `state/STATE.md`, the latest relevant session logs, and the relevant plan/task files. Confirm the working tree and branch. Inspect the current shell, thread rendering, settings/storage patterns, popup/dialog components, and existing tests before choosing exact files.

Use existing ALF tokens, themes, controls, breakpoints, storage abstractions, and test conventions. Keep changes scoped to the slice being implemented. After each slice, run:

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Record actual results and any unverified web/device checks in a new `state/logs/` entry. Follow `AGENTS.md` for state/task bookkeeping. Do not claim that browser or native behavior was verified unless it was actually run.

## Deliverable 1 — Reply-chain chronology

### Requirements

- [ ] In a conversation thread, show the oldest/root post first and the newest reply last: top-to-bottom reading order is chronological.
- [ ] Preserve the main timeline's newest-first order. This change applies only to posts within a conversation/thread.
- [ ] Preserve reply parentage, sibling branches, existing chain/reveal behavior, loading/error/empty states, and cycle/depth safeguards.
- [ ] Keep existing repost attribution and quote-post presentation unchanged.
- [ ] Verify ordering for Misskey-family and Mastodon thread results, including nested replies and sibling branches.

### Investigation constraint

`src/screens/Note.tsx` currently defines a `chronological()` helper that sorts by `createdAt` ascending. Do **not** blindly reverse the existing array or assume the API response is the sole cause. Reproduce the actual incorrect display, then trace query results, per-level chain selection, branch rendering, and any final list ordering. Fix the layer that causes the visible inversion and add regression tests for the rendered order.

### Acceptance tests

- [ ] A → B → C renders A above B above C.
- [ ] Branches retain correct parent/child relationships, and siblings are chronological.
- [ ] The latest reply is at the bottom of the visible chain/reveal sequence.
- [ ] The main feed remains newest-first.
- [ ] Existing quotes, repost attribution, pagination/reveal behavior, and cycle safeguards do not regress.

## Deliverable 2 — Responsive desktop shell and independent side panels

### Requirements

- [ ] Use three logical regions where the viewport allows: left navigation, central feed, and right widgets panel.
- [ ] Make feed width fluid: it should grow or shrink with available space and panel visibility, rather than remain a hard-coded fixed-width column.
- [ ] Account for the width of visible panels when sizing the feed. No blank reserved column when a panel is collapsed.
- [ ] Keep left navigation and right widgets visibility/modes independent. Toggling one must not toggle or reset the other.
- [ ] Reuse the existing left sidebar mode and layout state where practical; do not create a competing left-sidebar state system.
- [ ] Collapse the right panel to zero layout width when hidden and provide a clear way to restore it.
- [ ] At narrow widths, avoid squeezing three columns together: hide the widgets panel or expose it through an appropriate existing drawer/panel pattern. Preserve the mobile navigation model.
- [ ] Reuse `useViewportWidth`, current breakpoint utilities, ALF tokens, and existing shell primitives. Add or change breakpoints only where visual testing demonstrates a need.
- [ ] Keep the widgets panel as a host/container; widget implementations must not import or depend on shell layout components.

### Acceptance criteria

- [ ] Layout remains balanced with both panels open, either panel collapsed, and both collapsed.
- [ ] Feed width responds to the available viewport and panel state without overflow, jitter, or unexplained empty columns.
- [ ] Panel visibility states are independent.
- [ ] Desktop, intermediate/rail, and mobile widths remain usable.
- [ ] The right panel can be restored from its collapsed state without losing widget configuration.

## Deliverable 3 — Reusable widget architecture

### Architectural rule

Separate **widget types**, **widget instances**, **placements/layouts**, and **the rail container**. A widget must not know that it is inside the right rail. The future deck UI must be able to host the same widget types/renderer without importing or reusing the rail component.

### Proposed model

Adapt names to existing conventions, but preserve these conceptual boundaries:

- **Widget definition/registry:** Describes an available widget type (stable type ID, title/description, and renderer). The registry is the source for the editor's available-types list.
- **Widget instance:** A stable unique instance ID, type ID, and serializable per-instance configuration. Multiple instances of one type must be allowed.
- **Widget placement/layout:** An ordered list of instance references owned by a layout/container. The current right rail is one layout. Future deck columns/layouts can own other placements without changing widget implementations.
- **Widget renderer/host:** Resolves an instance against the type registry and renders it. It must not contain right-rail-specific sizing, ordering, persistence, or visibility logic.
- **Right rail:** A shell-level layout host that renders the configured placements, handles rail-specific empty state/collapse controls, and opens the widget editor.

A serializable model could be shaped like this (adapt it; do not add unnecessary abstraction):

```ts
type WidgetInstance = {
  id: string
  type: string
  settings: Record<string, unknown>
}

type WidgetPlacement = {
  instanceId: string
}

type WidgetLayout = {
  id: string
  placements: WidgetPlacement[] // array order is display order
}
```

Persist widget instances and layouts through the existing local settings/storage seam. Keep rail visibility/width state separate from widget configuration. Do not place React components or non-serializable values in persisted state.

### Initial placeholder types

- [ ] Implement one generic empty-placeholder widget type in the registry.
- [ ] First-run/default rail configuration contains two distinct placeholder **instances** of that type, with different stable instance IDs.
- [ ] Each placeholder has a consistent widget header and designed empty-state body. It must not show fabricated posts, trends, users, or server data.
- [ ] Additional placeholder instances can be added from the editor. Duplicate instances of the same type are valid.
- [ ] When the user removes all widgets, the rail stays genuinely empty after reload. Distinguish “no saved configuration yet; seed defaults” from “the user intentionally saved an empty layout.” Do not repopulate the two defaults on every mount.

### Acceptance criteria

- [ ] Widget definitions/components can render without mounting the right rail.
- [ ] Rail order is represented by placements/references, not component-specific hardcoding.
- [ ] Instances have stable IDs through reordering and rerenders.
- [ ] Multiple instances of one type work correctly.
- [ ] Persistence stores only serializable configuration.
- [ ] Architecture leaves a clear path for future deck containers/columns without implementing the deck now.

## Deliverable 4 — Widget rail and editor interactions

### Rail

- [ ] Render the default two placeholder instances in the right rail.
- [ ] Provide a visible “Edit widgets” or equivalent entry point.
- [ ] Render an intentional empty state when no widgets are configured, with a route back to the editor.
- [ ] Collapsing the rail does not delete widgets or change their order.
- [ ] Widget content can scroll within the rail without breaking the feed's scrolling behavior.

### Editor

- [ ] Open an editor using existing dialog, popup, or panel patterns; do not create an unrelated navigation subsystem.
- [ ] Show current widget instances and their order.
- [ ] List available widget types from the registry.
- [ ] Add a widget: create a new instance with a unique stable ID and append its placement to the active rail layout.
- [ ] Remove a widget from the active layout.
- [ ] Reorder widgets through drag-and-drop where supported by the existing cross-platform stack.
- [ ] Provide accessible move-up/move-down controls as a reorder alternative; drag must not be the only method.
- [ ] Save configuration through the existing persistence abstraction and restore it on application reload.
- [ ] Keep widget configuration separate from the editor's open/closed state and from rail visibility state.

### Interaction details

- Removing an item means removing its placement from the current layout. Keep the model safe for future layouts that may reference an instance; remove unreferenced instances only when doing so is straightforward and cannot invalidate another layout.
- Reordering must change placement order without changing instance IDs or widget settings.
- Prefer the existing React Native gesture/accessibility primitives. Do not add a drag-and-drop dependency unless repository inspection proves existing tools insufficient and the reason is recorded.

### Acceptance test flow

1. Fresh configuration shows exactly two placeholder widgets.
2. Open the editor and add a third placeholder.
3. Reorder the widgets and confirm their identity/content stays with each instance.
4. Remove one widget and confirm the remaining order is correct.
5. Remove all widgets, reload, and confirm the intentional empty state remains empty.
6. Collapse and reopen the right rail; the widget arrangement remains unchanged.

## Deliverable 5 — Navigation and interaction polish

### Requirements

- [ ] Audit existing interactions across navigation, tabs, post actions, menus, buttons, and widgets.
- [ ] Apply consistent hover feedback to controls that currently lack it. Existing user-profile hovercards and Matrix-handle hover behavior must be preserved.
- [ ] Make active navigation states clear and consistent, including icon-only navigation.
- [ ] Add tooltips to icon-only navigation items and ambiguous icon buttons, using existing popup/tooltip patterns where possible.
- [ ] Improve spacing/group separation between existing navigation groups without adding new destinations or changing route semantics.
- [ ] Ensure visible keyboard focus and useful accessible labels for icon-only buttons, tooltips, panel toggles, editor actions, and reorder controls.
- [ ] Hover feedback must be supplemental; touch and keyboard interaction must remain complete.
- [ ] Use existing theme tokens and component primitives rather than introducing a new visual system.

### Acceptance criteria

- [ ] Active, hover, focus, pressed, and disabled states are visually consistent for comparable controls.
- [ ] Icon-only controls can be identified without guessing.
- [ ] Tooltips do not cover the control or make nearby targets difficult to click.
- [ ] No hover-only action is required to use the app.
- [ ] Navigation grouping improves scanability without changing the information architecture unnecessarily.

## Deliverable 6 — Regression and visual verification

### Automated coverage

- [ ] Unit tests for widget defaults, add/remove/reorder, stable IDs, persistence hydration, version/invalid-state fallback, and intentionally empty configuration.
- [ ] Component tests for editor entry point, listing available types, adding/removing widgets, reordering, empty state, and rail collapse/restore.
- [ ] Layout tests for independent left/right state and representative viewport widths using existing breakpoint test conventions.
- [ ] Reply-chain ordering tests covering root-first chronology, nested descendants, sibling branches, and unchanged newest-first feed order.
- [ ] Preserve existing quote-post and repost rendering tests; add regression assertions only if a changed shared component puts them at risk.

### Verification

- [ ] Run `pnpm typecheck && pnpm lint && pnpm test` after each implementation slice.
- [ ] Run a web build and inspect the app at a wide desktop width, an intermediate width, and a phone-width viewport when the environment permits.
- [ ] Verify keyboard interaction and touch/native behavior where available.
- [ ] Record screenshots or command output for checks actually completed; mark unavailable checks `not verified`.

## No-gos

- Do not redesign the whole application or replace Keystone's visual identity.
- Do not hard-code a fixed-width feed that cannot adapt to the viewport and panel states.
- Do not couple left navigation and widgets-panel toggles or leave blank width reserved for a collapsed panel.
- Do not tie widget implementations, types, instance state, or renderer to the right rail. The rail is only one host/layout.
- Do not implement the future deck UI or a deck-specific interaction model in this task.
- Do not connect widgets to live Misskey, Sharkey, Mastodon, or other server APIs yet.
- Do not show fake posts, users, trends, or other fabricated service data. Only intentional empty placeholder UI is in scope.
- Do not hard-code permanent sidebar sections in place of a widget registry/editor.
- Do not make drag-and-drop the only way to reorder widgets.
- Do not reset widget order or refill defaults after the user intentionally removes all widgets.
- Do not change main-feed chronology to fix thread chronology.
- Do not rewrite repost attribution or quote-post rendering; both are already satisfactory.
- Do not replace the existing framework, add a new UI framework, introduce broad dependencies, or create a parallel storage/panel-state system without demonstrated need.
- Do not expand scope into unrelated feature parity, new navigation destinations, or a general cleanup/refactor.
- Do not combine all work into one large patch. Keep implementation slices focused, testable, and logged.

## Suggested execution slices

Implement these as separate, reviewable slices following `AGENTS.md`'s branch/session protocol:

1. **Thread ordering:** reproduce the issue; trace sort and render order; fix and test chronology.
2. **Responsive shell:** fluid feed sizing, independent panel modes, responsive breakpoints, no dead columns.
3. **Widget core:** serializable types/instances/layouts, registry, renderer, default placeholder type, persistence/default seeding.
4. **Widgets rail/editor:** default instances, editor, add/remove/reorder, accessible controls, persistence flow.
5. **Visual polish:** navigation active/hover/focus states, tooltips, group separation, keyboard/accessibility review.
6. **Regression pass:** combined tests, web build, screenshots/device checks where available.

If repository inspection reveals a conflict with an existing architectural decision, stop and document the conflict before broadening scope. Do not silently change unrelated architecture.
