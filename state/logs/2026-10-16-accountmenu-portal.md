# 2026-10-16 — Account menu portal (click-through + underlay fix)

## Goal

Owner reports on the feed view: the account menu (Profile / Settings /
Switch account / Sign out) is underlaid by note content, and clicks on
its rows phase through to the content behind. Together with
`seethru.png` / `seethru2.png` (note text readable through the open
panel), the menu is losing to page content in both paint and
hit-testing.

## Diagnosis

The menu rendered inside `.accountcard-wrap` in the sidebar subtree
(`position: sticky`, scrolled `overflow`), with the rail case escaping
via a viewport-fixed inline style. Any ancestral trap in that subtree
(clipping, stacking context, pointer-events inheritance) breaks the
flyout in exactly the reported way: page content paints above it and
receives its clicks. From static code every individual rule looks
correct (opaque `var(--bg)`, `z-index: 30`, no overrides), so rather
than a fourth round of rule-tweaking against an unreproducible-here
rig, the menu now sidesteps the subtree entirely.

## What changed (`frontend/src/components/AccountCard.tsx` only)

- The open menu renders in a `<Portal>` to `document.body` in every
  placement, with viewport-fixed coordinates measured from the button
  at toggle time: rail → above + right of the avatar (as before);
  expanded sidebar → above the button, left-aligned (same visual as
  the old CSS anchor); mobile strip → below the button,
  right-aligned. Scroll/resize still dismiss (stale coordinates are
  impossible); the dead CSS-anchor path is gone.
- Outside-click dismissal now accepts clicks in either root
  (`wrapRef` or the portaled `menuRef`, cleared on every close), so
  menu-row clicks can never be mistaken for outside clicks — the
  previous in-DOM containment check would have closed-then-phased
  through exactly as reported had the menu ever left the wrap.
- No visual, role, or ordering changes: same `.accountmenu` card,
  same items, same z-index, same opaque layered background from the
  previous slice.

## Evidence (real output)

- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-S47ZDtiR.js`, 323.56 kB;
  `index-NIJ7GfU8.css`, 38.77 kB).
- Static: no `from "react"` matches; Solid checklist (`solidjs.md`
  §10) walked — props untouched, `Portal` from `solid-js/web` for the
  flyout only, dismissal listeners still effect-scoped with
  `onCleanup`, Escape still returns focus to the trigger, plain-`let`
  element refs per the proven codebase convention
  (`InfiniteSentinel`), no `innerHTML`.
- No backends on this machine — API suites N/A. Browser confirmation
  (menu occludes content, rows navigate/switch/sign-out on first
  click, all three placements, both themes) **not yet verified**
  (owner rig, fresh load).

## Open questions

- None. If a row still phases through on a fresh load, capture which
  placement (rail / expanded / mobile strip) — coordinates are now
  the only placement-specific code left.

## Next step

Owner browser pass, then this slice is done.
