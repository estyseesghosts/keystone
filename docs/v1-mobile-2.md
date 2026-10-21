# v1 reference carry: mobile_2.md
> Source: /Users/terezi/Local Documents/Keystone/docs/mobile_2.md
> Carried: 2026-10-21 — verbatim copy (this header added).
> Reference only — v2 requirements live in docs/parity-gaps.md.

---

# Keystone Mobile: SymbioteNative Prototyping Plan

## Objective

Build an isolated, native-rendered mobile prototype for Keystone using SolidJS and SymbioteNative.

The target is a mobile experience comparable in interaction quality to Bluesky: polished navigation transitions, responsive gestures, smooth scrolling, coordinated media animations, native keyboard behavior and consistent platform integration.

This is a feasibility prototype, not a complete mobile client.

## 1. Non-negotiable constraints

1. Keep the existing Keystone desktop and web SPA unchanged.
2. Build a separate native mobile target in `mobile/`.
3. Use SolidJS for application components and SymbioteNative for native rendering.
4. Do not introduce React components, React hooks or a React-based application UI. Retain dependencies required internally by React Native and SymbioteNative.
5. Reuse portable TypeScript logic only after inspecting its actual dependencies. Do not import browser-dependent components into the native application.
6. Do not rewrite networking, authentication or the existing frontend architecture during the initial visual prototype.
7. Do not implement a custom gesture engine or animation framework before demonstrating that existing SymbioteNative capabilities are inadequate.
8. Keep the prototype small, testable and independently buildable.

The repository's existing root instructions may contain desktop-specific styling and framework restrictions. Read them first, then establish these mobile-only exceptions in `mobile/AGENTS.md`. Do not weaken the rules governing `frontend/`.

## 2. Phase 0 — Inspect the actual repository

Before modifying files:

- Read `AGENTS.md`, `state/STATE.md`, the latest session log and the current frontend implementation guidance. Follow the repository's current interruption and logging rules.
- Inspect the actual working tree, branch, package scripts, dependencies and outstanding changes.
- Identify which current Keystone modules are framework-independent and which depend on the DOM, browser storage, CSS or other browser APIs.
- Check the currently installed SymbioteNative documentation, CLI options, Solid example and native package versions.

Do not rely solely on an older README or a previous architecture proposal when the checked-out source disagrees.

### Deliverable

A short `mobile/docs/prototype-plan.md` recording:

- The intended architecture.
- Existing code that appears shareable.
- Relevant SymbioteNative capabilities and documented limitations.
- Current build environment and available iOS/Android test targets.
- Unresolved technical risks.

Do not perform broad source refactoring during this phase.

## 3. Phase 1 — Scaffold a clean native application

Use the official SymbioteNative CLI.

From the Keystone repository root, verify that `mobile/` does not already contain work that must be preserved, then run:

```bash
npx @symbiote-native/cli new mobile --framework solid --reanimated
```

Inside the generated application, consult the installed CLI's help and official navigation documentation, then add `@symbiote-native/navigation` through the supported CLI mechanism.

References:

- Quick start: https://docs.symbiote-native.dev/docs/quick-start/
- Solid adapter: https://docs.symbiote-native.dev/docs/api/solid/
- Navigation: https://docs.symbiote-native.dev/docs/navigation/stack/
- Reanimated: https://docs.symbiote-native.dev/docs/packages/reanimated/

Do not hand-recreate generated Babel, Metro, TypeScript, worklet or native-project configuration without first determining why the generated setup is insufficient.

### Requirements

- Keep the mobile dependency manifest and lockfile isolated from the web application.
- Pin compatible framework, renderer and animation dependencies.
- Document the development commands.
- Preserve the generated iOS and Android projects.
- Create `mobile/AGENTS.md` with mobile-specific architecture and implementation rules.
- Build and launch the untouched scaffold before writing application UI.

Test on an iOS simulator and an Android emulator or device. Resolve scaffold or build failures before proceeding.

### Deliverables

- A runnable Solid/SymbioteNative application.
- A documented setup and launch procedure.
- Successful build and launch evidence for both platforms, or a precise record of any unresolved platform blocker.

## 4. Phase 2 — Build one representative social timeline

Implement a minimal native UI using clearly identified, development-only fixture data.

The prototype should contain:

**Home feed**

A vertically scrolling timeline with realistic post variations: short and long text, mentions, links, custom emoji, content warnings, images, replies and interaction counts.

Use SymbioteNative's supported virtualized list components. Do not use an unbounded Solid `<For>` loop as the final rendering strategy for a long timeline.

**Post detail**

Opening a post pushes a detail screen through SymbioteNative's native stack navigator. Returning should preserve the originating feed's scroll position.

**Media viewer**

Opening a media thumbnail presents a full-screen viewer. Test a shared-element transition from the thumbnail to the viewer using Reanimated, provided the current package and platform support it correctly.

**Contextual menu**

Provide at least one functional contextual menu or native modal/sheet with appropriate dismissal behavior.

**Composer**

Provide a basic native text-input screen so keyboard appearance, input focus, content resizing and navigation can be evaluated. Do not build the complete production composer yet.

Use fixtures only for prototyping. Keep fixture data separate from production data paths and never present it as a real server response.

### Visual requirements

The design must be mobile-first and minimalist. Do not copy the desktop layout into a narrow viewport.

Create only the design tokens needed by this prototype: typography, spacing, surface colours, separators, radii and motion settings. Reuse existing Keystone brand and visual conventions where appropriate.

SymbioteNative compiles supported CSS into native styles; this does not make browser CSS fully compatible with native layout. Avoid Tailwind, DOM-dependent layout assumptions and browser-only selectors.

### Deliverables

- A functional feed, post-detail, media-viewer and composer prototype.
- Realistic fixture data.
- Reusable native post and media components.
- A small, documented styling and motion-token layer.

## 5. Phase 3 — Prove the interaction quality

This is the main evaluation phase. A functioning screen is insufficient.

### A. Navigation

Use the existing SymbioteNative native stack navigator for screen transitions and native back gestures.

Test:

- Feed → post detail → back.
- Feed → post detail → deeper reply → back through multiple levels.
- Hardware/system back on Android.
- Interactive back-swipe on iOS.
- Interrupted transitions and repeated rapid navigation.
- Scroll-position preservation.

Avoid implementing a second JavaScript navigation state machine that competes with the native navigator.

### B. Motion

Use `@symbiote-native/reanimated/solid` for animations that require continuous updates or UI-thread execution.

Implement a small set of deliberate interactions:

- Press feedback on post actions.
- A thumbnail-to-media-viewer transition, if reliable.
- Controlled modal or sheet entrance and dismissal.
- One representative layout or content transition.

Enable Reanimated's shared-element transition feature through the documented native-build configuration when testing `sharedTransitionTag`.

Keep animations interruptible and reversible where appropriate. Avoid arbitrary delays, chained timers or JavaScript-driven frame loops.

Respect reduced-motion preferences. A reduced-motion setting should not prevent navigation or make controls unusable.

### C. Gesture handling

Start with the capabilities already provided:

- Native stack gestures for screen navigation.
- `Pressable`/`pressable` events for ordinary actions.
- The supported responder APIs for simple custom gestures.
- Reanimated for animation state and updates.

Exercise nested interactions: horizontal media carousels inside a vertical feed, scrolling from within media, long-press menus and swipe dismissal.

Check SymbioteNative's current integrations before assuming React Native Gesture Handler is usable. Its JavaScript wrappers are React-specific unless a compatible adapter is supplied.

**Do not write a new gesture adapter yet.** First identify a repeatable interaction failure that cannot be solved with supported primitives.

### D. Keyboard and platform behavior

Verify text input, focus restoration, keyboard appearance, screen resizing, back navigation while the keyboard is open and composer state preservation.

SymbioteNative's Solid documentation notes that Android's stock keyboard events require the `@symbiote-native/android` host shims to function correctly. Test this explicitly instead of assuming the events work.

Also evaluate safe areas, system bars, media loading, touch targets and accessibility on both platforms.

### Deliverables

- A documented motion specification for the interactions actually implemented.
- An interaction test matrix covering navigation, gestures, media and keyboard behavior.
- Screenshots or screen recordings of representative flows on each platform where available.
- A list of verified limitations and any proposed workarounds.

## 6. Phase 4 — Investigate extensions only when necessary

If the preceding phase passes, do not add framework infrastructure simply because it might be useful.

If it fails, classify the problem before writing code.

### Case A: Gesture coordination is inadequate

Investigate whether React Native Gesture Handler can be exposed to the Solid adapter without importing its React-dependent components.

Write a small feasibility spike that tests native gesture recognition, event delivery, cancellation and interaction with Reanimated shared values.

Only develop a reusable Solid gesture adapter if the experiment establishes that:

1. The required gestures cannot be implemented reliably through current primitives.
2. The underlying native handlers can be integrated without forking React Native.
3. The adapter can be tested on iOS and Android.
4. The implementation can remain independent of Keystone's application components.

Do not build a gesture engine from scratch. Prefer a thin adapter over established native infrastructure.

### Case B: Shared-element transitions are unreliable

First determine whether the failure lies in Reanimated configuration, native-stack lifecycle, view identity or cross-screen mounting.

Build a minimal isolated reproduction before considering another transition mechanism. Do not replace the existing navigation library based on one failed demo.

### Case C: Keyboard, overlays or native modules fail

Verify the documented SymbioteNative host shims and native-module wrappers. Record differences between platforms and distinguish missing framework adapters from underlying platform defects.

Implement a wrapper only for a required capability that cannot be consumed reliably through the existing adapter.

### Deliverable

A short extension proposal specifying the failing interaction, reproduction steps, package boundary, native dependencies, test cases and estimated ongoing maintenance burden. Do not turn the prototype into a collection of speculative infrastructure packages.

## 7. Phase 5 — Establish a small test baseline

SymbioteNative supports headless testing and Detox-based end-to-end testing. Its current documentation says the Solid example does not yet have the same ready-made Detox harness as several other adapters.

Create the smallest useful test setup for the new application.

**Automated checks**

- TypeScript type-check.
- Unit tests for reusable logic.
- Basic rendering and interaction tests where supported.
- At least one end-to-end smoke flow if the native test setup can be established without disproportionate effort.

Assign stable test IDs to important navigation and interaction targets.

**Manual platform checks**

- Scrolling and feed virtualization with at least 100 varied fixture posts.
- Feed → detail → back with preserved scroll position.
- Interactive back navigation.
- Media opening and dismissal.
- Gestures nested inside the feed.
- Composer focus and keyboard behavior.
- Screen-reader labels and reduced-motion behavior.

Run performance checks in a release or profiling build, not only during development. Record the actual device, OS, build configuration and observed frame behavior. Do not invent benchmark numbers or claim smoothness based on a static screenshot.

## 8. Phase 6 — Evaluate code reuse

Only after the UI and interaction prototype works should you integrate Keystone's existing domain logic.

Identify portable modules for API requests, domain types, authentication state, pagination and MFM parsing.

Share those modules where dependencies permit. For browser-dependent modules, create a clean shared implementation or a native-specific adapter instead of importing browser globals into the mobile target.

Build a native MFM renderer as a separate task if the prototype confirms the architecture is viable. Reuse parsing logic, but map supported AST nodes into native views and text elements.

Do not port all feed, composer, HTML and protocol behavior in a single patch.

## 9. Acceptance criteria

The prototype is ready for an architecture decision only when:

- [ ] The isolated application builds and runs on iOS and Android.
- [ ] The existing desktop/web application and backend are unchanged.
- [ ] The UI uses actual native-rendered views, not a WebView.
- [ ] Feed scrolling uses virtualization.
- [ ] Opening and closing post detail works without losing feed position.
- [ ] Native stack gestures work reliably on supported platforms.
- [ ] At least one meaningful Reanimated interaction is verified on each platform.
- [ ] Nested scrolling and media gestures do not produce repeated false taps or stuck interactions.
- [ ] Keyboard and composer behavior have been tested.
- [ ] Known platform limitations and workarounds are documented.
- [ ] Test results and visual evidence are recorded.
- [ ] The code remains small enough to maintain without an unnecessary framework rewrite.

A feature is not verified merely because TypeScript compiles or a simulator displays a screen.

## 10. Final report and decision

Write `mobile/docs/prototype-report.md` with:

1. The architecture and packages used.
2. Exact build and test results.
3. Screenshots or recordings.
4. Performance observations and methodology.
5. Known issues by platform.
6. Existing code that could be shared with the native client.
7. Whether a custom gesture adapter is demonstrably necessary.
8. A recommendation: continue with SymbioteNative, continue after targeted extensions, or stop before investing in a full mobile implementation.

Before ending the session, follow Keystone's existing state-maintenance protocol. Update the resume state, append a dated log with real command output and remaining blockers, and explicitly mark anything that was not tested.

## Explicitly out of scope

- Replacing the existing desktop SPA.
- Converting the repository into a monorepo.
- A full mobile feature port.
- A production authentication or credential-storage redesign.
- A custom renderer, animation engine or gesture engine.
- A wholesale rewrite of Keystone's networking or state management.
- Adding native modules without a demonstrated requirement.

**Success means proving that Solid + SymbioteNative can deliver the interaction quality Keystone needs, with manageable platform-specific maintenance.** The first implementation should demonstrate that claim with one polished, realistic social interaction flow—not attempt to deliver the complete application.
